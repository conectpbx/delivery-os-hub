import type { Session, SupabaseClient } from "@supabase/supabase-js";

type AuthSource = Pick<SupabaseClient["auth"], "getSession" | "onAuthStateChange">;
export type AuthSnapshot = { session: Session | null; loading: boolean };
const serverSnapshot: AuthSnapshot = { session: null, loading: true };

/** One subscription and initial session read for all mounted consumers. */
export function createAuthStore(source: AuthSource) {
  let snapshot = serverSnapshot;
  let generation = 0;
  let stop: (() => void) | undefined;
  const listeners = new Set<() => void>();
  const publish = (session: Session | null) => {
    if (!snapshot.loading && snapshot.session === session) return;
    snapshot = { session, loading: false };
    listeners.forEach((listener) => listener());
  };
  return {
    getSnapshot: () => snapshot,
    getServerSnapshot: () => serverSnapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      if (!stop) {
        const startGeneration = ++generation;
        let authEventSeen = false;
        const { data } = source.onAuthStateChange((_event, session) => {
          if (generation !== startGeneration) return;
          authEventSeen = true;
          publish(session);
        });
        stop = () => data.subscription.unsubscribe();
        void source.getSession().then(
          ({ data }) => {
            if (generation === startGeneration && !authEventSeen) publish(data.session);
          },
          () => {
            if (generation === startGeneration && !authEventSeen) publish(null);
          },
        );
      }
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) {
          ++generation;
          stop?.();
          stop = undefined;
          snapshot = serverSnapshot;
        }
      };
    },
  };
}
