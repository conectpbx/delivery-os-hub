import assert from "node:assert/strict";
import test from "node:test";
import type { Session } from "@supabase/supabase-js";
import { createAuthStore } from "./auth-state";

const session = (id: string) => ({ user: { id } }) as Session;
function harness() {
  let resolve!: (value: { data: { session: Session | null } }) => void;
  let onChange!: (event: string, value: Session | null) => void;
  let reads = 0;
  let subscriptions = 0;
  let unsubscriptions = 0;
  const store = createAuthStore({
    getSession: () => {
      reads++;
      return new Promise((done) => {
        resolve = done;
      });
    },
    onAuthStateChange: (callback: typeof onChange) => {
      subscriptions++;
      onChange = callback;
      return {
        data: {
          subscription: {
            unsubscribe: () => {
              unsubscriptions++;
            },
          },
        },
      };
    },
  } as unknown as Parameters<typeof createAuthStore>[0]);
  return {
    store,
    emit: (value: Session | null) => onChange("SIGNED_IN", value),
    resolve: (value: Session | null) => resolve({ data: { session: value } }),
    counts: () => ({ reads, subscriptions, unsubscriptions }),
  };
}

test("auth shares one subscription/read and ignores a stale initial session", async () => {
  const h = harness();
  const stopA = h.store.subscribe(() => {});
  const stopB = h.store.subscribe(() => {});
  assert.deepEqual(h.counts(), { reads: 1, subscriptions: 1, unsubscriptions: 0 });
  h.emit(session("current"));
  h.resolve(session("old"));
  await Promise.resolve();
  assert.equal(h.store.getSnapshot().session?.user.id, "current");
  stopA();
  assert.equal(h.counts().unsubscriptions, 0);
  stopB();
  assert.equal(h.counts().unsubscriptions, 1);
  assert.equal(h.store.getSnapshot().session, null);
  assert.equal(h.store.getServerSnapshot().loading, true);
});

test("sign-out wins over a late getSession result", async () => {
  const h = harness();
  const stop = h.store.subscribe(() => {});
  h.emit(null);
  h.resolve(session("signed-out"));
  await Promise.resolve();
  assert.deepEqual(h.store.getSnapshot(), { session: null, loading: false });
  stop();
});
