import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  CalendarClock,
  CheckCircle2,
  Pencil,
  Sparkles,
  Target,
  TrendingUp,
  Trash2,
} from "lucide-react";
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
  useProfile,
  useRemove,
  useUpdate,
  useUpsertProfile,
} from "@/lib/data";
import { brl, dec, monthKey, monthLabel, num } from "@/lib/format";
import { useGoalCelebrations } from "@/lib/celebrate";
import {
  adaptiveDailyRevenueGoal,
  byMonth,
  costPerKm,
  goalPerformanceAnalysis,
} from "@/lib/metrics";
import { useCalendarNow } from "@/hooks/useCalendarNow";

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
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Metas,
});

const REVENUE_PRESETS = [3000, 5000, 7500, 10000];

function Metas() {
  const now = useCalendarNow();
  const goals = useGoals();
  const add = useInsert("goals", "goals");
  const update = useUpdate<Record<string, unknown>>("goals", "goals");
  const del = useRemove("goals", "goals");
  const profile = useProfile();
  const saveProfile = useUpsertProfile();
  const deliveries = useDeliveries();
  const expenses = useExpenses();
  const fuelings = useFuelings();

  const cpk = useMemo(
    () => costPerKm(fuelings.data ?? [], profile.data),
    [fuelings.data, profile.data],
  );
  const months = useMemo(
    () => byMonth(deliveries.data ?? [], expenses.data ?? [], cpk),
    [deliveries.data, expenses.data, cpk],
  );
  const current = monthKey(now);
  const currentSummary = months.find((m) => m.month === current);
  const currentGoals = (goals.data ?? []).filter((goal) => goal.month.slice(0, 7) === current);
  const sortedGoals = useMemo(
    () => [...(goals.data ?? [])].sort((a, b) => b.month.localeCompare(a.month)),
    [goals.data],
  );
  const performance = useMemo(
    () => goalPerformanceAnalysis(deliveries.data ?? [], now),
    [deliveries.data, now],
  );
  const dailyGoalPlan = useMemo(
    () =>
      adaptiveDailyRevenueGoal({
        deliveries: deliveries.data ?? [],
        goals: goals.data ?? [],
        profile: profile.data,
        date: now,
      }),
    [deliveries.data, goals.data, profile.data, now],
  );

  const [form, setForm] = useState({
    month: current,
    revenue_target: "",
    profit_target: "",
    deliveries_target: "",
  });
  const [daily, setDaily] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const previousCurrent = useRef(current);
  const formRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previous = previousCurrent.current;
    if (previous !== current) {
      setForm((value) => (value.month === previous ? { ...value, month: current } : value));
      previousCurrent.current = current;
    }
  }, [current]);

  const existingGoal = (goals.data ?? []).find((g) => g.month.slice(0, 7) === form.month);

  const history = useMemo(() => {
    const past = months.filter((m) => m.month < current && m.revenue > 0).slice(-3);
    if (!past.length) return null;
    const revenue = past.reduce((s, m) => s + m.revenue, 0) / past.length;
    const profit = past.reduce((s, m) => s + m.profit, 0) / past.length;
    const count = past.reduce((s, m) => s + m.count, 0) / past.length;
    return { revenue, profit, count, margin: revenue > 0 ? profit / revenue : 0.7 };
  }, [months, current]);

  const revenueValue = dec(form.revenue_target);
  const profitValue = dec(form.profit_target);
  const deliveriesValue = dec(form.deliveries_target);

  const [year, monthNum] = form.month.split("-").map(Number);
  const daysInMonth = new Date(year ?? 2026, monthNum ?? 1, 0).getDate() || 30;
  const perDay = revenueValue > 0 ? revenueValue / daysInMonth : 0;
  const perDayDeliveries = deliveriesValue > 0 ? deliveriesValue / daysInMonth : 0;

  const invalidProfit = revenueValue > 0 && profitValue > revenueValue;
  const canSubmit = revenueValue > 0 && !invalidProfit && !add.isPending && !update.isPending;

  function applyRevenue(value: number) {
    const margin = history?.margin ?? 0.7;
    const ticket = history && history.count > 0 ? history.revenue / history.count : 12;
    setForm((f) => ({
      ...f,
      revenue_target: String(Math.round(value)),
      profit_target: String(Math.round(value * margin)),
      deliveries_target: String(Math.max(1, Math.round(value / ticket))),
    }));
  }

  function editGoal(goal: (typeof sortedGoals)[number]) {
    setForm({
      month: goal.month.slice(0, 7),
      revenue_target: String(Number(goal.revenue_target)),
      profit_target: String(Number(goal.profit_target)),
      deliveries_target: String(Number(goal.deliveries_target)),
    });
    requestAnimationFrame(() =>
      formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }),
    );
  }

  useGoalCelebrations(
    currentGoals.flatMap((g) => {
      const key = g.month.slice(0, 7);
      const m = months.find((x) => x.month === key);
      return [
        {
          id: `meta-${g.id}-receita`,
          label: `Receita de ${monthLabel(key)}`,
          value: m?.revenue ?? 0,
          target: Number(g.revenue_target),
        },
        {
          id: `meta-${g.id}-lucro`,
          label: `Lucro de ${monthLabel(key)}`,
          value: m?.profit ?? 0,
          target: Number(g.profit_target),
        },
        {
          id: `meta-${g.id}-entregas`,
          label: `Entregas de ${monthLabel(key)}`,
          value: m?.count ?? 0,
          target: Number(g.deliveries_target),
        },
      ];
    }),
  );

  return (
    <AppShell title="Metas" subtitle="Planejamento mensal e acompanhamento diário">
      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard label="Receita do mês" value={brl(currentSummary?.revenue ?? 0)} tone="primary" />
        <StatCard label="Lucro do mês" value={brl(currentSummary?.profit ?? 0)} tone="success" />
        <StatCard label="Entregas no mês" value={String(currentSummary?.count ?? 0)} />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[400px_1fr]">
        <div ref={formRef}>
          <SectionCard
            title={existingGoal ? `Editar meta de ${monthLabel(form.month)}` : "Nova meta mensal"}
            description="Escolha o mês, defina a receita e o restante é sugerido automaticamente."
          >
            <form
              className="space-y-4"
              onSubmit={async (e) => {
                e.preventDefault();
                if (!canSubmit) return;
                const values = {
                  revenue_target: revenueValue,
                  profit_target: profitValue,
                  deliveries_target: Math.round(deliveriesValue),
                };
                try {
                  if (existingGoal) {
                    await update.mutateAsync({ id: existingGoal.id, values });
                    toast.success(`Meta de ${monthLabel(form.month)} atualizada`);
                  } else {
                    await add.mutateAsync({ month: `${form.month}-01`, ...values });
                    toast.success(`Meta de ${monthLabel(form.month)} criada`);
                  }
                  setForm((f) => ({
                    ...f,
                    revenue_target: "",
                    profit_target: "",
                    deliveries_target: "",
                  }));
                } catch {
                  toast.error("Não foi possível salvar a meta");
                }
              }}
            >
              <div className="space-y-2">
                <Label className="text-xs">Mês</Label>
                <Input
                  type="month"
                  value={form.month}
                  onChange={(e) => setForm({ ...form, month: e.target.value })}
                />
                {existingGoal ? (
                  <p className="flex items-center gap-1 text-xs text-primary">
                    <CheckCircle2 className="size-3.5" /> Já existe meta neste mês — salvar irá
                    atualizá-la.
                  </p>
                ) : null}
              </div>

              <div className="space-y-2">
                <Label className="text-xs">Meta de receita (R$)</Label>
                <Input
                  inputMode="decimal"
                  placeholder="Ex.: 6.000"
                  value={form.revenue_target}
                  onChange={(e) => setForm({ ...form, revenue_target: e.target.value })}
                />
                <div className="flex flex-wrap gap-1.5">
                  {REVENUE_PRESETS.map((v) => (
                    <Button
                      key={v}
                      type="button"
                      size="sm"
                      variant="secondary"
                      className="h-7 px-2 text-xs"
                      onClick={() => applyRevenue(v)}
                    >
                      {brl(v)}
                    </Button>
                  ))}
                  {history ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-7 gap-1 px-2 text-xs"
                      onClick={() => applyRevenue(history.revenue * 1.1)}
                    >
                      <Sparkles className="size-3" /> Sugerir (+10%)
                    </Button>
                  ) : null}
                  {performance.suggestedRevenueTarget > 0 ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-7 gap-1 px-2 text-xs"
                      onClick={() => applyRevenue(performance.suggestedRevenueTarget)}
                    >
                      <TrendingUp className="size-3" /> Meta pelo seu ritmo
                    </Button>
                  ) : null}
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label className="text-xs">Meta de lucro (R$)</Label>
                  <Input
                    inputMode="decimal"
                    placeholder="Ex.: 4.200"
                    value={form.profit_target}
                    onChange={(e) => setForm({ ...form, profit_target: e.target.value })}
                  />
                  {invalidProfit ? (
                    <p className="text-xs text-destructive">O lucro não pode superar a receita.</p>
                  ) : null}
                </div>
                <div className="space-y-2">
                  <Label className="text-xs">Meta de entregas</Label>
                  <Input
                    inputMode="numeric"
                    placeholder="Ex.: 420"
                    value={form.deliveries_target}
                    onChange={(e) => setForm({ ...form, deliveries_target: e.target.value })}
                  />
                </div>
              </div>

              {revenueValue > 0 ? (
                <div className="rounded-xl border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
                  <p className="flex items-center gap-1 font-semibold text-foreground">
                    <Target className="size-3.5" /> Como fica o seu dia
                  </p>
                  <p className="mt-1">
                    {brl(perDay)} por dia em {daysInMonth} dias
                    {perDayDeliveries > 0 ? ` · ${num(perDayDeliveries, 1)} entregas/dia` : ""}
                  </p>
                </div>
              ) : null}

              <Button type="submit" className="w-full" disabled={!canSubmit}>
                {add.isPending || update.isPending
                  ? "Salvando..."
                  : existingGoal
                    ? "Atualizar meta"
                    : "Salvar meta"}
              </Button>
            </form>

            <form
              className="mt-6 space-y-2 border-t border-border pt-4"
              onSubmit={async (e) => {
                e.preventDefault();
                await saveProfile.mutateAsync({ daily_goal: dec(daily) });
                setDaily("");
                toast.success("Meta diária atualizada");
              }}
            >
              <Label className="text-xs">Meta diária de receita (R$)</Label>
              <div className="flex gap-2">
                <Input
                  inputMode="decimal"
                  value={daily}
                  placeholder={String(profile.data?.daily_goal ?? 200)}
                  onChange={(e) => setDaily(e.target.value)}
                />
                <Button type="submit" variant="secondary" disabled={saveProfile.isPending}>
                  Salvar
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Atual: {brl(Number(profile.data?.daily_goal ?? 0))}
              </p>
            </form>

            {dailyGoalPlan.monthTarget > 0 ? (
              <div className="mt-4 rounded-xl border border-primary/20 bg-primary/5 p-3 text-sm">
                <p className="flex items-center gap-1 font-semibold text-foreground">
                  <CalendarClock className="size-4" /> Meta diária inteligente
                </p>
                <p className="mt-1 text-muted-foreground">
                  Para compensar dias abaixo da meta e ainda bater {brl(dailyGoalPlan.monthTarget)}{" "}
                  no mês, mire em
                  <span className="font-semibold text-foreground">
                    {" "}
                    {brl(dailyGoalPlan.target)}
                  </span>{" "}
                  por dia nos próximos
                  <span className="font-semibold text-foreground">
                    {" "}
                    {dailyGoalPlan.remainingDaysIncludingToday}
                  </span>{" "}
                  {dailyGoalPlan.usesWorkPattern ? " dias de trabalho." : " dias."}
                </p>
                <p className="mt-2 text-xs text-muted-foreground">
                  O cálculo considera {brl(dailyGoalPlan.revenueBeforeToday)} já feitos antes de
                  hoje e redistribui o faltante automaticamente
                  {dailyGoalPlan.usesWorkPattern
                    ? " conforme os dias em que você costuma trabalhar."
                    : "."}
                </p>
              </div>
            ) : null}
          </SectionCard>
        </div>

        <div className="space-y-4">
          <SectionCard
            title="Análise de desempenho"
            description="Projeção baseada nos registros disponíveis, sem misturar meses."
          >
            {performance.currentRevenue > 0 || performance.completedMonths > 0 ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-lg border border-border p-3">
                  <p className="text-xs text-muted-foreground">Projeção deste mês</p>
                  <p className="mt-1 text-lg font-semibold text-primary">
                    {brl(performance.projectedRevenue)}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Mantendo o ritmo atual até o fim do mês.
                  </p>
                </div>
                <div className="rounded-lg border border-border p-3">
                  <p className="text-xs text-muted-foreground">Comparação histórica</p>
                  <p className="mt-1 text-lg font-semibold">
                    {performance.changeVsPreviousPercent === null
                      ? "Histórico em formação"
                      : `${performance.changeVsPreviousPercent >= 0 ? "+" : ""}${num(performance.changeVsPreviousPercent, 0)}%`}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Média dos últimos {performance.completedMonths} meses:{" "}
                    {brl(performance.previousAverageRevenue)}.
                  </p>
                </div>
                <div className="rounded-lg border border-border p-3 sm:col-span-2">
                  <p className="flex items-center gap-1 text-xs font-semibold text-foreground">
                    <Sparkles className="size-3.5 text-primary" /> Sugestão para melhorar
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {performance.bestWeekday
                      ? `Seu melhor dia histórico é ${performance.bestWeekday}, com média de ${brl(performance.bestWeekdayAverage)}. Priorize esse dia e use “Meta pelo seu ritmo” para planejar um avanço sustentável de 10%.`
                      : "Continue registrando suas entregas. Assim que houver histórico suficiente, o sistema identificará seus melhores dias e sugerirá uma meta personalizada."}
                  </p>
                </div>
              </div>
            ) : (
              <EmptyState>
                Registre entregas para receber projeções e sugestões personalizadas.
              </EmptyState>
            )}
          </SectionCard>

          <SectionCard
            title="Metas cadastradas"
            description={`${sortedGoals.length} ${sortedGoals.length === 1 ? "meta cadastrada" : "metas cadastradas"}`}
          >
            {sortedGoals.length ? (
              <ul className="space-y-5">
                {sortedGoals.map((g) => {
                  const key = g.month.slice(0, 7);
                  const m = months.find((x) => x.month === key);
                  const rows = [
                    {
                      label: "Receita",
                      value: m?.revenue ?? 0,
                      target: Number(g.revenue_target),
                      money: true,
                    },
                    {
                      label: "Lucro",
                      value: m?.profit ?? 0,
                      target: Number(g.profit_target),
                      money: true,
                    },
                    {
                      label: "Entregas",
                      value: m?.count ?? 0,
                      target: Number(g.deliveries_target),
                      money: false,
                    },
                  ];
                  return (
                    <li
                      key={g.id}
                      className={`rounded-lg border p-4 ${form.month === key ? "border-primary bg-primary/5" : "border-border"}`}
                    >
                      <div className="mb-3 flex items-center justify-between gap-2">
                        <p className="text-sm font-semibold">
                          {monthLabel(key)}
                          {key === current ? (
                            <span className="ml-2 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium uppercase text-primary">
                              Mês atual
                            </span>
                          ) : null}
                          {key < current ? (
                            <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium uppercase text-muted-foreground">
                              Encerrada
                            </span>
                          ) : null}
                          {key > current ? (
                            <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium uppercase text-muted-foreground">
                              Planejada
                            </span>
                          ) : null}
                        </p>
                        <div className="flex items-center gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="gap-1"
                            onClick={() => editGoal(g)}
                          >
                            <Pencil className="size-3.5" /> Editar
                          </Button>
                          {confirmDelete === g.id ? (
                            <>
                              <Button
                                variant="destructive"
                                size="sm"
                                onClick={() => {
                                  del.mutate(g.id);
                                  setConfirmDelete(null);
                                }}
                              >
                                Confirmar
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setConfirmDelete(null)}
                              >
                                Cancelar
                              </Button>
                            </>
                          ) : (
                            <Button
                              variant="ghost"
                              size="sm"
                              aria-label="Remover meta"
                              onClick={() => setConfirmDelete(g.id)}
                            >
                              <Trash2 className="size-4" />
                            </Button>
                          )}
                        </div>
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
      </div>
    </AppShell>
  );
}
