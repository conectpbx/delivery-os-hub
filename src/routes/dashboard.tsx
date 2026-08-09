import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Banknote, Fuel, Gauge, Timer, TrendingUp } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { EmptyState, SectionCard, StatCard } from "@/components/ui-kit";
import { Button } from "@/components/ui/button";
import {
  useDeliveries,
  useExpenses,
  useFuelings,
  useMaintenances,
  useProfile,
} from "@/lib/data";
import { brl, dateLabel, dateTimeLabel, minutesLabel, num } from "@/lib/format";
import { byApp, costPerKm, endOfDay, heatmap, inRange, startOfDay, summarize } from "@/lib/metrics";

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
  const [range, setRange] = useState<(typeof RANGES)[number]>(RANGES[1]);
  const deliveries = useDeliveries();
  const fuelings = useFuelings();
  const expenses = useExpenses();
  const maintenances = useMaintenances();
  const profile = useProfile();

  const cpk = costPerKm(fuelings.data ?? [], profile.data);
  const to = endOfDay();
  const from = startOfDay(new Date(Date.now() - (range.days - 1) * 86400000));

  const periodDeliveries = (deliveries.data ?? []).filter((d) => inRange(d.occurred_at, from, to));
  const periodExpenses = (expenses.data ?? []).filter((e) => inRange(e.occurred_at, from, to));
  const periodMaint = (maintenances.data ?? []).filter((m) => inRange(m.performed_at, from, to));
  const s = summarize(periodDeliveries, periodExpenses, periodMaint, cpk);
  const ranking = byApp(periodDeliveries, cpk);
  const { grid, max } = useMemo(() => heatmap(deliveries.data ?? []), [deliveries.data]);

  const series = useMemo(() => {
    const days: { day: string; receita: number; lucro: number }[] = [];
    for (let i = range.days - 1; i >= 0; i--) {
      const d = new Date(Date.now() - i * 86400000);
      const dayFrom = startOfDay(d);
      const dayTo = endOfDay(d);
      const dd = (deliveries.data ?? []).filter((x) => inRange(x.occurred_at, dayFrom, dayTo));
      const de = (expenses.data ?? []).filter((x) => inRange(x.occurred_at, dayFrom, dayTo));
      const sum = summarize(dd, de, [], cpk);
      days.push({ day: dateLabel(d.toISOString()), receita: sum.revenue, lucro: sum.profit });
    }
    return days;
  }, [deliveries.data, expenses.data, cpk, range.days]);

  const dailyGoal = Number(profile.data?.daily_goal ?? 200);
  const todayRevenue = summarize(
    (deliveries.data ?? []).filter((d) => inRange(d.occurred_at, startOfDay(), endOfDay())),
    [],
    [],
    cpk,
  ).revenue;

  return (
    <AppShell
      title="Dashboard"
      subtitle={`Custo estimado de ${brl(cpk)}/km · meta diária ${brl(dailyGoal)}`}
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
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
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
          value={`${num(s.distance)} km`}
          hint={`${brl(s.perKm)} por km rodado`}
          icon={<Gauge className="size-4" />}
        />
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Tempo parado"
          value={minutesLabel(s.idleMin)}
          hint={`Rodando ${minutesLabel(s.workedMin)}`}
          tone="warning"
          icon={<Timer className="size-4" />}
        />
        <StatCard label="Ticket médio" value={brl(s.count ? s.revenue / s.count : 0)} />
        <StatCard label="Meta de hoje" value={`${num((todayRevenue / dailyGoal) * 100, 0)}%`} hint={brl(todayRevenue)} />
        <StatCard label="Manutenção no período" value={brl(s.maintenanceCost)} />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <SectionCard title="Receita x lucro real" description="Evolução diária" className="lg:col-span-2">
          {series.some((d) => d.receita > 0) ? (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={series} margin={{ left: -18, right: 8, top: 8 }}>
                  <defs>
                    <linearGradient id="r" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--color-chart-1)" stopOpacity={0.4} />
                      <stop offset="100%" stopColor="var(--color-chart-1)" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="l" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--color-chart-2)" stopOpacity={0.4} />
                      <stop offset="100%" stopColor="var(--color-chart-2)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
                  <XAxis dataKey="day" tickLine={false} axisLine={false} fontSize={11} />
                  <YAxis tickLine={false} axisLine={false} fontSize={11} width={56} />
                  <Tooltip
                    formatter={(v: number) => brl(v)}
                    contentStyle={{
                      background: "var(--color-popover)",
                      border: "1px solid var(--color-border)",
                      borderRadius: 12,
                      fontSize: 12,
                    }}
                  />
                  <Area
                    type="monotone"
                    dataKey="receita"
                    stroke="var(--color-chart-1)"
                    fill="url(#r)"
                    strokeWidth={2}
                  />
                  <Area
                    type="monotone"
                    dataKey="lucro"
                    stroke="var(--color-chart-2)"
                    fill="url(#l)"
                    strokeWidth={2}
                  />
                </AreaChart>
              </ResponsiveContainer>
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
          {(deliveries.data ?? []).length ? (
            <ul className="divide-y divide-border">
              {(deliveries.data ?? []).slice(0, 8).map((d) => (
                <li key={d.id} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{d.app_name}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {dateTimeLabel(d.occurred_at)} · {num(Number(d.distance_km))} km ·{" "}
                      {d.dropoff_address ?? "sem endereço"}
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
