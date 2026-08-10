import type { QueryClient } from "@tanstack/react-query";
import { persistQueryClient } from "@tanstack/react-query-persist-client";
import { createSyncStoragePersister } from "@tanstack/query-sync-storage-persister";

/** Mantém o cache das consultas no localStorage para leitura offline. */
export function setupQueryPersistence(queryClient: QueryClient) {
  if (typeof window === "undefined") return;

  persistQueryClient({
    queryClient,
    persister: createSyncStoragePersister({
      storage: window.localStorage,
      key: "delivery-os-query-cache",
    }),
    maxAge: 1000 * 60 * 60 * 24 * 7,
  });
}
