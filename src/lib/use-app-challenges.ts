import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { challengeSchema, type AppChallenge } from "./app-challenges";
import { isOffline } from "./offline-queue";

const db = supabase as unknown as SupabaseClient;
type Action =
  | { kind: "save"; id?: string | undefined; values: unknown }
  | { kind: "receive"; challenge: AppChallenge; at: string }
  | { kind: "reverse"; challenge: AppChallenge }
  | { kind: "delete"; id: string };
export function useSaveChallenge() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (action: Action) => {
      if (isOffline())
        throw new Error("Conecte-se à internet para alterar desafios e confirmar recebimentos.");
      let request;
      if (action.kind === "save") {
        const values = challengeSchema.parse(action.values);
        if (action.id)
          request = db
            .from("app_challenges")
            .update(values)
            .eq("id", action.id)
            .is("received_at", null);
        else {
          const { data, error } = await supabase.auth.getUser();
          if (error || !data.user) throw new Error("Entre novamente para salvar o desafio.");
          request = db.from("app_challenges").insert({ ...values, user_id: data.user.id });
        }
      } else if (action.kind === "receive") {
        const at = Date.parse(action.at);
        if (!Number.isFinite(at) || at > Date.now() || at < Date.parse(action.challenge.starts_at))
          throw new Error("Informe um recebimento entre o início do desafio e agora.");
        request = db
          .from("app_challenges")
          .update({ received_at: action.at })
          .eq("id", action.challenge.id)
          .eq("reward", action.challenge.reward)
          .eq("target", action.challenge.target)
          .eq("metric", action.challenge.metric)
          .eq("app_name", action.challenge.app_name)
          .eq("starts_at", action.challenge.starts_at)
          .eq("ends_at", action.challenge.ends_at)
          .is("received_at", null);
      } else if (action.kind === "reverse") {
        request = db
          .from("app_challenges")
          .update({ received_at: null, auto_receive: false })
          .eq("id", action.challenge.id)
          .eq("received_at", action.challenge.received_at!);
      } else {
        request = db.from("app_challenges").delete().eq("id", action.id).is("received_at", null);
      }
      const { data, error } = await request.select("id").maybeSingle();
      if (error) throw error;
      if (!data)
        throw new Error("Este desafio já foi alterado. Atualize a lista e tente novamente.");
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["app_challenges"] }),
  });
}
