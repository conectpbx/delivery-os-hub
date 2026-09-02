import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { toast } from "sonner";
import { WifiOff } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { flushQueue, readQueue } from "@/lib/offline-queue";
import { useAuth } from "@/hooks/useAuth";

const db = supabase as unknown as SupabaseClient;

/** Sincroniza registros feitos offline e mostra um aviso quando não há conexão. */
export function OfflineSync() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    const update = () => setOffline(!navigator.onLine);
    update();

    const sync = async () => {
      if (!user || !navigator.onLine || !readQueue(user.id).length) return;
      try {
        const keys = await flushQueue(db, user.id);
        if (!keys.length) return;
        keys.forEach((key) => void qc.invalidateQueries({ queryKey: [key] }));
        toast.success("Registros offline sincronizados");
      } catch {
        toast.error("Não foi possível sincronizar os registros offline");
      }
    };

    const onOnline = () => {
      update();
      void sync();
    };

    window.addEventListener("online", onOnline);
    window.addEventListener("offline", update);
    void sync();

    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", update);
    };
  }, [qc, user]);

  if (!offline) return null;

  return (
    <div className="fixed inset-x-0 bottom-20 z-50 mx-auto flex w-fit items-center gap-2 rounded-full bg-foreground/90 px-4 py-2 text-xs font-medium text-background shadow-lg md:bottom-6">
      <WifiOff className="size-3.5" />
      Modo offline — os dados serão sincronizados ao reconectar
    </div>
  );
}
