import type { QueryClient } from "@tanstack/react-query";
import { persistQueryClient } from "@tanstack/react-query-persist-client";
import { createSyncStoragePersister } from "@tanstack/query-sync-storage-persister";
import { supabase } from "@/integrations/supabase/client";

const PREFIX = "delivery-os-query-cache:";

/** Mantém o cache offline isolado pelo id imutável do usuário autenticado. */
export function setupQueryPersistence(queryClient: QueryClient) {
  if (typeof window === "undefined") return;

  let stopPersistence: (() => void) | undefined;
  let activeUserId: string | null = null;

  const activate = (userId: string | null) => {
    if (userId === activeUserId) return;
    stopPersistence?.();
    queryClient.clear();
    activeUserId = userId;
    if (!userId) return;

    const [unsubscribe] = persistQueryClient({
      queryClient,
      persister: createSyncStoragePersister({
        storage: window.localStorage,
        key: `${PREFIX}${userId}`,
      }),
      maxAge: 1000 * 60 * 60 * 24 * 7,
      buster: userId,
    });
    stopPersistence = unsubscribe;
  };

  void supabase.auth
    .getSession()
    .then(({ data }) => activate(data.session?.user.id ?? null))
    .catch(() => activate(null));
  supabase.auth.onAuthStateChange((_event, session) => activate(session?.user.id ?? null));
}
