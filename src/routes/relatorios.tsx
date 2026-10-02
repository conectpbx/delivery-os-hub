import { createFileRoute } from "@tanstack/react-router";
import { Suspense, lazy, useMemo, useState } from "react";

const MonthsBarChart = lazy(() => import("@/components/charts/MonthsBarChart"));
import { Clock3, FileDown, Gauge, PackageCheck, Printer, Route as RouteIcon } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { EmptyState, SectionCard, StatCard } from "@/components/ui-kit";
import { Button } from "@/components/ui/button";
import { useDeliveries, useExpenses, useFuelings, useMaintenances, useProfile } from "@/lib/data";
import {
  brl,
  dateTimeLabel,
  downloadCsv,
  minutesLabel,
  monthLabel,
  num,
  paymentMethodLabel,
} from "@/lib/format";
import {
  byApp,
  byMonth,
  byMonthRecordedCosts,
  costPerKm,
  costsByCategory,
  filterByRange,
  maintenanceReservePerKm,
  reportBreakdown,
  summarizeOperational,
  summarizeRecordedCosts,
  type ReportGranularity,
} from "@/lib/metrics";
import { PeriodFilter, PeriodSummary, usePeriodSelection } from "@/components/PeriodFilter";

export const Route = createFileRoute("/relatorios")({
  head: () => ({
    meta: [
      { title: "Relatórios em PDF e Excel — Delivery OS" },
      {
        name: "description",
        content:
          "Compare meses, exporte planilhas em Excel e gere relatórios em PDF do seu desempenho como entregador.",
      },
      { property: "og:title", content: "Relatórios e exportações — Delivery OS" },
      {
        property: "og:description",
        content: "Comparação entre meses, exportação para Excel e relatório em PDF.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Relatorios,
});

function Relatorios() {
  const deliveries = useDeliveries();
  const expenses = useExpenses();
  const fuelings = useFuelings();
  const maintenances = useMaintenances();
  const profile = useProfile();
  const period = usePeriodSelection(3);
  const [granularity, setGranularity] = useState<ReportGranularity>("day");

  const deliveriesData = useMemo(() => deliveries.data ?? [], [deliveries.data]);
  const expensesData = useMemo(() => expenses.data ?? [], [expenses.data]);
  const fuelingsData = useMemo(() => fuelings.data ?? [], [fuelings.data]);
  const maintenancesData = useMemo(() => maintenances.data ?? [], [maintenances.data]);

  const cpk = useMemo(() => costPerKm(fuelingsData, profile.data), [fuelingsData, profile.data]);
  const maintenanceReserve = useMemo(
    () => maintenanceReservePerKm(maintenancesData),
    [maintenancesData],
  );
  const perDeliveries = useMemo(
    () => filterByRange(deliveriesData, (d) => d.occurred_at, period.fromDate, period.toDate),
    [deliveriesData, period.fromDate, period.toDate],
  );
  const perExpenses = useMemo(
    () => filterByRange(expensesData, (e) => e.occurred_at, period.fromDate, period.toDate),
    [expensesData, period.fromDate, period.toDate],
  );
  const perMaint = useMemo(
    () => filterByRange(maintenancesData, (m) => m.performed_at, period.fromDate, period.toDate),
    [maintenancesData, period.fromDate, period.toDate],
  );
  const perFuelings = useMemo(
    () => filterByRange(fuelingsData, (f) => f.occurred_at, period.fromDate, period.toDate),
    [fuelingsData, period.fromDate, period.toDate],
  );

  const months = useMemo(
    () =>
      byMonthRecordedCosts(deliveriesData, expensesData, fuelingsData, maintenancesData).slice(-12),
    [deliveriesData, expensesData, fuelingsData, maintenancesData],
  );
  const total = useMemo(
    () => summarizeRecordedCosts(perDeliveries, perExpenses, perMaint, perFuelings),
    [perDeliveries, perExpenses, perFuelings, perMaint],
  );
  const operational = useMemo(
    () =>
      summarizeOperational(perDeliveries, expensesData, cpk, maintenanceReserve.costPerKm, {
        from: period.fromDate,
        to: period.toDate,
        maintenanceCostPerDay: maintenanceReserve.costPerDay,
        maintenanceItems: maintenanceReserve.items,
      }),
    [perDeliveries, expensesData, cpk, maintenanceReserve, period.fromDate, period.toDate],
  );
  const operationalMonths = useMemo(
    () => byMonth(deliveriesData, expensesData, cpk + maintenanceReserve.costPerKm).slice(-12),
    [deliveriesData, expensesData, cpk, maintenanceReserve.costPerKm],
  );
  const ranking = useMemo(
    () => byApp(perDeliveries, cpk + maintenanceReserve.costPerKm),
    [perDeliveries, cpk, maintenanceReserve.costPerKm],
  );
  const categories = useMemo(() => costsByCategory(perExpenses), [perExpenses]);
  const totalCost = total.fuelCost + total.otherCost + total.maintenanceCost;
  const totalMinutes = total.workedMin + total.idleMin;
  const activeDays = useMemo(
    () => new Set(perDeliveries.map((delivery) => delivery.occurred_at.slice(0, 10))).size,
    [perDeliveries],
  );
  const breakdown = useMemo(
    () => reportBreakdown(perDeliveries, perExpenses, perFuelings, perMaint, granularity),
    [granularity, perDeliveries, perExpenses, perFuelings, perMaint],
  );
  const chart = useMemo(
    () =>
      operationalMonths.map((m) => ({
        mes: monthLabel(m.month),
        receita: m.revenue,
        lucro: m.profit,
      })),
    [operationalMonths],
  );

  const costRows: { label: string; value: number; hint?: string }[] = useMemo(
    () => [
      {
        label: "Combustível abastecido",
        value: total.fuelCost,
        hint: `${perFuelings.length} abastecimento(s)`,
      },
      { label: "Manutenção", value: total.maintenanceCost, hint: `${perMaint.length} serviço(s)` },
      ...categories.map((c) => ({ label: `Despesa · ${c.category}`, value: c.amount })),
    ],
    [categories, perFuelings.length, perMaint.length, total.fuelCost, total.maintenanceCost],
  );

  function exportDeliveries() {
    downloadCsv("entregas-delivery-os.csv", [
      [
        "Data",
        "Aplicativo",
        "Forma de recebimento",
        "Ganho",
        "Gorjeta",
        "KM",
        "Duração (min)",
        "Parado (min)",
        "Destino",
      ],
      ...perDeliveries.map((d) => [
        dateTimeLabel(d.occurred_at),
        d.app_name,
        paymentMethodLabel(d.payment_method),
        Number(d.earnings),
        Number(d.tip),
        Number(d.distance_km),
        Number(d.duration_min),
        Number(d.idle_min),
        d.dropoff_address ?? "",
      ]),
    ]);
  }

  function exportMonths() {
    downloadCsv("resumo-mensal-delivery-os.csv", [
      ["Mês", "Receita", "KM", "Custos", "Lucro", "Entregas"],
      ...months.map((m) => [monthLabel(m.month), m.revenue, m.km, m.cost, m.profit, m.count]),
    ]);
  }

  function exportCosts() {
    downloadCsv("custos-delivery-os.csv", [
      ["Item", "Valor", "Tipo"],
      ...costRows.map((r) => [r.label, r.value, "Pago"]),
      ["Reserva de manutenção", operational.maintenanceCost, "Operacional (não somar ao pago)"],
    ]);
  }

  function exportBreakdown() {
    downloadCsv(`detalhamento-${granularity}-delivery-os.csv`, [
      [
        "Período",
        "Entregas",
        "KM",
        "Horas em entrega",
        "Horas paradas",
        "Receita",
        "Combustível",
        "Outros gastos",
        "Manutenção",
        "Custos totais",
        "Lucro",
        "Receita/KM",
        "Custo/KM",
        "Lucro/Hora",
      ],
      ...breakdown.map((row) => [
        breakdownLabel(row.from, row.to, granularity),
        row.count,
        row.distance,
        row.workedMin / 60,
        row.idleMin / 60,
        row.revenue,
        row.fuelCost,
        row.otherCost,
        row.maintenanceCost,
        row.totalCost,
        row.profit,
        row.revenuePerKm,
        row.costPerKm,
        row.profitPerHour,
      ]),
    ]);
  }

  return (
    <AppShell
      title="Relatórios"
      subtitle={`Período: ${period.label} · comparação entre meses, PDF e Excel`}
      actions={
        <div className="flex flex-wrap gap-2">
          <PeriodFilter selection={period} />
          <Button variant="outline" size="sm" className="gap-2" onClick={exportDeliveries}>
            <FileDown className="size-4" /> Entregas (Excel)
          </Button>
          <Button variant="outline" size="sm" className="gap-2" onClick={exportMonths}>
            <FileDown className="size-4" /> Resumo (Excel)
          </Button>
          <Button variant="outline" size="sm" className="gap-2" onClick={exportCosts}>
            <FileDown className="size-4" /> Custos (Excel)
          </Button>
          <Button size="sm" className="gap-2" onClick={() => window.print()}>
            <Printer className="size-4" /> Gerar PDF
          </Button>
        </div>
      }
    >
      <PeriodSummary selection={period} />
      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Receita acumulada"
          value={brl(total.revenue)}
          hint={`${total.count} entregas · ${period.label.toLowerCase()}`}
          tone="primary"
        />
        <StatCard
          label="Lucro por caixa"
          value={brl(total.profit)}
          hint={`Margem ${num(total.revenue ? (total.profit / total.revenue) * 100 : 0)}%`}
          tone={total.profit >= 0 ? "success" : "destructive"}
        />
        <StatCard
          label="Lucro operacional"
          value={brl(operational.profit)}
          hint={`Reserva ${brl(operational.maintenanceCost)} · ${brl(maintenanceReserve.costPerKm)}/km`}
          tone={operational.profit >= 0 ? "success" : "destructive"}
        />
        <StatCard
          label="Custos no período"
          value={brl(totalCost)}
          tone="destructive"
          hint={`${brl(total.fuelCost)} combustível`}
        />
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Quilômetros rodados"
          value={`${num(total.distance)} km`}
          hint={`${activeDays} dia(s) com atividade`}
          icon={<RouteIcon className="size-4" />}
        />
        <StatCard
          label="Tempo total"
          value={minutesLabel(totalMinutes)}
          hint={`${minutesLabel(total.workedMin)} em entrega · ${minutesLabel(total.idleMin)} parado`}
          icon={<Clock3 className="size-4" />}
        />
        <StatCard
          label="Custo por km"
          value={brl(total.distance ? totalCost / total.distance : 0)}
          hint={`Receita ${brl(total.perKm)}/km`}
          icon={<Gauge className="size-4" />}
        />
        <StatCard
          label="Lucro por hora"
          value={brl(totalMinutes ? total.profit / (totalMinutes / 60) : 0)}
          hint={`${total.count} entregas · ${activeDays ? num(total.count / activeDays) : "0,0"}/dia`}
          tone={total.profit >= 0 ? "success" : "destructive"}
          icon={<PackageCheck className="size-4" />}
        />
      </div>

      <SectionCard
        className="mt-4"
        title="Detalhamento da operação"
        description="Veja quilômetros, horas, gastos e rentabilidade em cada período"
        actions={
          <div className="no-print flex flex-wrap items-center gap-2">
            <div className="flex rounded-lg bg-muted p-1">
              {(
                [
                  ["day", "Dia"],
                  ["week", "Semana"],
                  ["month", "Mês"],
                ] as const
              ).map(([value, label]) => (
                <Button
                  key={value}
                  size="sm"
                  variant={granularity === value ? "default" : "ghost"}
                  className="h-7 px-3 text-xs"
                  onClick={() => setGranularity(value)}
                >
                  {label}
                </Button>
              ))}
            </div>
            <Button variant="outline" size="sm" className="h-8 gap-2" onClick={exportBreakdown}>
              <FileDown className="size-4" /> Exportar
            </Button>
          </div>
        }
      >
        {breakdown.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted-foreground">
                  <th className="pb-2 pr-4 font-medium">Período</th>
                  <th className="px-2 pb-2 text-right font-medium">Entregas</th>
                  <th className="px-2 pb-2 text-right font-medium">KM</th>
                  <th className="px-2 pb-2 text-right font-medium">Tempo</th>
                  <th className="px-2 pb-2 text-right font-medium">Receita</th>
                  <th className="px-2 pb-2 text-right font-medium">Gastos</th>
                  <th className="px-2 pb-2 text-right font-medium">Lucro</th>
                  <th className="px-2 pb-2 text-right font-medium">R$/km</th>
                  <th className="pl-2 pb-2 text-right font-medium">Lucro/h</th>
                </tr>
              </thead>
              <tbody>
                {breakdown.map((row) => (
                  <tr key={row.key} className="border-b border-border/60 last:border-0">
                    <td className="py-3 pr-4">
                      <p className="font-medium">{breakdownLabel(row.from, row.to, granularity)}</p>
                      <p className="text-xs text-muted-foreground">
                        {brl(row.fuelCost)} combustível · {brl(row.otherCost)} outros
                      </p>
                    </td>
                    <td className="px-2 py-3 text-right tabular-nums">{row.count}</td>
                    <td className="px-2 py-3 text-right tabular-nums">{num(row.distance)}</td>
                    <td className="px-2 py-3 text-right tabular-nums">
                      <span>{minutesLabel(row.workedMin + row.idleMin)}</span>
                      {row.idleMin > 0 ? (
                        <span className="block text-xs text-muted-foreground">
                          {minutesLabel(row.idleMin)} parado
                        </span>
                      ) : null}
                    </td>
                    <td className="px-2 py-3 text-right tabular-nums">{brl(row.revenue)}</td>
                    <td className="px-2 py-3 text-right tabular-nums text-destructive">
                      {brl(row.totalCost)}
                    </td>
                    <td
                      className={`px-2 py-3 text-right font-semibold tabular-nums ${row.profit >= 0 ? "text-success" : "text-destructive"}`}
                    >
                      {brl(row.profit)}
                    </td>
                    <td className="px-2 py-3 text-right tabular-nums">{brl(row.revenuePerKm)}</td>
                    <td className="pl-2 py-3 text-right tabular-nums">{brl(row.profitPerHour)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState>Nenhum lançamento encontrado neste período.</EmptyState>
        )}
      </SectionCard>

      <SectionCard
        className="mt-4"
        title="Detalhamento dos custos"
        description={`Período: ${period.label}`}
      >
        {totalCost > 0 ? (
          <ul className="divide-y divide-border">
            {costRows
              .filter((r) => r.value > 0)
              .map((r) => (
                <li key={r.label} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{r.label}</p>
                    {r.hint ? (
                      <p className="truncate text-xs text-muted-foreground">{r.hint}</p>
                    ) : null}
                  </div>
                  <span className="text-sm font-semibold tabular-nums">{brl(r.value)}</span>
                </li>
              ))}
            <li className="flex items-center justify-between gap-3 py-2.5">
              <p className="text-sm font-semibold">Total considerado no lucro</p>
              <span className="text-sm font-semibold tabular-nums text-destructive">
                {brl(totalCost)}
              </span>
            </li>
          </ul>
        ) : (
          <EmptyState>Nenhum custo registrado neste período.</EmptyState>
        )}
      </SectionCard>

      <SectionCard
        className="mt-4"
        title="Comparação entre meses"
        description="Receita x lucro operacional"
      >
        {chart.length ? (
          <div className="h-80 sm:h-96">
            <Suspense fallback={<div className="size-full animate-pulse rounded-md bg-muted" />}>
              <MonthsBarChart data={chart} />
            </Suspense>
          </div>
        ) : (
          <EmptyState>Sem dados suficientes para comparar meses.</EmptyState>
        )}
      </SectionCard>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <SectionCard title="Resumo mensal">
          {months.length ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs text-muted-foreground">
                    <th className="py-2">Mês</th>
                    <th className="py-2 text-right">Receita</th>
                    <th className="py-2 text-right">Custos</th>
                    <th className="py-2 text-right">Lucro</th>
                  </tr>
                </thead>
                <tbody>
                  {[...months].reverse().map((m) => (
                    <tr key={m.month} className="border-b border-border/60">
                      <td className="py-2">{monthLabel(m.month)}</td>
                      <td className="py-2 text-right tabular-nums">{brl(m.revenue)}</td>
                      <td className="py-2 text-right tabular-nums">{brl(m.cost)}</td>
                      <td className="py-2 text-right font-medium tabular-nums">{brl(m.profit)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState>Nenhum mês registrado.</EmptyState>
          )}
        </SectionCard>

        <SectionCard title="Desempenho por aplicativo" description={`Período: ${period.label}`}>
          {ranking.length ? (
            <ul className="space-y-3">
              {ranking.map((r) => (
                <li key={r.app} className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{r.app}</p>
                    <p className="text-xs text-muted-foreground">
                      {r.count} entregas · receita {brl(r.revenue)}
                    </p>
                  </div>
                  <span className="text-sm font-semibold tabular-nums">{brl(r.profit)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState>Nenhuma entrega registrada.</EmptyState>
          )}
        </SectionCard>
      </div>
    </AppShell>
  );
}

function breakdownLabel(from: Date, to: Date, granularity: ReportGranularity) {
  if (granularity === "month") {
    return from.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
  }
  const short = (date: Date) =>
    date.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
  if (granularity === "week") return `${short(from)} — ${short(to)}`;
  return from.toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit" });
}
