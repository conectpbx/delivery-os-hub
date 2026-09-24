import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type AdminOverview = {
  totalUsers: number;
  activeUsers30d: number;
  deliveries30d: number;
  revenue30d: number;
  scansToday: number;
};

export type AdminUser = {
  user_id: string;
  email: string;
  full_name: string | null;
  role: "super_admin" | "admin" | "user";
  created_at: string;
  last_sign_in_at: string | null;
  is_blocked: boolean;
  delivery_count: number;
};

export type SystemModule = {
  key: string;
  name: string;
  description: string;
  enabled: boolean;
  position: number;
};

export type SystemAccess = {
  role: "super_admin" | "admin" | "user";
  maintenanceMode: boolean;
  modules: Record<string, boolean>;
};

export type SystemSettings = {
  id: boolean;
  app_name: string;
  support_email: string;
  maintenance_mode: boolean;
  allow_registrations: boolean;
  ai_daily_limit: number;
  updated_at: string;
};

export type AuditLog = {
  id: number;
  action: string;
  actor_id: string | null;
  target_id: string | null;
  details: Record<string, unknown>;
  created_at: string;
};

const adminApi = supabase as unknown as {
  rpc: (name: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: Error | null }>;
  from: (table: string) => { select: (columns?: string) => { order: (column: string, options: { ascending: boolean }) => { limit: (limit: number) => Promise<{ data: unknown; error: Error | null }> }; single: () => Promise<{ data: unknown; error: Error | null }> } };
};

export async function adminRpc<T>(name: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await adminApi.rpc(name, args);
  if (error) throw error;
  return data as T;
}

export function useIsAdmin(enabled = true) {
  return useQuery({
    queryKey: ["admin", "access"],
    queryFn: () => adminRpc<boolean>("is_super_admin"),
    enabled,
    staleTime: 60_000,
    retry: false,
  });
}

export function useSystemAccess(enabled = true) {
  return useQuery({
    queryKey: ["system", "access"],
    queryFn: () => adminRpc<SystemAccess>("get_my_system_access"),
    enabled,
    staleTime: 30_000,
  });
}

export function useSystemModules(enabled = true) {
  return useQuery({
    queryKey: ["admin", "modules"],
    queryFn: async () => {
      const { data, error } = await adminApi.from("system_modules").select("*").order("position", { ascending: true }).limit(50);
      if (error) throw error;
      return data as SystemModule[];
    },
    enabled,
  });
}

export function useAdminOverview(enabled = true) {
  return useQuery({
    queryKey: ["admin", "overview"],
    queryFn: () => adminRpc<AdminOverview>("admin_overview"),
    enabled,
  });
}

export function useAdminUsers(search: string, enabled = true) {
  return useQuery({
    queryKey: ["admin", "users", search],
    queryFn: () => adminRpc<AdminUser[]>("admin_list_users", { _search: search, _limit: 100 }),
    enabled,
  });
}

export function useSystemSettings(enabled = true) {
  return useQuery({
    queryKey: ["admin", "settings"],
    queryFn: async () => {
      const { data, error } = await adminApi.from("system_settings").select("*").single();
      if (error) throw error;
      return data as SystemSettings;
    },
    enabled,
  });
}

export function useAuditLogs(enabled = true) {
  return useQuery({
    queryKey: ["admin", "audit"],
    queryFn: async () => {
      const { data, error } = await adminApi.from("admin_audit_logs").select("*").order("created_at", { ascending: false }).limit(50);
      if (error) throw error;
      return data as AuditLog[];
    },
    enabled,
  });
}

