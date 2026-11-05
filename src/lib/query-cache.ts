import { dehydrate, hydrate, type QueryClient } from "@tanstack/react-query";
import type { PersistedClient } from "@tanstack/react-query-persist-client";

const MAX_AGE = 7 * 24 * 60 * 60 * 1000;
const OFFLINE_KEYS = new Set([
  "deliveries",
  "fuelings",
  "maintenances",
  "expenses",
  "goals",
  "apps",
  "profile",
  "work_journeys",
  "app_challenges",
]);
const canPersist = (key: readonly unknown[]) => OFFLINE_KEYS.has(String(key[0]));
type Storage = {
  read: (userId: string) => Promise<PersistedClient | undefined>;
  write: (userId: string, client: PersistedClient) => Promise<unknown>;
  remove: (userId: string) => Promise<unknown>;
};

/** Guard every asynchronous restore by identity; dehydrate only once per write batch. */
export function createQueryPersistence(client: QueryClient, storage: Storage) {
  let activeUser: string | null | undefined;
  let generation = 0;
  let stop: (() => void) | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let writes = Promise.resolve();
  const flush = () => {
    if (!timer || !activeUser) return writes;
    clearTimeout(timer);
    timer = undefined;
    const userId = activeUser;
    const persisted: PersistedClient = {
      timestamp: Date.now(),
      buster: userId,
      clientState: dehydrate(client, {
        shouldDehydrateQuery: (query) =>
          query.state.status === "success" && canPersist(query.queryKey),
        shouldDehydrateMutation: () => false,
      }),
    };
    writes = writes
      .then(() => storage.write(userId, persisted))
      .then(
        () => {},
        () => {},
      );
    return writes;
  };
  const schedule = () => {
    // A fixed batch window also flushes during sustained GPS or Realtime activity.
    if (!timer) timer = setTimeout(() => void flush(), 750);
  };
  return {
    flush,
    async activate(userId: string | null) {
      if (activeUser === userId) return;
      stop?.();
      stop = undefined;
      void flush();
      const current = ++generation;
      activeUser = userId;
      client.clear();
      if (!userId) return;
      try {
        const saved = await storage.read(userId);
        if (generation !== current) return;
        if (saved && saved.buster === userId && Date.now() - saved.timestamp <= MAX_AGE) {
          hydrate(client, {
            mutations: [],
            queries: saved.clientState.queries.filter((query) => canPersist(query.queryKey)),
          });
        } else if (saved) {
          await storage.remove(userId);
        }
      } catch {
        // Storage may be unavailable; online queries and in-memory data still work.
      }
      if (generation !== current) return;
      stop = client.getQueryCache().subscribe((event) => {
        if (
          canPersist(event.query.queryKey) &&
          (event.type === "removed" ||
            (event.type === "updated" && event.action.type === "success"))
        )
          schedule();
      });
    },
    dispose() {
      stop?.();
      void flush();
      ++generation;
      activeUser = undefined;
    },
  };
}
