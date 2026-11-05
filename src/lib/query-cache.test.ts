import assert from "node:assert/strict";
import test from "node:test";
import { QueryClient, dehydrate } from "@tanstack/react-query";
import type { PersistedClient } from "@tanstack/react-query-persist-client";
import { createQueryPersistence } from "./query-cache";

function saved(user: string, rows: unknown): PersistedClient {
  const query = new QueryClient();
  query.setQueryData(["deliveries"], rows);
  query.setQueryData(["admin", "users"], ["sensitive"]);
  const result = { timestamp: Date.now(), buster: user, clientState: dehydrate(query) };
  query.clear();
  return result;
}

test("late account A restore never hydrates account B", async () => {
  const client = new QueryClient();
  let resolve!: (value: PersistedClient) => void;
  const persistence = createQueryPersistence(client, {
    read: (id) =>
      id === "A"
        ? new Promise((done) => {
            resolve = done;
          })
        : Promise.resolve(saved("B", ["B"])),
    write: async () => {},
    remove: async () => {},
  });
  const first = persistence.activate("A");
  await persistence.activate("B");
  resolve(saved("A", ["A"]));
  await first;
  assert.deepEqual(client.getQueryData(["deliveries"]), ["B"]);
  assert.equal(client.getQueryData(["admin", "users"]), undefined);
  await persistence.activate(null);
  assert.equal(client.getQueryData(["deliveries"]), undefined);
  persistence.dispose();
  client.clear();
});

test("batch writes retain the original owner and exclude privileged/GPS data", async () => {
  const client = new QueryClient();
  const writes: { user: string; client: PersistedClient }[] = [];
  const persistence = createQueryPersistence(client, {
    read: async () => undefined,
    write: async (user, client) => {
      writes.push({ user, client });
    },
    remove: async () => {},
  });
  await persistence.activate("A");
  for (let i = 0; i < 25; i++) client.setQueryData(["deliveries"], [i]);
  client.setQueryData(["admin", "users"], ["private"]);
  client.setQueryData(["gps-route-points", "route"], ["coordinates"]);
  await persistence.activate("B");
  await persistence.flush();
  assert.equal(writes.length, 1);
  assert.equal(writes[0]?.user, "A");
  assert.deepEqual(
    writes[0]?.client.clientState.queries.map((q) => q.queryKey),
    [["deliveries"]],
  );
  assert.deepEqual(writes[0]?.client.clientState.queries[0]?.state.data, [24]);
  persistence.dispose();
  client.clear();
});

test("expired and foreign-buster caches are removed; unavailable storage stays usable", async () => {
  const client = new QueryClient();
  const removed: string[] = [];
  const persistence = createQueryPersistence(client, {
    read: async (id) =>
      id === "broken"
        ? Promise.reject(Error("blocked"))
        : id === "old"
          ? { ...saved(id, [1]), timestamp: 0 }
          : saved("another-account", [2]),
    write: async () => {
      throw Error("quota");
    },
    remove: async (id) => {
      removed.push(id);
    },
  });
  await persistence.activate("old");
  await persistence.activate("mismatch");
  assert.deepEqual(removed, ["old", "mismatch"]);
  await persistence.activate("broken");
  client.setQueryData(["deliveries"], [3]);
  await persistence.flush();
  assert.deepEqual(client.getQueryData(["deliveries"]), [3]);
  persistence.dispose();
  client.clear();
});
