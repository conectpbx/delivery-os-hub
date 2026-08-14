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
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { BrandLoading } from "@/components/BrandLoader";

const nav = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/entregas", label: "Entregas", icon: RouteIcon },
  { to: "/financeiro", label: "Financeiro", icon: Wallet },
  { to: "/manutencao", label: "Manutenção", icon: Wrench },
  { to: "/metas", label: "Metas", icon: Target },
  { to: "/scanner", label: "Scanner IA", icon: ScanLine },
  { to: "/relatorios", label: "Relatórios", icon: FileBarChart },
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
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [open, setOpen] = useState(false);

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
          {nav.map((item) => (
            <NavItem key={item.to} {...item} active={pathname === item.to} />
          ))}
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
              <h1 className="truncate text-base font-semibold tracking-tight sm:text-lg">{title}</h1>
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
              {nav.map((item) => (
                <NavItem key={item.to} {...item} active={pathname === item.to} />
              ))}
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
        <main className="mx-auto w-full max-w-6xl px-4 pb-24 pt-5 sm:px-6 lg:pb-10">{children}</main>
      </div>

      <nav className="no-print fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t border-border bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden">
        {nav.slice(0, 5).map(({ to, label, icon: Icon }) => (
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
