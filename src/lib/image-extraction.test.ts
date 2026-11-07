import assert from "node:assert/strict";
import test from "node:test";
import { extractImage } from "./image-extraction.server";

test("both OCR flows use the authenticated atomic quota before invoking the provider", async () => {
  const previous = process.env["LOVABLE_API_KEY"];
  const original = globalThis.fetch;
  process.env["LOVABLE_API_KEY"] = "TEST_ONLY_NOT_A_CREDENTIAL";
  let requests = 0,
    quota = -1;
  const fake = {
    rpc: async (name: string, args: { _limit: number }) => {
      assert.equal(name, "consume_ai_scan_quota");
      assert.equal(args._limit, 15);
      return { data: quota, error: null };
    },
  } as unknown as Parameters<typeof extractImage>[0];
  globalThis.fetch = (async () => {
    requests++;
    return Response.json({ choices: [{ message: { content: '{"gross":20}' } }] });
  }) as typeof fetch;
  try {
    await assert.rejects(
      extractImage(fake, { imageBase64: "test", mimeType: "image/jpeg" }, "fixture"),
      /limite/,
    );
    assert.equal(requests, 0);
    quota = 2;
    const result = await extractImage(
      fake,
      { imageBase64: "test", mimeType: "image/jpeg" },
      "fixture",
    );
    assert.equal(result.remaining, 13);
    assert.equal(requests, 1);
  } finally {
    globalThis.fetch = original;
    if (previous === undefined) delete process.env["LOVABLE_API_KEY"];
    else process.env["LOVABLE_API_KEY"] = previous;
  }
});
