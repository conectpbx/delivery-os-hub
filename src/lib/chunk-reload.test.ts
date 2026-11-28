import assert from "node:assert/strict";
import test from "node:test";
import { isChunkError } from "./chunk-reload";

test("distingue falha de chunk de erros de dados e permissões", () => {
  assert.equal(
    isChunkError(new Error("Failed to fetch dynamically imported module: /assets/old.js")),
    true,
  );
  assert.equal(isChunkError("Importing a module script failed"), true);
  assert.equal(isChunkError("Unable to preload CSS for /assets/old.css"), true);
  assert.equal(isChunkError(new Error("permission denied")), false);
  assert.equal(isChunkError(new Error("Failed to fetch")), false);
});

test("não recarrega offline e recupera chunk antigo consultando o documento, uma única vez", async () => {
  // Browser globals live in a subprocess so fake IndexedDB tests keep their own environment.
  const { execFileSync } = await import("node:child_process");
  execFileSync(
    process.execPath,
    [
      "--import",
      "tsx",
      "--input-type=module",
      "-e",
      `
    import assert from 'node:assert/strict';
    import { recoverFromChunkError, waitForServer } from './src/lib/chunk-reload.ts';
    let online = false, reloads = 0;
    const requests = [], storage = new Map();
    globalThis.window = { location: { href: 'https://app.example/entregas', reload: () => reloads++ } };
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { get onLine() { return online; } } });
    globalThis.sessionStorage = { getItem: key => storage.get(key) ?? null, setItem: (key,value) => storage.set(key,value) };
    globalThis.fetch = async url => { requests.push(url); return new Response('<html></html>', { headers: { 'content-type': 'text/html' } }); };
    assert.equal(await waitForServer(window.location.href), false);
    assert.equal(recoverFromChunkError('Failed to fetch dynamically imported module: https://other.example/old.js'), true);
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(reloads, 0);
    assert.equal(requests.length, 0);
    online = true;
    assert.equal(recoverFromChunkError('Failed to fetch dynamically imported module: https://other.example/old.js'), true);
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.deepEqual(requests, ['https://app.example/entregas']);
    assert.equal(reloads, 1);
    recoverFromChunkError('Failed to fetch dynamically imported module: /assets/stale.js');
    assert.equal(reloads, 1);
  `,
    ],
    { cwd: process.cwd(), stdio: "pipe" },
  );
});
