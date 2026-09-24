import { useQuery } from "@tanstack/react-query";
import { getAdminData, getMySystemAccess, runAdminAction } from "@/lib/admin.functions";

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

export async function adminRpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
  if (name === "admin_set_user_access") return runAdminAction({ data: { action: "user", userId: String(args._user_id), role: args._role as AdminUser["role"], blocked: Boolean(args._blocked) } }) as Promise<T>;
  if (name === "admin_update_settings") return runAdminAction({ data: { action: "settings", appName: String(args._app_name), supportEmail: String(args._support_email), maintenanceMode: Boolean(args._maintenance_mode), allowRegistrations: Boolean(args._allow_registrations), aiDailyLimit: Number(args._ai_daily_limit) } }) as Promise<T>;
  if (name === "super_admin_update_module") return runAdminAction({ data: { action: "module", key: String(args._key), enabled: Boolean(args._enabled) } }) as Promise<T>;
  throw new Error("Ação administrativa desconhecida.");
}

export function useIsAdmin(enabled = true) {
  return useQuery({
    queryKey: ["admin", "access"],
    queryFn: async () => (await getMySystemAccess()).role === "super_admin",
    enabled,
    staleTime: 60_000,
    retry: false,
  });
}

export function useSystemAccess(enabled = true) {
  return useQuery({
    queryKey: ["system", "access"],
    queryFn: () => getMySystemAccess() as Promise<SystemAccess>,
    enabled,
    staleTime: 30_000,
  });
}

export function useSystemModules(enabled = true) {
  return useQuery({
    queryKey: ["admin", "modules"],
    queryFn: () => getAdminData({ data: { section: "modules" } }) as Promise<SystemModule[]>,
    enabled,
  });
}

export function useAdminOverview(enabled = true) {
  return useQuery({
    queryKey: ["admin", "overview"],
    queryFn: () => getAdminData({ data: { section: "overview" } }) as Promise<AdminOverview>,
    enabled,
  });
}

export function useAdminUsers(search: string, enabled = true) {
  return useQuery({
    queryKey: ["admin", "users", search],
    queryFn: () => getAdminData({ data: { section: "users", search } }) as Promise<AdminUser[]>,
    enabled,
  });
}

export function useSystemSettings(enabled = true) {
  return useQuery({
    queryKey: ["admin", "settings"],
    queryFn: () => getAdminData({ data: { section: "settings" } }) as Promise<SystemSettings>,
    enabled,
  });
}

export function useAuditLogs(enabled = true) {
  return useQuery({
    queryKey: ["admin", "audit"],
    queryFn: () => getAdminData({ data: { section: "audit" } }) as Promise<AuditLog[]>,
    enabled,
  });
}

