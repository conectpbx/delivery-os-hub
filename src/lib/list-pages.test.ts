import assert from "node:assert/strict";
import test from "node:test";
import { loadAllPages } from "./list-pages";

test("history pagination keeps more than 1,000 rows and stops at a short page", async () => {
  const rows = Array.from({ length: 1203 }, (_, id) => ({ id }));
  let requests = 0;
  const actual = await loadAllPages(async (from, to) => {
    requests++;
    return rows.slice(from, to + 1);
  });
  assert.deepEqual(actual, rows);
  assert.equal(requests, 3);
});

test("pagination propagates errors and cancellation without returning partial totals", async () => {
  const controller = new AbortController();
  let requests = 0;
  await assert.rejects(
    loadAllPages(
      async () => {
        requests++;
        controller.abort();
        return [1];
      },
      controller.signal,
      1,
    ),
    { name: "AbortError" },
  );
  assert.equal(requests, 1);
  await assert.rejects(
    loadAllPages(async () => {
      throw Error("offline");
    }),
    /offline/,
  );
});
