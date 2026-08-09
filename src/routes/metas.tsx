import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { EmptyState, SectionCard, StatCard } from "@/components/ui-kit";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  useDeliveries,
  useExpenses,
  useFuelings,
  useGoals,
  useInsert,
  useMaintenances,
  useProfile,
  useRemove,
  useUpsertProfile,
} from "@/lib/data";
import { brl, monthKey, monthLabel, num } from "@/lib/format";
import { byMonth, costPerKm } from "@/lib/metrics";

export const Route = createFileRoute("/metas")({
  head: () => ({
    meta: [
      { title: "Planejamento de metas — Delivery OS" },
      {
        name: "description",
        content:
          "Defina metas mensais de receita, lucro e número de entregas e acompanhe o progresso em tempo real.",
      },
      { property: "og:title", content: "Planejamento de metas — Delivery OS" },
      {
        property: "og:description",
        content: "Metas diárias e mensais para o entregador bater seus objetivos.",
      },
    ],
  }),
  component: Metas,
});

function Metas() {
  const goals = useGoals();
  const add = useInsert("goals", "goals");
  const del = useRemove("goals", "goals");
  const profile = useProfile();
  const saveProfile = useUpsertProfile();
  const deliveries = useDeliveries();
  const expenses = useExpenses();
  const fuelings = useFuelings();
  const maintenances = useMaintenances();

  const cpk = costPerKm(fuelings.data ?? [], profile.data);
  const months = byMonth(deliveries.data ?? [], expenses.data ?? [], cpk);
  const current = monthKey(new Date());
  const currentSummary = months.find((m) => m.month === current);

  const [form, setForm] = useState({
    month: current,
    revenue_target: "",
    profit_target: "",
    deliveries_target: "",
  });
  const [daily, setDaily] = useState("");

  void maintenances;

  return (
    <AppShell title="Metas" subtitle="Planejamento mensal e acompanhamento diário">
      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard label="Receita do mês" value={brl(currentSummary?.revenue ?? 0)} tone="primary" />
        <StatCard label="Lucro do mês" value={brl(currentSummary?.profit ?? 0)} tone="success" />
        <StatCard label="Entregas no mês" value={String(currentSummary?.count ?? 0)} />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[380px_1fr]">
        <SectionCard title="Nova meta mensal">
          <form
            className="space-y-3"
            onSubmit={async (e) => {
              e.preventDefault();
              await add.mutateAsync({
                month: `${form.month}-01`,
                revenue_target: Number(form.revenue_target || 0),
                profit_target: Number(form.profit_target || 0),
                deliveries_target: Number(form.deliveries_target || 0),
              });
              setForm({ ...form, revenue_target: "", profit_target: "", deliveries_target: "" });
              toast.success("Meta criada");
            }}
          >
            <div className="space-y-2">
              <Label className="text-xs">Mês</Label>
              <Input type="month" value={form.month} onChange={(e) => setForm({ ...form, month: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label className="text-xs">Meta de receita (R$)</Label>
              <Input value={form.revenue_target} onChange={(e) => setForm({ ...form, revenue_target: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label className="text-xs">Meta de lucro (R$)</Label>
              <Input value={form.profit_target} onChange={(e) => setForm({ ...form, profit_target: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label className="text-xs">Meta de entregas</Label>
              <Input
                value={form.deliveries_target}
                onChange={(e) => setForm({ ...form, deliveries_target: e.target.value })}
              />
            </div>
            <Button type="submit" className="w-full">
              Salvar meta
            </Button>
          </form>

          <form
            className="mt-6 space-y-2 border-t border-border pt-4"
            onSubmit={async (e) => {
              e.preventDefault();
              await saveProfile.mutateAsync({ daily_goal: Number(daily || 0) });
              toast.success("Meta diária atualizada");
            }}
          >
            <Label className="text-xs">Meta diária de receita (R$)</Label>
            <div className="flex gap-2">
              <Input
                value={daily}
                placeholder={String(profile.data?.daily_goal ?? 200)}
                onChange={(e) => setDaily(e.target.value)}
              />
              <Button type="submit" variant="secondary">
                Salvar
              </Button>
            </div>
          </form>
        </SectionCard>

        <SectionCard title="Progresso das metas">
          {(goals.data ?? []).length ? (
            <ul className="space-y-5">
              {(goals.data ?? []).map((g) => {
                const key = g.month.slice(0, 7);
                const m = months.find((x) => x.month === key);
                const rows = [
                  { label: "Receita", value: m?.revenue ?? 0, target: Number(g.revenue_target), money: true },
                  { label: "Lucro", value: m?.profit ?? 0, target: Number(g.profit_target), money: true },
                  { label: "Entregas", value: m?.count ?? 0, target: Number(g.deliveries_target), money: false },
                ];
                return (
                  <li key={g.id} className="rounded-xl border border-border p-4">
                    <div className="mb-3 flex items-center justify-between">
                      <p className="text-sm font-semibold">{monthLabel(key)}</p>
                      <Button variant="ghost" size="sm" onClick={() => del.mutate(g.id)}>
                        Remover
                      </Button>
                    </div>
                    <div className="space-y-3">
                      {rows.map((r) => {
                        const pct = r.target ? Math.min(100, (r.value / r.target) * 100) : 0;
                        return (
                          <div key={r.label}>
                            <div className="flex justify-between text-xs text-muted-foreground">
                              <span>{r.label}</span>
                              <span>
                                {r.money ? brl(r.value) : num(r.value, 0)} /{" "}
                                {r.money ? brl(r.target) : num(r.target, 0)} · {num(pct, 0)}%
                              </span>
                            </div>
                            <Progress value={pct} className="mt-1 h-2" />
                          </div>
                        );
                      })}
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <EmptyState>Nenhuma meta cadastrada.</EmptyState>
          )}
        </SectionCard>
      </div>
    </AppShell>
  );
}
