import type { QueryClient } from "@tanstack/react-query";
import type { PersistedClient } from "@tanstack/react-query-persist-client";
import { persistQueryClient } from "@tanstack/react-query-persist-client";
import { get, set, del } from "idb-keyval";
import { supabase } from "@/integrations/supabase/client";

const PREFIX = "delivery-os-query-cache:";

/** Mantém o cache offline isolado pelo id imutável do usuário autenticado. */
export function setupQueryPersistence(queryClient: QueryClient) {
  if (typeof window === "undefined") return;

  let stopPersistence: (() => void) | undefined;
  let flushPersistence: (() => Promise<void>) | undefined;
  let activeUserId: string | null = null;

  const activate = (userId: string | null) => {
    if (userId === activeUserId) return;
    stopPersistence?.();
    void flushPersistence?.();
    queryClient.clear();
    activeUserId = userId;
    if (!userId) return;

    let pendingClient: PersistedClient | undefined;
    let persistTimer: ReturnType<typeof setTimeout> | undefined;
    const flush = async () => {
      if (persistTimer) clearTimeout(persistTimer);
      persistTimer = undefined;
      const client = pendingClient;
      pendingClient = undefined;
      if (client) await set(`${PREFIX}${userId}`, client);
    };

    // IndexedDB não bloqueia a interface; o agrupamento evita serializar o cache a cada atualização rápida.
    const [unsubscribe] = persistQueryClient({
      queryClient,
      persister: {
        persistClient: async (client) => {
          pendingClient = client;
          if (persistTimer) clearTimeout(persistTimer);
          persistTimer = setTimeout(() => void flush(), 750);
        },
        restoreClient: async () => {
          return await get(`${PREFIX}${userId}`);
        },
        removeClient: async () => {
          await del(`${PREFIX}${userId}`);
        },
      },
      maxAge: 1000 * 60 * 60 * 24 * 7,
      buster: userId,
    });
    stopPersistence = unsubscribe;
    flushPersistence = flush;
  };

  void supabase.auth
    .getSession()
    .then(({ data }) => activate(data.session?.user.id ?? null))
    .catch(() => activate(null));
  supabase.auth.onAuthStateChange((_event, session) => activate(session?.user.id ?? null));
}
