import type { QueryClient } from "@tanstack/react-query";
import type { SystemAccess } from "./admin";

export const SYSTEM_ACCESS_KEY = ["system", "access"] as const;
export const MODULE_ROUTES = [
  { to: "/dashboard", label: "Dashboard", module: "dashboard" },
  { to: "/entregas", label: "Entregas", module: "deliveries" },
  { to: "/financeiro", label: "Financeiro", module: "finance" },
  { to: "/manutencao", label: "Manutenção", module: "maintenance" },
  { to: "/metas", label: "Metas", module: "goals" },
  { to: "/scanner", label: "Scanner IA", module: "scanner" },
  { to: "/relatorios", label: "Relatórios", module: "reports" },
] as const;

export function moduleForPath(pathname: string) {
  return MODULE_ROUTES.find(({ to }) => pathname === to || pathname.startsWith(`${to}/`));
}

/** A disponibilidade global vale para todos os papéis; Administração é independente. */
export function visibleModules(access: SystemAccess | undefined) {
  return access ? MODULE_ROUTES.filter(({ module }) => access.modules[module] !== false) : [];
}

export function moduleIsDisabled(pathname: string, access: SystemAccess | undefined) {
  const route = moduleForPath(pathname);
  return !!route && (!access || access.modules[route.module] === false);
}

export function systemAccessOptions(load: () => Promise<SystemAccess>, enabled = true) {
  return {
    queryKey: SYSTEM_ACCESS_KEY,
    queryFn: load,
    enabled,
    staleTime: 0,
    refetchInterval: 15_000,
    refetchOnMount: "always" as const,
    refetchOnWindowFocus: "always" as const,
    refetchOnReconnect: "always" as const,
  };
}

export async function updateModuleAccess(
  client: QueryClient,
  key: string,
  enabled: boolean,
  save: () => Promise<unknown>,
) {
  await save();
  // Uma consulta iniciada antes da gravação não pode restaurar a configuração antiga.
  await client.cancelQueries({ queryKey: SYSTEM_ACCESS_KEY });
  client.setQueriesData<SystemAccess>({ queryKey: SYSTEM_ACCESS_KEY }, (access) =>
    access ? { ...access, modules: { ...access.modules, [key]: enabled } } : access,
  );
  await client.invalidateQueries({ queryKey: SYSTEM_ACCESS_KEY });
}
