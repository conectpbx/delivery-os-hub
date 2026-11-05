import assert from "node:assert/strict";
import test from "node:test";
import { readJsonBody, readBodyBytes, RequestBodyError } from "./request-body";
const request = (body: string) => new Request("https://app.test/api", { method: "POST", body });
const failure = (status: number) => (error: unknown) =>
  error instanceof RequestBodyError && error.status === status;

test("JSON body accepts the exact byte limit and rejects invalid JSON", async () => {
  assert.deepEqual(await readJsonBody(request('{"a":1}'), 7), { a: 1 });
  await assert.rejects(readJsonBody(request("{")), failure(400));
  await assert.rejects(readJsonBody(request('"ééé"'), 7), failure(413));
});

test("chunked/lying-length GPS bodies are capped and the stream is cancelled", async () => {
  for (const length of [undefined, "0"]) {
    let cancelled = false;
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(20_000));
      },
      cancel() {
        cancelled = true;
      },
    });
    const req = new Request("https://app.test/api", {
      method: "POST",
      body: stream,
      ...(length ? { headers: { "content-length": length } } : {}),
      duplex: "half",
    } as RequestInit);
    await assert.rejects(readJsonBody(req), failure(413));
    assert.equal(cancelled, true);
  }
});

test("declared oversize is rejected before reading", async () => {
  const req = new Request("https://app.test/api", {
    method: "POST",
    body: "{}",
    headers: { "content-length": "99999" },
  });
  await assert.rejects(readJsonBody(req), failure(413));
  assert.equal(req.bodyUsed, false);
});

test("a stalled body is cancelled at the read deadline", async () => {
  let cancelled = false;
  const stream = new ReadableStream({
    cancel() {
      cancelled = true;
    },
  });
  const req = new Request("https://app.test/api", {
    method: "POST",
    body: stream,
    duplex: "half",
  } as RequestInit);
  await assert.rejects(readBodyBytes(req, 16_384, 5), failure(408));
  assert.equal(cancelled, true);
});
