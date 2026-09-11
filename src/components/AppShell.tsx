import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import {
  LayoutDashboard,
  Route as RouteIcon,
  Wallet,
  Wrench,
  Target,
  FileBarChart,
  ScanLine,
  LogOut,
  Menu,
  ShieldCheck,
  AlertTriangle,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { BrandLoading } from "@/components/BrandLoader";
import { useSystemAccess } from "@/lib/admin";

const nav = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard, module: "dashboard" },
  { to: "/entregas", label: "Entregas", icon: RouteIcon, module: "deliveries" },
  { to: "/financeiro", label: "Financeiro", icon: Wallet, module: "finance" },
  { to: "/manutencao", label: "Manutenção", icon: Wrench, module: "maintenance" },
  { to: "/metas", label: "Metas", icon: Target, module: "goals" },
  { to: "/scanner", label: "Scanner IA", icon: ScanLine, module: "scanner" },
  { to: "/relatorios", label: "Relatórios", icon: FileBarChart, module: "reports" },
] as const;

export function AppShell({
  title,
  subtitle,
  actions,
  children,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const { session, loading } = useAuth();
  const access = useSystemAccess(Boolean(session));
  const isSuperAdmin = access.data?.role === "super_admin";
  const visibleNav = nav.filter(
    (item) => isSuperAdmin || access.data?.modules[item.module] !== false,
  );
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [open, setOpen] = useState(false);
  const currentModule = nav.find((item) => item.to === pathname);
  const moduleDisabled = Boolean(
    currentModule && !isSuperAdmin && access.data?.modules[currentModule.module] === false,
  );
  const commercialBlocked = Boolean(
    !isSuperAdmin &&
    ["past_due", "suspended", "canceled"].includes(access.data?.subscriptionStatus ?? ""),
  );
  const maintenanceBlocked = Boolean(!isSuperAdmin && access.data?.maintenance?.block_access);
  const updateBlocked = Boolean(
    !isSuperAdmin &&
    access.data?.release?.force_update &&
    versionIsOlder(
      import.meta.env["VITE_APP_VERSION"] ?? "0.0.0",
      access.data.release.minimum_version,
    ),
  );

  useEffect(() => {
    if (!loading && !session) void navigate({ to: "/auth" });
  }, [loading, session, navigate]);

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  if (loading || !session) {
    return <BrandLoading />;
  }

  return (
    <div className="min-h-screen bg-background">
      <aside className="no-print fixed inset-y-0 left-0 z-40 hidden w-60 flex-col border-r border-sidebar-border bg-sidebar px-3 py-5 lg:flex">
        <Brand />
        <nav className="mt-6 flex flex-1 flex-col gap-1">
          {visibleNav.map((item) => (
            <NavItem key={item.to} {...item} active={pathname === item.to} />
          ))}
          {isSuperAdmin ? (
            <NavItem
              to="/admin"
              label="Administração"
              icon={ShieldCheck}
              active={pathname === "/admin"}
            />
          ) : null}
        </nav>
        <Button
          variant="ghost"
          className="justify-start gap-2 text-muted-foreground"
          onClick={async () => {
            await supabase.auth.signOut();
            void navigate({ to: "/auth" });
          }}
        >
          <LogOut className="size-4" /> Sair
        </Button>
      </aside>

      <div className="lg:pl-60">
        <header className="no-print sticky top-0 z-30 border-b border-border bg-background/85 backdrop-blur">
          <div className="flex items-center gap-3 px-4 py-3 sm:px-6">
            <Button
              variant="ghost"
              size="icon"
              className="shrink-0 lg:hidden"
              onClick={() => setOpen((v) => !v)}
              aria-label="Abrir menu"
            >
              <Menu className="size-5" />
            </Button>
            <div className="min-w-0 flex-1">
              <h1 className="truncate text-base font-semibold tracking-tight sm:text-lg">
                {title}
              </h1>
              {subtitle ? (
                <p className="truncate text-xs text-muted-foreground">{subtitle}</p>
              ) : null}
            </div>
            {actions ? <div className="hidden shrink-0 sm:block">{actions}</div> : null}
          </div>
          {actions ? (
            <div className="flex justify-end overflow-x-auto px-4 pb-3 sm:hidden">{actions}</div>
          ) : null}

          {open ? (
            <nav className="grid gap-1 border-t border-border p-3 lg:hidden">
              {visibleNav.map((item) => (
                <NavItem key={item.to} {...item} active={pathname === item.to} />
              ))}
              {isSuperAdmin ? (
                <NavItem
                  to="/admin"
                  label="Administração"
                  icon={ShieldCheck}
                  active={pathname === "/admin"}
                />
              ) : null}
              <Button
                variant="ghost"
                className="justify-start gap-2 text-muted-foreground"
                onClick={async () => {
                  await supabase.auth.signOut();
                  void navigate({ to: "/auth" });
                }}
              >
                <LogOut className="size-4" /> Sair
              </Button>
            </nav>
          ) : null}
        </header>
        <main className="mx-auto w-full max-w-6xl px-4 pb-24 pt-5 sm:px-6 lg:pb-10">
          {access.data?.announcement ? (
            <div className="mb-4 flex gap-3 rounded-xl border border-warning/30 bg-warning/10 p-4 text-sm">
              <AlertTriangle className="size-5 shrink-0 text-warning" />
              <div>
                <p className="font-semibold">{access.data.announcement.title}</p>
                <p className="text-muted-foreground">{access.data.announcement.message}</p>
              </div>
            </div>
          ) : null}
          {moduleDisabled || commercialBlocked || maintenanceBlocked || updateBlocked ? (
            <div className="surface-card mx-auto mt-12 max-w-lg p-8 text-center">
              <ShieldCheck className="mx-auto size-10 text-muted-foreground" />
              <h2 className="mt-4 text-lg font-semibold">
                {updateBlocked
                  ? "Atualização necessária"
                  : maintenanceBlocked
                    ? access.data?.maintenance?.title
                    : commercialBlocked
                      ? "Assinatura requer atenção"
                      : "Módulo temporariamente indisponível"}
              </h2>
              <p className="mt-2 text-sm text-muted-foreground">
                {updateBlocked
                  ? access.data?.release?.notes || "Atualize o PWA para continuar usando o sistema."
                  : maintenanceBlocked
                    ? access.data?.maintenance?.message
                    : commercialBlocked
                      ? "Regularize a assinatura da sua organização para restaurar os módulos."
                      : "Este recurso foi desativado pela administração do sistema."}
              </p>
              <Button className="mt-5" onClick={() => void navigate({ to: "/dashboard" })}>
                Voltar ao dashboard
              </Button>
            </div>
          ) : (
            children
          )}
        </main>
      </div>

      <nav className="no-print fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t border-border bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden">
        {visibleNav.slice(0, 5).map(({ to, label, icon: Icon }) => (
          <Link
            key={to}
            to={to}
            className={cn(
              "flex min-w-0 flex-col items-center gap-1 px-1 py-2 text-[10px] font-medium",
              pathname === to ? "text-primary" : "text-muted-foreground",
            )}
          >
            <Icon className="size-5 shrink-0" />
            <span className="w-full truncate text-center">{label}</span>
          </Link>
        ))}
      </nav>
    </div>
  );
}

function versionIsOlder(current: string, minimum: string) {
  const left = current.split(".").map(Number);
  const right = minimum.split(".").map(Number);
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    if ((left[index] ?? 0) !== (right[index] ?? 0)) return (left[index] ?? 0) < (right[index] ?? 0);
  }
  return false;
}

function NavItem({
  to,
  label,
  icon: Icon,
  active,
}: {
  to: string;
  label: string;
  icon: typeof LayoutDashboard;
  active: boolean;
}) {
  return (
    <Link
      to={to}
      className={cn(
        "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
        active
          ? "bg-sidebar-accent text-sidebar-accent-foreground"
          : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
      )}
    >
      <Icon className="size-4" />
      {label}
    </Link>
  );
}

export function Brand() {
  return (
    <div className="flex items-center gap-2 px-2">
      <span className="brand-gradient grid size-9 place-items-center rounded-xl text-sm font-bold text-primary-foreground">
        DO
      </span>
      <div className="leading-tight">
        <p className="text-sm font-semibold">Delivery OS</p>
        <p className="text-[11px] text-muted-foreground">Gestão do entregador</p>
      </div>
    </div>
  );
}
