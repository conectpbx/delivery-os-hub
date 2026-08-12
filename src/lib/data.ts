import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { enqueueInsert, isOffline } from "@/lib/offline-queue";


// Cliente sem tipagem de schema para tabelas acessadas de forma dinâmica.
const db = supabase as unknown as SupabaseClient;

export type Delivery = {
  id: string;
  app_name: string;
  earnings: number;
  tip: number;
  distance_km: number;
  duration_min: number;
  idle_min: number;
  pickup_address: string | null;
  dropoff_address: string | null;
  lat: number | null;
  lng: number | null;
  occurred_at: string;
};

export type Fueling = {
  id: string;
  liters: number;
  price_per_liter: number;
  total: number;
  odometer: number | null;
  station: string | null;
  occurred_at: string;
};

export type Maintenance = {
  id: string;
  service_type: string;
  description: string | null;
  cost: number;
  odometer: number | null;
  performed_at: string;
  next_due_date: string | null;
  next_due_km: number | null;
  status: string;
};

export type Expense = {
  id: string;
  category: string;
  description: string | null;
  amount: number;
  occurred_at: string;
};

export type Goal = {
  id: string;
  month: string;
  revenue_target: number;
  profit_target: number;
  deliveries_target: number;
};

export type App = {
  id: string;
  name: string;
  color: string | null;
  fee_percent: number;
  created_at: string;
};

export type Profile = {
  id: string;
  full_name: string | null;
  vehicle: string | null;
  fuel_efficiency: number | null;
  daily_goal: number | null;
  monthly_goal: number | null;
};

function useList<T>(key: string, table: string, orderCol: string) {
  return useQuery({
    queryKey: [key],
    queryFn: async () => {
      const { data, error } = await db
        .from(table)
        .select("*")
        .order(orderCol, { ascending: false });
      if (error) throw error;
      return (data ?? []) as T[];
    },
  });
}

export const useDeliveries = () => useList<Delivery>("deliveries", "deliveries", "occurred_at");
export const useFuelings = () => useList<Fueling>("fuelings", "fuelings", "occurred_at");
export const useMaintenances = () =>
  useList<Maintenance>("maintenances", "maintenances", "performed_at");
export const useExpenses = () => useList<Expense>("expenses", "expenses", "occurred_at");
export const useGoals = () => useList<Goal>("goals", "goals", "month");
export const useApps = () => useList<App>("apps", "apps", "name");

export const useInsertApp = () => useInsert<{ name: string; fee_percent: number }>("apps", "apps");

export function useUpdate<T extends Record<string, unknown>>(table: string, key: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, values }: { id: string; values: T }) => {
      const { error } = await db.from(table).update(values as never).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: [key] });
    },
  });
}

export const useUpdateApp = () => useUpdate<{ fee_percent: number }>("apps", "apps");

export function useProfile() {
  return useQuery({
    queryKey: ["profile"],
    queryFn: async () => {
      const { data, error } = await db.from("profiles").select("*").maybeSingle();
      if (error) throw error;
      return data as Profile | null;
    },
  });
}

export function useInsert<T extends Record<string, unknown>>(table: string, key: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (values: T) => {
      const { data: auth } = await supabase.auth.getUser().catch(() => ({ data: { user: null } }));
      const payload = { ...values, user_id: auth.user?.id };

      if (isOffline()) {
        const queued = enqueueInsert(table, key, payload);
        qc.setQueryData([key], (old: unknown) => [
          { id: queued.id, occurred_at: queued.createdAt, ...payload },
          ...((old as unknown[]) ?? []),
        ]);
        return;
      }

      const { error } = await db.from(table).insert(payload);
      if (error) throw error;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: [key] });
    },
  });
}


export function useRemove(table: string, key: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await db.from(table).delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: [key] });
    },
  });
}

export function useUpsertProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (values: Partial<Profile>) => {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) throw new Error("Sessão expirada");
      const { error } = await db
        .from("profiles")
        .upsert({ ...values, id: auth.user.id })
        .eq("id", auth.user.id);
      if (error) throw error;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["profile"] });
    },
  });
}
