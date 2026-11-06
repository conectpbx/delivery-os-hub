import assert from "node:assert/strict";
import test from "node:test";
import { createTripSync, mergeRemoteTrip } from "./trip-sync";
import type { TripState } from "./trip-tracker";
const idle: TripState = {
  active: false,
  source: "browser",
  startedAt: null,
  endedAt: null,
  distanceKm: 0,
  points: 0,
  last: null,
};
const active: TripState = {
  ...idle,
  active: true,
  startedAt: "2026-11-05T10:00:00Z",
  updatedAt: "2026-11-05T10:00:00Z",
  journeyId: "journey-a",
};
const ended: TripState = {
  ...active,
  active: false,
  endedAt: "2026-11-05T11:00:00Z",
  updatedAt: "2026-11-05T11:00:00Z",
  pendingSave: false,
  synced: true,
};
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
const turn = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

test("a read started before the local start cannot revert the button", async () => {
  let local = { ...idle };
  const read = deferred<TripState | null>();
  const sync = createTripSync({
    local: () => local,
    apply: (next) => {
      local = next;
    },
    read: () => read.promise,
    write: async (state) => ({ ...state, synced: true }),
    error: () => {},
  });
  const pulling = sync.refresh();
  await turn();
  local = { ...active };
  const publishing = sync.publish(local, "start");
  read.resolve(null);
  await pulling;
  await publishing;
  assert.equal(local.active, true);
  assert.equal(local.synced, true);
  sync.stop();
});

test("start and finish writes are serialized and a late start acknowledgement cannot reopen the journey", async () => {
  let local = { ...active };
  const start = deferred<TripState>();
  const writes: boolean[] = [];
  const sync = createTripSync({
    local: () => local,
    apply: (next) => {
      local = next;
    },
    read: async () => null,
    write: async (state, action) => {
      writes.push(state.active);
      return action === "start" ? start.promise : { ...state, pendingSave: false, synced: true };
    },
    error: () => {},
  });
  const first = sync.publish(local, "start");
  await turn();
  local = { ...ended, pendingSave: true };
  const last = sync.publish(local, "finish");
  start.resolve({ ...active, synced: true });
  await first;
  await last;
  assert.deepEqual(writes, [true, false]);
  assert.equal(local.active, false);
  assert.equal(local.pendingSave, true, "local failed history save remains recoverable");
  sync.stop();
});

test("remote finish wins over an advanced clock and never creates a pending save on the observer", () => {
  const merged = mergeRemoteTrip(
    { ...active, synced: true, updatedAt: "2099-01-01T00:00:00Z" },
    ended,
  );
  assert.ok(merged && merged !== "push");
  assert.equal(merged.active, false);
  assert.equal(merged.pendingSave, false);
});

test("reconnection updates both start and finish buttons and clears network errors", async () => {
  let local = { ...idle };
  let remote: TripState = { ...active };
  let offline = true;
  const errors: unknown[] = [];
  const sync = createTripSync({
    local: () => local,
    apply: (next) => {
      local = next;
    },
    read: async () => {
      if (offline) throw Error("offline");
      return remote;
    },
    write: async (state) => state,
    error: (error) => errors.push(error),
  });
  await sync.refresh();
  assert.equal(local.active, false);
  assert.ok(errors.at(-1));
  offline = false;
  await sync.refresh();
  assert.equal(local.active, true);
  assert.equal(errors.at(-1), null);
  remote = { ...ended };
  await sync.refresh();
  assert.equal(local.active, false);
  sync.stop();
});

test("account disposal ignores in-flight responses and skips queued writes", async () => {
  let local = { ...idle };
  let writes = 0;
  const read = deferred<TripState | null>();
  const sync = createTripSync({
    local: () => local,
    apply: (next) => {
      local = next;
    },
    read: () => read.promise,
    write: async (state) => {
      writes++;
      return state;
    },
    error: () => {},
  });
  const pulling = sync.refresh();
  await turn();
  const pending = sync.publish(active, "start");
  sync.stop();
  read.resolve(active);
  await pulling;
  await pending;
  assert.equal(local.active, false);
  assert.equal(writes, 0);
});

test("notifications during an in-flight read schedule a follow-up read", async () => {
  let local = { ...idle };
  let reads = 0;
  const first = deferred<TripState | null>();
  const sync = createTripSync({
    local: () => local,
    apply: (next) => {
      local = next;
    },
    read: () => (++reads === 1 ? first.promise : Promise.resolve(active)),
    write: async (state) => state,
    error: () => {},
  });
  const pending = sync.refresh();
  await turn();
  void sync.refresh();
  first.resolve(null);
  await pending;
  await turn();
  assert.equal(reads, 2);
  assert.equal(local.active, true);
  sync.stop();
});

test("GPS progress is throttled while pause commands sync immediately", async () => {
  let local: TripState = { ...active, synced: true };
  let remote: TripState = { ...local };
  let writes = 0;
  let clock = 100_000;
  const sync = createTripSync({
    local: () => local,
    apply: (next) => {
      local = next;
    },
    read: async () => remote,
    write: async (state) => {
      writes++;
      remote = { ...state };
      return remote;
    },
    error: () => {},
    now: () => clock,
  });
  await sync.publish(local, "update");
  local = { ...local, distanceKm: 10 };
  await sync.refresh();
  assert.equal(writes, 1);
  clock += 31_000;
  await sync.refresh();
  assert.equal(writes, 2);
  local = {
    ...local,
    updatedAt: "2026-11-05T10:01:00Z",
    pauses: [{ id: "pause", reason: "Almoço", started_at: "2026-11-05T10:01:00Z", ended_at: null }],
  };
  await sync.publish(local, "update");
  assert.equal(writes, 3);
  sync.stop();
});

test("navigation flushes queued commands but an account switch cancels them", async () => {
  for (const sameAccount of [true, false]) {
    const pending = deferred<TripState | null>();
    let writes = 0;
    const sync = createTripSync({
      local: () => idle,
      apply: () => {},
      read: () => pending.promise,
      write: async (state) => {
        writes++;
        return state;
      },
      error: () => {},
      canWrite: () => sameAccount,
    });
    const pulling = sync.refresh();
    await turn();
    const publishing = sync.publish(active, "start");
    sync.stop(true);
    pending.resolve(null);
    await pulling;
    await publishing;
    assert.equal(writes, sameAccount ? 1 : 0);
  }
});

test("newer GPS totals synchronize without double-counting or retaining a local coordinate baseline", () => {
  const merged = mergeRemoteTrip(
    { ...active, synced: true, distanceKm: 1, last: { lat: -23, lng: -46 } },
    { ...active, synced: true, distanceKm: 3, points: 12 },
  );
  assert.ok(merged && merged !== "push");
  assert.equal(merged.distanceKm, 3);
  assert.equal(merged.last, null);
});

test("missing remote snapshot never discards pending local history", () => {
  assert.equal(mergeRemoteTrip({ ...ended, pendingSave: true, synced: true }, null), "push");
});
