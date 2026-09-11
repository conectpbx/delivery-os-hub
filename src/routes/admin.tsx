import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  Ban,
  Bot,
  CheckCircle2,
  Download,
  RefreshCw,
  Search,
  ShieldCheck,
  Smartphone,
  Truck,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { EmptyState, SectionCard, StatCard } from "@/components/ui-kit";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/hooks/useAuth";
import {
  adminRpc,
  type AdminUser,
  type AuditLog,
  type SystemModule,
  useAdminOverview,
  useAdminUsers,
  useAuditLogs,
  useIsAdmin,
  useSystemModules,
  useSystemSettings,
} from "@/lib/admin";
import { brl, dateTimeLabel } from "@/lib/format";

export const Route = createFileRoute("/admin")({
  head: () => ({
    meta: [
      { title: "Administração — Delivery OS" },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
  component: Admin,
});

function Admin() {
  const { user, loading: authLoading } = useAuth();
  const access = useIsAdmin(Boolean(user));
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState<string | null>(null);
  const overview = useAdminOverview(access.data === true);
  const users = useAdminUsers(search, access.data === true);
  const settings = useSystemSettings(access.data === true);
  const audit = useAuditLogs(access.data === true);
  const modules = useSystemModules(access.data === true);

  useEffect(() => {
    if (!authLoading && user && access.isFetched && access.data !== true) {
      toast.error("Acesso restrito aos administradores.");
      void navigate({ to: "/dashboard" });
    }
  }, [access.data, access.isFetched, authLoading, navigate, user]);

  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: ["admin"] });
    toast.success("Dados atualizados");
  }

  if (authLoading || access.isLoading || access.data !== true) {
    return (
      <AppShell title="Administração">
        <div className="h-72 animate-pulse rounded-xl bg-muted" />
      </AppShell>
    );
  }

  const o = overview.data;
  return (
    <AppShell
      title="Administração"
      subtitle="Controle seguro do SaaS e da experiência PWA"
      actions={
        <Button variant="outline" size="sm" className="gap-2" onClick={refresh}>
          <RefreshCw className="size-4" /> Atualizar
        </Button>
      }
    >
      <div className="mb-4 flex items-center gap-3 rounded-xl border border-primary/20 bg-primary/5 p-4">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground">
          <ShieldCheck className="size-5" />
        </span>
        <div>
          <p className="text-sm font-semibold">Central protegida por função e RLS</p>
          <p className="text-xs text-muted-foreground">
            Ações privilegiadas são validadas no banco e registradas na auditoria.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-5">
        <StatCard
          label="Usuários"
          value={String(o?.totalUsers ?? 0)}
          hint={`${o?.activeUsers30d ?? 0} ativos em 30 dias`}
          tone="primary"
          icon={<Users className="size-4" />}
        />
        <StatCard
          label="Entregas (30d)"
          value={String(o?.deliveries30d ?? 0)}
          icon={<Truck className="size-4" />}
        />
        <StatCard label="Receita (30d)" value={brl(o?.revenue30d ?? 0)} tone="success" />
        <StatCard
          label="Scans hoje"
          value={String(o?.scansToday ?? 0)}
          icon={<Bot className="size-4" />}
        />
        <StatCard
          label="Serviço"
          value={settings.data?.maintenance_mode ? "Manutenção" : "Operacional"}
          tone={settings.data?.maintenance_mode ? "warning" : "success"}
          icon={<Activity className="size-4" />}
        />
      </div>

      <Tabs defaultValue="users" className="mt-5">
        <TabsList className="grid h-auto w-full grid-cols-4 sm:w-fit">
          <TabsTrigger value="users">Usuários</TabsTrigger>
          <TabsTrigger value="system">Sistema & PWA</TabsTrigger>
          <TabsTrigger value="modules">Módulos</TabsTrigger>
          <TabsTrigger value="audit">Auditoria</TabsTrigger>
        </TabsList>
        <TabsContent value="users" className="mt-4">
          <SectionCard
            title="Gestão de acessos"
            description="Papéis, bloqueios e atividade das contas"
            actions={
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
                <Input
                  aria-label="Buscar usuário"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Nome ou e-mail"
                  className="h-9 w-48 pl-8 sm:w-64"
                />
              </div>
            }
          >
            {users.data?.length ? (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Usuário</TableHead>
                      <TableHead>Perfil</TableHead>
                      <TableHead>Atividade</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Ações</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {users.data.map((item) => (
                      <UserRow
                        key={item.user_id}
                        item={item}
                        currentUserId={user?.id}
                        saving={saving === item.user_id}
                        onChange={async (role, blocked) => {
                          setSaving(item.user_id);
                          try {
                            await adminRpc<void>("admin_set_user_access", {
                              _user_id: item.user_id,
                              _role: role,
                              _blocked: blocked,
                            });
                            await Promise.all([users.refetch(), audit.refetch()]);
                            toast.success("Acesso atualizado");
                          } catch (error) {
                            toast.error(
                              error instanceof Error
                                ? error.message
                                : "Não foi possível atualizar o acesso",
                            );
                          } finally {
                            setSaving(null);
                          }
                        }}
                      />
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : (
              <EmptyState>
                {users.isLoading ? "Carregando usuários..." : "Nenhum usuário encontrado."}
              </EmptyState>
            )}
          </SectionCard>
        </TabsContent>
        <TabsContent value="system" className="mt-4">
          <SettingsPanel
            data={settings.data}
            onSaved={async () => {
              await Promise.all([settings.refetch(), audit.refetch()]);
            }}
          />
        </TabsContent>
        <TabsContent value="modules" className="mt-4">
          <ModulesPanel
            modules={modules.data ?? []}
            onSaved={async () => {
              await Promise.all([modules.refetch(), audit.refetch()]);
              await queryClient.invalidateQueries({ queryKey: ["system"] });
            }}
          />
        </TabsContent>
        <TabsContent value="audit" className="mt-4">
          <AuditPanel logs={audit.data ?? []} />
        </TabsContent>
      </Tabs>
    </AppShell>
  );
}

function UserRow({
  item,
  currentUserId,
  saving,
  onChange,
}: {
  item: AdminUser;
  currentUserId: string | undefined;
  saving: boolean;
  onChange: (role: "super_admin" | "admin" | "user", blocked: boolean) => Promise<void>;
}) {
  return (
    <TableRow>
      <TableCell>
        <p className="font-medium">{item.full_name || "Sem nome"}</p>
        <p className="text-xs text-muted-foreground">{item.email}</p>
      </TableCell>
      <TableCell>
        <Badge variant={item.role !== "user" ? "default" : "secondary"}>
          {item.role === "super_admin"
            ? "Super admin"
            : item.role === "admin"
              ? "Administrador"
              : "Usuário"}
        </Badge>
      </TableCell>
      <TableCell>
        <p className="text-sm">{item.delivery_count} entregas</p>
        <p className="text-xs text-muted-foreground">
          {item.last_sign_in_at ? dateTimeLabel(item.last_sign_in_at) : "Nunca acessou"}
        </p>
      </TableCell>
      <TableCell>
        {item.is_blocked ? (
          <Badge variant="destructive">Bloqueado</Badge>
        ) : (
          <Badge variant="outline" className="text-success">
            <CheckCircle2 className="mr-1 size-3" /> Ativo
          </Badge>
        )}
      </TableCell>
      <TableCell className="text-right">
        <div className="flex justify-end gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={saving || item.user_id === currentUserId}
            onClick={() =>
              onChange(
                item.role === "user" ? "admin" : item.role === "admin" ? "super_admin" : "user",
                item.is_blocked,
              )
            }
          >
            {item.role === "user"
              ? "Tornar admin"
              : item.role === "admin"
                ? "Tornar super admin"
                : "Remover privilégio"}
          </Button>
          <Button
            size="sm"
            variant={item.is_blocked ? "outline" : "destructive"}
            disabled={saving || item.user_id === currentUserId}
            onClick={() => onChange(item.role, !item.is_blocked)}
          >
            <Ban className="mr-1 size-3" />
            {item.is_blocked ? "Desbloquear" : "Bloquear"}
          </Button>
        </div>
      </TableCell>
    </TableRow>
  );
}

function SettingsPanel({
  data,
  onSaved,
}: {
  data: ReturnType<typeof useSystemSettings>["data"];
  onSaved: () => Promise<void>;
}) {
  const initial = useMemo(
    () => ({
      app_name: data?.app_name ?? "Delivery OS",
      support_email: data?.support_email ?? "",
      maintenance_mode: data?.maintenance_mode ?? false,
      allow_registrations: data?.allow_registrations ?? true,
      ai_daily_limit: data?.ai_daily_limit ?? 5,
    }),
    [data],
  );
  const [form, setForm] = useState(initial);
  const [saving, setSaving] = useState(false);
  useEffect(() => setForm(initial), [initial]);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await adminRpc("admin_update_settings", {
        _app_name: form.app_name,
        _support_email: form.support_email,
        _maintenance_mode: form.maintenance_mode,
        _allow_registrations: form.allow_registrations,
        _ai_daily_limit: Number(form.ai_daily_limit),
      });
      await onSaved();
      toast.success("Configurações publicadas");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao salvar");
    } finally {
      setSaving(false);
    }
  }
  return (
    <form onSubmit={submit} className="grid gap-4 lg:grid-cols-2">
      <SectionCard title="Identidade do PWA" description="Dados centrais da aplicação instalável">
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="app-name">Nome da aplicação</Label>
            <Input
              id="app-name"
              minLength={2}
              maxLength={60}
              required
              value={form.app_name}
              onChange={(e) => setForm({ ...form, app_name: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="support-email">E-mail de suporte</Label>
            <Input
              id="support-email"
              type="email"
              maxLength={254}
              value={form.support_email}
              onChange={(e) => setForm({ ...form, support_email: e.target.value })}
            />
          </div>
          <div className="rounded-lg bg-muted p-3 text-xs text-muted-foreground">
            <Smartphone className="mb-2 size-5 text-primary" />
            As configurações ficam centralizadas e prontas para consumo pelo PWA sem expor
            credenciais administrativas.
          </div>
        </div>
      </SectionCard>
      <SectionCard title="Operação e limites" description="Controles globais do serviço">
        <div className="space-y-5">
          <Toggle
            label="Modo de manutenção"
            description="Sinaliza uma janela operacional para toda a plataforma."
            checked={form.maintenance_mode}
            onChange={(value) => setForm({ ...form, maintenance_mode: value })}
          />
          <Toggle
            label="Permitir novos cadastros"
            description="Controle central da abertura de novas contas."
            checked={form.allow_registrations}
            onChange={(value) => setForm({ ...form, allow_registrations: value })}
          />
          <div className="space-y-2">
            <Label htmlFor="ai-limit">Scans de IA por usuário/dia</Label>
            <Input
              id="ai-limit"
              type="number"
              min={0}
              max={100}
              value={form.ai_daily_limit}
              onChange={(e) => setForm({ ...form, ai_daily_limit: Number(e.target.value) })}
            />
          </div>
          <Button className="w-full" disabled={saving}>
            {saving ? "Publicando..." : "Salvar e publicar"}
          </Button>
        </div>
      </SectionCard>
    </form>
  );
}

function Toggle({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div>
        <Label>{label}</Label>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

function ModulesPanel({
  modules,
  onSaved,
}: {
  modules: SystemModule[];
  onSaved: () => Promise<void>;
}) {
  const [saving, setSaving] = useState<string | null>(null);

  async function updateModule(module: SystemModule, enabled: boolean) {
    setSaving(module.key);
    try {
      await adminRpc("super_admin_update_module", { _key: module.key, _enabled: enabled });
      await onSaved();
      toast.success(`${module.name} ${enabled ? "ativado" : "desativado"}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao atualizar módulo");
    } finally {
      setSaving(null);
    }
  }

  return (
    <SectionCard
      title="Controle de módulos"
      description="Disponibilize recursos para todo o ecossistema sem publicar uma nova versão"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        {modules.map((module) => (
          <div
            key={module.key}
            className="flex items-center justify-between gap-4 rounded-xl border p-4"
          >
            <div>
              <div className="flex items-center gap-2">
                <p className="text-sm font-semibold">{module.name}</p>
                <Badge variant={module.enabled ? "outline" : "secondary"}>
                  {module.enabled ? "Ativo" : "Indisponível"}
                </Badge>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{module.description}</p>
            </div>
            <Switch
              aria-label={`${module.enabled ? "Desativar" : "Ativar"} ${module.name}`}
              checked={module.enabled}
              disabled={saving === module.key}
              onCheckedChange={(enabled) => void updateModule(module, enabled)}
            />
          </div>
        ))}
      </div>
    </SectionCard>
  );
}

function AuditPanel({ logs }: { logs: AuditLog[] }) {
  function exportCsv() {
    const rows = [
      "data,acao,ator,alvo",
      ...logs.map((log) =>
        [log.created_at, log.action, log.actor_id ?? "", log.target_id ?? ""]
          .map((v) => `"${String(v).replaceAll('"', '""')}"`)
          .join(","),
      ),
    ];
    const url = URL.createObjectURL(
      new Blob([rows.join("\n")], { type: "text/csv;charset=utf-8" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `delivery-os-auditoria-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }
  return (
    <SectionCard
      title="Trilha de auditoria"
      description="Últimas 50 ações administrativas"
      actions={
        <Button
          size="sm"
          variant="outline"
          className="gap-2"
          disabled={!logs.length}
          onClick={exportCsv}
        >
          <Download className="size-4" /> Exportar CSV
        </Button>
      }
    >
      {logs.length ? (
        <div className="space-y-2">
          {logs.map((log) => (
            <div key={log.id} className="flex items-start gap-3 rounded-lg border p-3">
              <span className="mt-0.5 grid size-8 place-items-center rounded-lg bg-muted">
                <ShieldCheck className="size-4" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">
                  {log.action === "settings.updated"
                    ? "Configurações atualizadas"
                    : "Acesso de usuário atualizado"}
                </p>
                <p className="break-all text-xs text-muted-foreground">
                  Ator: {log.actor_id ?? "sistema"}
                  {log.target_id ? ` · Alvo: ${log.target_id}` : ""}
                </p>
              </div>
              <time className="text-xs text-muted-foreground">{dateTimeLabel(log.created_at)}</time>
            </div>
          ))}
        </div>
      ) : (
        <EmptyState>Nenhuma ação administrativa registrada.</EmptyState>
      )}
    </SectionCard>
  );
}
