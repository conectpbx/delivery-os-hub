import { createFileRoute } from "@tanstack/react-router";
import { Suspense, lazy, useMemo, useState } from "react";

const RevenueAreaChart = lazy(() => import("@/components/charts/RevenueAreaChart"));
import { Banknote, Fuel, Gauge, Timer, TrendingUp } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { EmptyState, SectionCard, StatCard } from "@/components/ui-kit";
import { SmartAlerts } from "@/components/SmartAlerts";
import { Button } from "@/components/ui/button";
import {
  useDeliveries,
  useExpenses,
  useFuelings,
  useGoals,
  useMaintenances,
  useProfile,
} from "@/lib/data";
import { brl, dateLabel, dateTimeLabel, minutesLabel, num, paymentMethodLabel } from "@/lib/format";
import { useGoalCelebrations } from "@/lib/celebrate";
import { useSmartAlerts } from "@/lib/alerts";
import {
  adaptiveDailyRevenueGoal,
  byApp,
  costPerKm,
  endOfDay,
  heatmap,
  inRange,
  startOfDay,
  summarize,
} from "@/lib/metrics";
import { useChainedDistance } from "@/lib/chained-distance";

export const Route = createFileRoute("/dashboard")({
  head: () => ({
    meta: [
      { title: "Dashboard do entregador — Delivery OS" },
      {
        name: "description",
        content:
          "Receita diária, lucro real, custos, quilometragem, tempo parado, ranking de aplicativos e mapa de calor de entregas.",
      },
      { property: "og:title", content: "Dashboard do entregador — Delivery OS" },
      {
        property: "og:description",
        content: "Acompanhe lucro real, custos e desempenho das suas entregas em tempo real.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Dashboard,
});

const RANGES = [
  { key: "1", label: "Hoje", days: 1 },
  { key: "7", label: "7 dias", days: 7 },
  { key: "30", label: "30 dias", days: 30 },
] as const;

const WEEKDAYS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

function Dashboard() {
  const [range, setRange] = useState<(typeof RANGES)[number]>(RANGES[0]);
  const deliveries = useDeliveries();
  const fuelings = useFuelings();
  const expenses = useExpenses();
  const maintenances = useMaintenances();
  const profile = useProfile();
  const goals = useGoals();

  const deliveriesData = useMemo(() => deliveries.data ?? [], [deliveries.data]);
  const expensesData = useMemo(() => expenses.data ?? [], [expenses.data]);
  const fuelingsData = useMemo(() => fuelings.data ?? [], [fuelings.data]);
  const maintenancesData = useMemo(() => maintenances.data ?? [], [maintenances.data]);

  const cpk = useMemo(() => costPerKm(fuelingsData, profile.data), [fuelingsData, profile.data]);
  const { from, to } = useMemo(() => {
    const now = Date.now();
    return {
      from: startOfDay(new Date(now - (range.days - 1) * 86400000)),
      to: endOfDay(new Date(now)),
    };
  }, [range.days]);

  const periodDeliveries = useMemo(
    () => deliveriesData.filter((d) => inRange(d.occurred_at, from, to)),
    [deliveriesData, from, to],
  );
  const periodExpenses = useMemo(
    () => expensesData.filter((e) => inRange(e.occurred_at, from, to)),
    [expensesData, from, to],
  );
  const periodMaint = useMemo(
    () => maintenancesData.filter((m) => inRange(m.performed_at, from, to)),
    [maintenancesData, from, to],
  );
  const s = useMemo(
    () => summarize(periodDeliveries, periodExpenses, periodMaint, cpk),
    [periodDeliveries, periodExpenses, periodMaint, cpk],
  );
  const ranking = useMemo(() => byApp(periodDeliveries, cpk), [periodDeliveries, cpk]);
  const { chainKm, km: periodKm } = useChainedDistance(periodDeliveries);
  const { grid, max } = useMemo(() => heatmap(deliveriesData), [deliveriesData]);

  const series = useMemo(() => {
    const days: { day: string; receita: number; lucro: number }[] = [];
    for (let i = range.days - 1; i >= 0; i--) {
      const d = new Date(Date.now() - i * 86400000);
      const dayFrom = startOfDay(d);
      const dayTo = endOfDay(d);
      const dd = deliveriesData.filter((x) => inRange(x.occurred_at, dayFrom, dayTo));
      const de = expensesData.filter((x) => inRange(x.occurred_at, dayFrom, dayTo));
      const sum = summarize(dd, de, [], cpk);
      days.push({ day: dateLabel(d.toISOString()), receita: sum.revenue, lucro: sum.profit });
    }
    return days;
  }, [deliveriesData, expensesData, cpk, range.days]);

  const dailyGoalPlan = adaptiveDailyRevenueGoal({
    deliveries: deliveriesData,
    goals: goals.data ?? [],
    profile: profile.data,
  });
  const dailyGoal = dailyGoalPlan.target || Number(profile.data?.daily_goal ?? 200);
  const todayRevenue = summarize(
    deliveriesData.filter((d) => inRange(d.occurred_at, startOfDay(), endOfDay())),
    [],
    [],
    cpk,
  ).revenue;

  useGoalCelebrations([
    {
      id: `diaria-${new Date().toISOString().slice(0, 10)}-receita`,
      label: "Meta diária de receita",
      value: todayRevenue,
      target: dailyGoal,
    },
  ]);

  const smartAlerts = useSmartAlerts({
    deliveries: deliveriesData,
    fuelings: fuelingsData,
    maintenances: maintenancesData,
    expenses: expensesData,
    goals: goals.data ?? [],
    profile: profile.data,
  });

  return (
    <AppShell
      title="Dashboard"
      subtitle={`Custo estimado de ${brl(cpk)}/km · meta diária ${brl(dailyGoal)}${dailyGoalPlan.isAdjusted ? " (ajustada)" : ""}`}
      actions={
        <div className="flex gap-1 rounded-lg bg-muted p-1">
          {RANGES.map((r) => (
            <Button
              key={r.key}
              size="sm"
              variant={range.key === r.key ? "default" : "ghost"}
              className="h-7 px-3 text-xs"
              onClick={() => setRange(r)}
            >
              {r.label}
            </Button>
          ))}
        </div>
      }
    >
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <StatCard
          label="Receita do período"
          value={brl(s.revenue)}
          hint={`${s.count} entregas · ${brl(s.perHour)}/hora`}
          tone="primary"
          icon={<Banknote className="size-4" />}
        />
        <StatCard
          label="Lucro real"
          value={brl(s.profit)}
          hint={`Margem ${num(s.revenue ? (s.profit / s.revenue) * 100 : 0)}%`}
          tone={s.profit >= 0 ? "success" : "destructive"}
          icon={<TrendingUp className="size-4" />}
        />
        <StatCard
          label="Custos"
          value={brl(s.fuelCost + s.otherCost + s.maintenanceCost)}
          hint={`Combustível ${brl(s.fuelCost)} · outros ${brl(s.otherCost + s.maintenanceCost)}`}
          tone="destructive"
          icon={<Fuel className="size-4" />}
        />
        <StatCard
          label="Quilometragem"
          value={`${num(periodKm)} km`}
          hint={
            (chainKm != null ? "Pontos do período encadeados" : "Soma das entregas do período") +
            (periodDeliveries.length
              ? ` · ${num(s.distance)} km registrados em ${periodDeliveries.length} entrega${periodDeliveries.length === 1 ? "" : "s"}`
              : "") +
            ` · ${brl(s.perKm)} por km rodado`
          }
          tone="primary"
          icon={<Gauge className="size-4" />}
        />
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3 xl:grid-cols-4">
        <StatCard
          label="Tempo parado"
          value={minutesLabel(s.idleMin)}
          hint={`Rodando ${minutesLabel(s.workedMin)}`}
          tone="warning"
          icon={<Timer className="size-4" />}
        />
        <StatCard label="Ticket médio" value={brl(s.count ? s.revenue / s.count : 0)} />
        <StatCard
          label="Meta de hoje"
          value={`${num((todayRevenue / dailyGoal) * 100, 0)}%`}
          hint={`${brl(todayRevenue)} hoje${dailyGoalPlan.monthTarget > 0 ? ` · ${dailyGoalPlan.remainingDaysIncludingToday} dias para ${brl(dailyGoalPlan.monthTarget)}` : ""}`}
        />
        <StatCard label="Manutenção no período" value={brl(s.maintenanceCost)} />
      </div>

      <div className="mt-4">
        <SmartAlerts alerts={smartAlerts} />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <SectionCard
          title="Receita x lucro real"
          description="Evolução diária"
          className="lg:col-span-2"
        >
          {series.some((d) => d.receita > 0) ? (
            <div className="h-64">
              <Suspense fallback={<div className="size-full animate-pulse rounded-md bg-muted" />}>
                <RevenueAreaChart data={series} />
              </Suspense>
            </div>
          ) : (
            <EmptyState>Registre entregas para ver a evolução.</EmptyState>
          )}
        </SectionCard>

        <SectionCard title="Ranking de aplicativos" description="Ordenado por lucro no período">
          {ranking.length ? (
            <ul className="space-y-3">
              {ranking.map((r, i) => (
                <li key={r.app} className="flex items-center gap-3">
                  <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-accent text-xs font-semibold text-accent-foreground">
                    {i + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{r.app}</p>
                    <p className="text-xs text-muted-foreground">
                      {r.count} entregas · {brl(r.perKm)}/km
                    </p>
                  </div>
                  <span className="text-sm font-semibold tabular-nums">{brl(r.profit)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState>Sem entregas neste período.</EmptyState>
          )}
        </SectionCard>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <SectionCard
          title="Mapa de calor de entregas"
          description="Ganhos por dia da semana e hora (histórico completo)"
        >
          <div className="overflow-x-auto">
            <div className="min-w-[520px] space-y-1">
              {grid.map((row, day) => (
                <div key={day} className="flex items-center gap-1">
                  <span className="w-8 text-[10px] text-muted-foreground">{WEEKDAYS[day]}</span>
                  {row.map((v, hour) => (
                    <span
                      key={hour}
                      title={`${WEEKDAYS[day]} ${hour}h · ${brl(v)}`}
                      className="h-4 flex-1 rounded-[3px] bg-primary"
                      style={{ opacity: v ? 0.15 + (v / max) * 0.85 : 0.06 }}
                    />
                  ))}
                </div>
              ))}
              <div className="flex gap-1 pl-9 pt-1 text-[9px] text-muted-foreground">
                {Array.from({ length: 24 }, (_, h) => (
                  <span key={h} className="flex-1 text-center">
                    {h % 3 === 0 ? h : ""}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </SectionCard>

        <SectionCard title="Histórico recente" description="Últimas entregas registradas">
          {deliveriesData.length ? (
            <ul className="divide-y divide-border">
              {deliveriesData.slice(0, 8).map((d) => (
                <li key={d.id} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{d.app_name}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {dateTimeLabel(d.occurred_at)} · {paymentMethodLabel(d.payment_method)} ·{" "}
                      {num(Number(d.distance_km))} km · {d.dropoff_address ?? "sem endereço"}
                    </p>
                  </div>
                  <span className="text-sm font-semibold tabular-nums text-success">
                    {brl(Number(d.earnings) + Number(d.tip))}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState>Nenhuma entrega registrada ainda.</EmptyState>
          )}
        </SectionCard>
      </div>
    </AppShell>
  );
}
