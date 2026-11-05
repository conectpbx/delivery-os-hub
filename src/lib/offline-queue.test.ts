import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import test from "node:test";
import { set } from "idb-keyval";
import type { SupabaseClient } from "@supabase/supabase-js";
import { enqueueInsert, flushQueue, readQueue } from "./offline-queue";
const client = (
  write: (row: Record<string, unknown>, options: Record<string, unknown>) => Promise<unknown>,
) => ({ from: () => ({ upsert: write }) }) as unknown as SupabaseClient;
const enqueue = (user: string) =>
  enqueueInsert("deliveries", "deliveries", { user_id: user, earnings: 10 }, user);

test("simultaneous offline records are not lost and have stable database IDs", async () => {
  const user = "concurrent";
  await Promise.all(Array.from({ length: 20 }, () => enqueue(user)));
  const rows = await readQueue(user);
  assert.equal(rows.length, 20);
  assert.equal(new Set(rows.map((row) => row.values["id"])).size, 20);
  await assert.rejects(enqueueInsert("deliveries", "deliveries", { user_id: "other" }, user));
});

test("single-flight sync preserves records enqueued during a request", async () => {
  const user = "during-sync";
  await enqueue(user);
  const db = client(async (_row, options) => {
    assert.equal(options["ignoreDuplicates"], true);
    await enqueue(user);
    return { error: null };
  });
  const first = flushQueue(db, user);
  assert.equal(flushQueue(db, user), first);
  assert.deepEqual(await first, ["deliveries"]);
  assert.equal((await readQueue(user)).length, 1);
});

test("lost acknowledgement retries use the same ID, and tampered ownership is never submitted", async () => {
  const user = "retry";
  await enqueue(user);
  const ids = new Set();
  let fail = true;
  const db = client(async (row) => {
    ids.add(row["id"]);
    if (fail) {
      fail = false;
      throw Error("lost acknowledgement");
    }
    return { error: null };
  });
  await flushQueue(db, user);
  assert.equal((await readQueue(user)).length, 1);
  await flushQueue(db, user);
  assert.equal(ids.size, 1);
  assert.equal((await readQueue(user)).length, 0);
  await set(`delivery-os-offline-queue:${user}`, [
    { id: "tampered", table: "deliveries", cacheKey: "deliveries", values: { user_id: "other" } },
  ]);
  await flushQueue(db, user);
  assert.equal(ids.size, 1);
});
