import { useSyncExternalStore } from "react";
import { supabase } from "@/integrations/supabase/client";
import { createAuthStore } from "@/lib/auth-state";

// Resolve the lazy Supabase client only when the browser subscribes.
export const authStore = createAuthStore({
  getSession: () => supabase.auth.getSession(),
  onAuthStateChange: (callback) => supabase.auth.onAuthStateChange(callback),
});

export function useAuth() {
  const { session, loading } = useSyncExternalStore(
    authStore.subscribe,
    authStore.getSnapshot,
    authStore.getServerSnapshot,
  );
  return { session, user: session?.user ?? null, loading };
}
