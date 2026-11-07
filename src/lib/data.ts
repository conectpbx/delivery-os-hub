import { useAuth, authStore } from "@/hooks/useAuth";
import {
  listScope,
  cacheInsertedRow,
  cacheRemovedRow,
  type ListRange,
  type ListScope,
} from "./delivery-scope";
import { loadAllPages } from "./list-pages";
import type { AppChallenge } from "./app-challenges";
import { useEffect } from "react";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { enqueueInsert, isOffline } from "@/lib/offline-queue";
import type { WorkJourney } from "./operation-time";

// Cliente sem tipagem de schema para tabelas acessadas de forma dinâmica.
const db = supabase as unknown as SupabaseClient;

type RealtimeListener = () => void;

type SharedRealtimeSubscription = {
  channel: ReturnType<SupabaseClient["channel"]>;
  listeners: Set<RealtimeListener>;
  removalTimer: ReturnType<typeof setTimeout> | undefined;
  notificationTimer: ReturnType<typeof setTimeout> | undefined;
};

const realtimeSubscriptions = new Map<string, SharedRealtimeSubscription>();

function subscribeToTable(table: string, userId: string, listener: RealtimeListener) {
  const subscriptionKey = `${table}:${userId}`;
  let subscription = realtimeSubscriptions.get(subscriptionKey);

  if (!subscription) {
    const listeners = new Set<RealtimeListener>();
    const uniqueChannelName = `${table}-live-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const notify = () => {
      const current = realtimeSubscriptions.get(subscriptionKey);
      if (!current || current.notificationTimer) return;
      current.notificationTimer = setTimeout(() => {
        current.notificationTimer = undefined;
        listeners.forEach((listener) => listener());
      }, 250);
    };
    const filter = `${table === "profiles" ? "id" : "user_id"}=eq.${userId}`;
    const channel = supabase
      .channel(uniqueChannelName)
      .on("postgres_changes", { event: "INSERT", schema: "public", table, filter }, notify)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table, filter }, notify)
      // Supabase cannot filter DELETE events; keep deletion invalidation working across devices.
      .on("postgres_changes", { event: "DELETE", schema: "public", table }, notify)
      .subscribe();

    subscription = { channel, listeners, removalTimer: undefined, notificationTimer: undefined };
    realtimeSubscriptions.set(subscriptionKey, subscription);
  }

  if (subscription.removalTimer) {
    clearTimeout(subscription.removalTimer);
    subscription.removalTimer = undefined;
  }

  subscription.listeners.add(listener);

  return () => {
    const current = realtimeSubscriptions.get(subscriptionKey);
    if (!current) return;

    current.listeners.delete(listener);
    if (current.listeners.size > 0) return;

    current.removalTimer = setTimeout(() => {
      const latest = realtimeSubscriptions.get(subscriptionKey);
      if (latest !== current || latest.listeners.size > 0) return;

      if (latest.notificationTimer) clearTimeout(latest.notificationTimer);
      realtimeSubscriptions.delete(subscriptionKey);
      void supabase.removeChannel(latest.channel);
    }, 500);
  };
}

export type Delivery = {
  id: string;
  app_name: string;
  earnings: number;
  gross_earnings?: number;
  fee_percent?: number;
  tip: number;
  distance_km: number;
  duration_min: number;
  payment_method: PaymentMethod;
  idle_min: number;
  pickup_address: string | null;
  dropoff_address: string | null;
  lat: number | null;
  lng: number | null;
  occurred_at: string;
  status?: "em_rota" | "concluida";
  started_at?: string | null;
  ended_at?: string | null;
  estimated_duration_min?: number | null;
  stops?: DeliveryStop[];
};

export type DeliveryStop = {
  kind: "coleta" | "entrega";
  address: string;
  lat: number | null;
  lng: number | null;
  recorded_at?: string;
};

export type PaymentMethod = "credito" | "pix" | "dinheiro";

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
  allocation_method?: "immediate" | "monthly";
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

function useList<T>(key: string, table: string, orderCol: string, range?: ListRange, select = "*") {
  const scope = range ? listScope(range, orderCol) : undefined;
  const { user } = useAuth();
  const userId = user?.id;
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!userId) return;
    return subscribeToTable(table, userId, () => {
      void queryClient.invalidateQueries({ queryKey: [key] });
    });
  }, [key, queryClient, table, userId]);

  return useQuery({
    queryKey: scope ? [key, "range", scope, select] : [key],
    enabled: Boolean(userId),
    queryFn: async ({ signal }) => {
      if (table === "app_challenges") {
        const { error } = await db.rpc("reconcile_app_challenges").abortSignal(signal);
        if (error) throw error;
      }
      return loadAllPages<T>(async (from, to) => {
        let request = db.from(table).select(select).eq("user_id", userId!);
        request = filterScope(request, scope);
        const { data, error } = await request
          .order(orderCol, { ascending: false })
          .order("id", { ascending: false })
          .range(from, to)
          .abortSignal(signal);
        if (error) throw error;
        return (data ?? []) as T[];
      }, signal);
    },
    staleTime: table === "apps" || table === "goals" ? 1000 * 60 * 5 : 1000 * 60,
    refetchOnMount: true,
    refetchOnWindowFocus: true,
  });
}

export const useDeliveries = (range?: ListRange) =>
  useList<Delivery>("deliveries", "deliveries", "occurred_at", range);
export type DeliveryMetric = Pick<
  Delivery,
  "id" | "app_name" | "earnings" | "tip" | "distance_km" | "occurred_at" | "status"
>;
export const useDeliveryMetrics = (range: ListRange) =>
  useList<DeliveryMetric>(
    "deliveries",
    "deliveries",
    "occurred_at",
    range,
    "id,app_name,earnings,tip,distance_km,occurred_at,status",
  );
export const useFuelings = () => useList<Fueling>("fuelings", "fuelings", "occurred_at");
export const useMaintenances = () =>
  useList<Maintenance>("maintenances", "maintenances", "performed_at");
export const useExpenses = () => useList<Expense>("expenses", "expenses", "occurred_at");
export const useAppChallenges = () =>
  useList<AppChallenge>("app_challenges", "app_challenges", "starts_at");

export const useGoals = () => useList<Goal>("goals", "goals", "month");
export const useApps = () => useList<App>("apps", "apps", "name");
export const useJourneys = (range?: ListRange) =>
  useList<WorkJourney>("work_journeys", "work_journeys", "started_at", range);

export const useInsertApp = () => useInsert<{ name: string; fee_percent: number }>("apps", "apps");

export function useUpdate<T extends Record<string, unknown>>(table: string, key: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, values }: { id: string; values: T }) => {
      const { error } = await db
        .from(table)
        .update(values as never)
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: [key] });
    },
  });
}

export const useUpdateApp = () => useUpdate<{ fee_percent: number }>("apps", "apps");

export function useProfile(enabled = true) {
  const { user } = useAuth();
  const userId = user?.id;
  const active = enabled && Boolean(userId);
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!active || !userId) return;

    return subscribeToTable("profiles", userId, () => {
      void queryClient.invalidateQueries({ queryKey: ["profile"] });
    });
  }, [active, userId, queryClient]);

  return useQuery({
    queryKey: ["profile"],
    enabled: active,
    queryFn: async ({ signal }) => {
      const { data, error } = await db
        .from("profiles")
        .select("*")
        .eq("id", userId!)
        .abortSignal(signal)
        .maybeSingle();
      if (error) throw error;
      return data as Profile | null;
    },
    staleTime: 1000 * 60 * 5,
    refetchOnMount: true,
    refetchOnWindowFocus: true,
  });
}

export function useInsert<T extends Record<string, unknown>>(table: string, key: string) {
  const qc = useQueryClient();
  return useMutation({
    // The mutation itself handles offline persistence; do not pause before enqueueing.
    networkMode: "always",
    mutationFn: async (values: T) => {
      const auth = isOffline()
        ? { user: (await supabase.auth.getSession()).data.session?.user ?? null }
        : (await supabase.auth.getUser()).data;
      if (!auth.user) throw new Error("Sessão expirada. Entre novamente para salvar.");
      const payload = { ...values, user_id: auth.user.id };

      if (isOffline()) {
        const queued = await enqueueInsert(table, key, payload, auth.user.id);
        return { occurred_at: queued.createdAt, ...queued.values };
      }

      const write =
        table === "work_journeys"
          ? db.from(table).upsert(payload, { onConflict: "id" })
          : db.from(table).insert(payload);
      const { data, error } = await write.select("*").single();
      if (error) throw error;
      return data as Record<string, unknown>;
    },
    onSuccess: async (created) => {
      if (created["user_id"] !== authStore.getSnapshot().session?.user.id) return;
      cacheInsertedRow(qc, key, created);
      await qc.invalidateQueries({ queryKey: [key] });
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
    onSuccess: async (_data, removedId) => {
      cacheRemovedRow(qc, key, removedId);
      await qc.invalidateQueries({ queryKey: [key] });
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

export function filterScope<
  T extends {
    gte: (field: string, value: string) => T;
    lte: (field: string, value: string) => T;
    or: (value: string) => T;
  },
>(request: T, scope?: ListScope): T {
  if (!scope) return request;
  if (scope.mode === "journey-overlap" && scope.from && scope.to)
    return request.lte("started_at", scope.to).or(`ended_at.gte.${scope.from},ended_at.is.null`);
  if (scope.mode === "delivery-overlap" && scope.from && scope.to)
    return request.or(
      `and(occurred_at.gte.${scope.from},occurred_at.lte.${scope.to}),and(started_at.lte.${scope.to},or(ended_at.gte.${scope.from},status.eq.em_rota)),and(started_at.is.null,occurred_at.lte.${scope.to},or(ended_at.gte.${scope.from},status.eq.em_rota))`,
    );
  if (scope.from) request = request.gte(scope.field, scope.from);
  if (scope.to) request = request.lte(scope.field, scope.to);
  return request;
}

export function useDeliveryHistory(range: ListRange) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const userId = user?.id;
  const scope = listScope(range);
  useEffect(() => {
    if (!userId) return;
    return subscribeToTable("deliveries", userId, () => {
      void qc.invalidateQueries({ queryKey: ["deliveries"] });
    });
  }, [userId, qc]);
  return useInfiniteQuery({
    queryKey: ["deliveries", "history", scope],
    enabled: Boolean(userId),
    initialPageParam: 0,
    queryFn: async ({ pageParam, signal }) => {
      const request = filterScope(
        db
          .from("deliveries")
          .select("*", pageParam === 0 ? { count: "exact" } : {})
          .eq("user_id", userId!),
        scope,
      );
      const { data, error, count } = await request
        .order("occurred_at", { ascending: false })
        .order("id", { ascending: false })
        .range(pageParam, pageParam + 19)
        .abortSignal(signal);
      if (error) throw error;
      const rows = (data ?? []) as Delivery[];
      return { rows, total: count, next: rows.length === 20 ? pageParam + 20 : null };
    },
    getNextPageParam: (last) => last.next ?? undefined,
    staleTime: 60_000,
  });
}

export function useRecentDeliveryValues(app = "") {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["deliveries", "recent", { app, status: "concluida" }],
    enabled: Boolean(user),
    staleTime: 60_000,
    queryFn: async ({ signal }) => {
      let request = db
        .from("deliveries")
        .select(
          "id,app_name,gross_earnings,earnings,fee_percent,payment_method,occurred_at,ended_at,status",
        )
        .eq("user_id", user!.id)
        .eq("status", "concluida");
      if (app) request = request.eq("app_name", app);
      const { data, error } = await request
        .order("occurred_at", { ascending: false })
        .limit(20)
        .abortSignal(signal);
      if (error) throw error;
      return data as Pick<
        Delivery,
        | "id"
        | "app_name"
        | "gross_earnings"
        | "earnings"
        | "fee_percent"
        | "payment_method"
        | "occurred_at"
        | "ended_at"
        | "status"
      >[];
    },
  });
}
