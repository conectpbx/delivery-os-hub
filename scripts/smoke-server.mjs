import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";

const base = process.env.SMOKE_BASE_URL || "http://127.0.0.1:3002";
for (let attempt = 0; attempt < 40; attempt++) {
  try {
    if ((await fetch(`${base}/auth`)).ok) break;
  } catch {
    /* wait for startup */
  }
  await new Promise((resolve) => setTimeout(resolve, 250));
}
const auth = await fetch(`${base}/auth`);
assert.equal(auth.status, 200);
assert.ok((await auth.text()).includes("Entrar"));
assert.equal(auth.headers.get("x-content-type-options"), "nosniff");
assert.ok(auth.headers.get("content-security-policy")?.includes("frame-ancestors"));
assert.equal(auth.headers.get("cache-control"), "private, no-cache");

for (const path of ["/api/public/gps", "/api/public/gps/finish"]) {
  const options = await fetch(base + path, { method: "OPTIONS" });
  assert.equal(options.status, 204);
  assert.equal(options.headers.get("access-control-allow-origin"), "*");
  assert.equal((await fetch(base + path, { method: "POST", body: "{}" })).status, 401);
  const headers = {
    authorization: `Bearer dos_gps_${"a".repeat(64)}`,
    "content-type": "application/json",
  };
  assert.equal((await fetch(base + path, { method: "POST", headers, body: "{" })).status, 400);
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(20_000));
      controller.close();
    },
  });
  const large = await fetch(base + path, { method: "POST", headers, body: stream, duplex: "half" });
  assert.equal(large.status, 413);
  assert.equal(large.headers.get("cache-control"), "no-store");
}

const ssr = new URL("../.output/server/_ssr/", import.meta.url);
const actionFiles = (await readdir(ssr)).filter((file) => /^ai\.functions-.*\.mjs$/.test(file));
const actionIds = new Set();
for (const file of actionFiles) {
  const source = await readFile(new URL(file, ssr), "utf8");
  for (const match of source.matchAll(/id: "([a-f0-9]+)"/g)) actionIds.add(match[1]);
}
assert.equal(actionIds.size, 3, "all OCR server functions exist");
for (const actionId of actionIds) {
  const action = `${base}/_serverFn/${actionId}`;
  const crossSite = await fetch(action, {
    method: "POST",
    headers: { origin: "https://untrusted.test" },
    body: "{}",
  });
  assert.equal(crossSite.status, 403, "CSRF protection rejects a foreign origin");
  const anonymous = await fetch(action, { method: "POST", headers: { origin: base }, body: "{}" });
  assert.equal(anonymous.status, 401, "OCR server function requires a session");
  const oversized = await fetch(action, {
    method: "POST",
    headers: { origin: base },
    body: "x".repeat(8_100_001),
  });
  assert.equal(oversized.status, 413, "server functions enforce their upload cap before parsing");
}

const assets = new URL("../.output/public/assets/", import.meta.url);
const asset = (await readdir(assets)).find((file) => file.endsWith(".js.br"));
assert.ok(asset, "precompressed assets were generated");
const compressed = await fetch(`${base}/assets/${asset.slice(0, -3)}`, {
  headers: { "accept-encoding": "br" },
});
assert.equal(compressed.status, 200);
assert.equal(compressed.headers.get("content-encoding"), "br");
assert.ok(compressed.headers.get("cache-control")?.includes("immutable"));
assert.equal((await fetch(`${base}/sw.js`)).headers.get("cache-control"), "no-store");
console.log(
  "HTTP: SSR/login, security headers, GPS authorization/body caps, CSRF, protected OCR and Brotli/cache rules passed.",
);
