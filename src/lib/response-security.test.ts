import assert from "node:assert/strict";
import test from "node:test";
import { secureResponse } from "./response-security";

test("API failures preserve CORS and status, disable caches and add browser protections", async () => {
  const response = secureResponse(
    new Request("https://app.test/api/public/gps"),
    Response.json(
      { error: "unauthorized" },
      { status: 401, headers: { "access-control-allow-origin": "*" } },
    ),
  );
  assert.equal(response.status, 401);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), "*");
  assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
  assert.ok(response.headers.get("Content-Security-Policy")?.includes("https://*.lovable.dev"));
  assert.deepEqual(await response.json(), { error: "unauthorized" });
});

test("HTML is private, authenticated responses never cache and development framing still works", () => {
  const html = () => new Response("page", { headers: { "content-type": "text/html" } });
  assert.equal(
    secureResponse(new Request("https://app.test/auth"), html()).headers.get("Cache-Control"),
    "private, no-cache",
  );
  assert.equal(
    secureResponse(
      new Request("https://app.test/", { headers: { authorization: "Bearer token" } }),
      html(),
    ).headers.get("Cache-Control"),
    "no-store",
  );
  assert.ok(
    !secureResponse(new Request("http://localhost/auth"), html(), false)
      .headers.get("Content-Security-Policy")
      ?.includes("frame-ancestors"),
  );
});
