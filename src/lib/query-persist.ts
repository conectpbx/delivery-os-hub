import type { QueryClient } from "@tanstack/react-query";
import type { PersistedClient } from "@tanstack/react-query-persist-client";
import { get, set, del } from "idb-keyval";
import { authStore } from "@/hooks/useAuth";
import { createQueryPersistence } from "./query-cache";

const PREFIX = "delivery-os-query-cache:";
const installed = new WeakSet<QueryClient>();

/** Mantém o cache offline isolado pelo id imutável do usuário autenticado. */
export function setupQueryPersistence(queryClient: QueryClient) {
  if (typeof window === "undefined" || installed.has(queryClient)) return;
  installed.add(queryClient);
  const persistence = createQueryPersistence(queryClient, {
    read: (userId) => get<PersistedClient>(`${PREFIX}${userId}`),
    write: (userId, client) => set(`${PREFIX}${userId}`, client),
    remove: (userId) => del(`${PREFIX}${userId}`),
  });
  const activate = () => {
    const state = authStore.getSnapshot();
    if (!state.loading) void persistence.activate(state.session?.user.id ?? null);
  };
  authStore.subscribe(activate);
  activate();
  window.addEventListener("pagehide", () => void persistence.flush());
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") void persistence.flush();
  });
}
