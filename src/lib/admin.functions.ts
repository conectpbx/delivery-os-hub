import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const roleSchema = z.enum(["super_admin", "admin", "user"]);

async function adminClient() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as any;
}

async function requireSuperAdmin(userId: string) {
  const client = await adminClient();
  const { data, error } = await client
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "super_admin")
    .maybeSingle();
  if (error || !data) throw new Error("Acesso restrito aos super administradores.");
  return client;
}

export const getMySystemAccess = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const client = await adminClient();
    const [{ data: roles }, { data: settings }, { data: modules }] = await Promise.all([
      client.from("user_roles").select("role").eq("user_id", context.userId),
      client.from("system_settings").select("maintenance_mode").eq("id", true).maybeSingle(),
      client.from("system_modules").select("key,enabled"),
    ]);
    const role = roles?.some((item: { role: string }) => item.role === "super_admin")
      ? "super_admin"
      : roles?.some((item: { role: string }) => item.role === "admin")
        ? "admin"
        : "user";
    return {
      role,
      maintenanceMode: settings?.maintenance_mode ?? false,
      modules: Object.fromEntries(
        (modules ?? []).map((item: { key: string; enabled: boolean }) => [item.key, item.enabled]),
      ),
    };
  });

export const getAdminData = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => z.object({ section: z.enum(["overview", "users", "settings", "modules", "audit"]), search: z.string().max(254).optional() }).parse(data))
  .handler(async ({ context, data }) => {
    const client = await requireSuperAdmin(context.userId);
    if (data.section === "settings") {
      const { data: result, error } = await client.from("system_settings").select("*").eq("id", true).single();
      if (error) throw error;
      return result;
    }
    if (data.section === "modules") {
      const { data: result, error } = await client.from("system_modules").select("*").order("position", { ascending: true }).limit(50);
      if (error) throw error;
      return result;
    }
    if (data.section === "audit") {
      const { data: result, error } = await client.from("admin_audit_logs").select("*").order("created_at", { ascending: false }).limit(50);
      if (error) throw error;
      return result;
    }
    if (data.section === "users") {
      const { data: users, error } = await client.auth.admin.listUsers({ page: 1, perPage: 200 });
      if (error) throw error;
      const ids = users.users.map((user: { id: string }) => user.id);
      const [{ data: profiles }, { data: roles }, { data: deliveries }] = await Promise.all([
        client.from("profiles").select("id,full_name").in("id", ids),
        client.from("user_roles").select("user_id,role").in("user_id", ids),
        client.from("deliveries").select("user_id").in("user_id", ids),
      ]);
      const term = (data.search ?? "").trim().toLocaleLowerCase("pt-BR");
      return users.users
        .map((user: any) => {
          const profile = profiles?.find((item: any) => item.id === user.id);
          const userRoles = roles?.filter((item: any) => item.user_id === user.id) ?? [];
          const role = userRoles.some((item: any) => item.role === "super_admin") ? "super_admin" : userRoles.some((item: any) => item.role === "admin") ? "admin" : "user";
          return { user_id: user.id, email: user.email ?? "", full_name: profile?.full_name ?? null, role, created_at: user.created_at, last_sign_in_at: user.last_sign_in_at ?? null, is_blocked: Boolean(user.banned_until && new Date(user.banned_until) > new Date()), delivery_count: deliveries?.filter((item: any) => item.user_id === user.id).length ?? 0 };
        })
        .filter((user: any) => !term || user.email.toLocaleLowerCase("pt-BR").includes(term) || user.full_name?.toLocaleLowerCase("pt-BR").includes(term))
        .slice(0, 100);
    }
    const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
    const [{ count: totalUsers }, { count: activeUsers }, { data: deliveries }, { data: scans }] = await Promise.all([
      client.from("user_roles").select("user_id", { count: "exact", head: true }),
      client.from("deliveries").select("user_id", { count: "exact", head: true }).gte("occurred_at", since),
      client.from("deliveries").select("earnings,tip").gte("occurred_at", since),
      client.from("ai_scan_usage").select("count").eq("usage_date", today),
    ]);
    return { totalUsers: totalUsers ?? 0, activeUsers30d: activeUsers ?? 0, deliveries30d: deliveries?.length ?? 0, revenue30d: deliveries?.reduce((sum: number, item: any) => sum + Number(item.earnings) + Number(item.tip), 0) ?? 0, scansToday: scans?.reduce((sum: number, item: any) => sum + item.count, 0) ?? 0 };
  });

export const runAdminAction = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => z.discriminatedUnion("action", [
    z.object({ action: z.literal("user"), userId: z.string().uuid(), role: roleSchema, blocked: z.boolean() }),
    z.object({ action: z.literal("settings"), appName: z.string().min(2).max(60), supportEmail: z.string().email().or(z.literal("")), maintenanceMode: z.boolean(), allowRegistrations: z.boolean(), aiDailyLimit: z.number().int().min(0).max(100) }),
    z.object({ action: z.literal("module"), key: z.string().regex(/^[a-z_]+$/), enabled: z.boolean() }),
  ]).parse(data))
  .handler(async ({ context, data }) => {
    const client = await requireSuperAdmin(context.userId);
    if (data.action === "user") {
      if (data.userId === context.userId && (data.role !== "super_admin" || data.blocked)) throw new Error("Você não pode remover o próprio acesso.");
      const { count } = await client.from("user_roles").select("user_id", { count: "exact", head: true }).eq("role", "super_admin");
      const { data: target } = await client.from("user_roles").select("role").eq("user_id", data.userId);
      if (target?.some((item: any) => item.role === "super_admin") && data.role !== "super_admin" && (count ?? 0) <= 1) throw new Error("É necessário manter ao menos um super administrador.");
      await client.from("user_roles").delete().eq("user_id", data.userId);
      const { error: roleError } = await client.from("user_roles").insert({ user_id: data.userId, role: data.role });
      if (roleError) throw roleError;
      const { error: authError } = await client.auth.admin.updateUserById(data.userId, { ban_duration: data.blocked ? "876000h" : "none" });
      if (authError) throw authError;
      await client.from("admin_audit_logs").insert({ actor_id: context.userId, action: "user.access.updated", target_id: data.userId, details: { role: data.role, blocked: data.blocked } });
    } else if (data.action === "settings") {
      const { error } = await client.from("system_settings").update({ app_name: data.appName.trim(), support_email: data.supportEmail.trim(), maintenance_mode: data.maintenanceMode, allow_registrations: data.allowRegistrations, ai_daily_limit: data.aiDailyLimit, updated_at: new Date().toISOString(), updated_by: context.userId }).eq("id", true);
      if (error) throw error;
      await client.from("admin_audit_logs").insert({ actor_id: context.userId, action: "settings.updated", details: { maintenanceMode: data.maintenanceMode, allowRegistrations: data.allowRegistrations, aiDailyLimit: data.aiDailyLimit } });
    } else {
      const { error } = await client.from("system_modules").update({ enabled: data.enabled, updated_at: new Date().toISOString(), updated_by: context.userId }).eq("key", data.key);
      if (error) throw error;
      await client.from("admin_audit_logs").insert({ actor_id: context.userId, action: "module.updated", details: { key: data.key, enabled: data.enabled } });
    }
    return { ok: true };
  });