import { createFileRoute } from "@tanstack/react-router";
import { Suspense, lazy } from "react";

const MonthsBarChart = lazy(() => import("@/components/charts/MonthsBarChart"));
import { FileDown, Printer } from "lucide-react";
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
import { brl, dateTimeLabel, downloadCsv, monthLabel, num } from "@/lib/format";
import { byApp, costPerKm, byMonth, costsByCategory, filterByRange, summarize } from "@/lib/metrics";
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

  const cpk = costPerKm(fuelings.data ?? [], profile.data);
  const perDeliveries = filterByRange(deliveries.data ?? [], (d) => d.occurred_at, period.fromDate, period.toDate);
  const perExpenses = filterByRange(expenses.data ?? [], (e) => e.occurred_at, period.fromDate, period.toDate);
  const perMaint = filterByRange(maintenances.data ?? [], (m) => m.performed_at, period.fromDate, period.toDate);
  const perFuelings = filterByRange(fuelings.data ?? [], (f) => f.occurred_at, period.fromDate, period.toDate);

  const months = byMonth(deliveries.data ?? [], expenses.data ?? [], cpk).slice(-12);
  const total = summarize(perDeliveries, perExpenses, perMaint, cpk);
  const ranking = byApp(perDeliveries, cpk);
  const categories = costsByCategory(perExpenses);
  const fuelPaid = perFuelings.reduce((a, f) => a + Number(f.total), 0);
  const totalCost = total.fuelCost + total.otherCost + total.maintenanceCost;
  const last = months[months.length - 1];
  const prev = months[months.length - 2];
  const delta = last && prev && prev.profit ? ((last.profit - prev.profit) / Math.abs(prev.profit)) * 100 : 0;

  const chart = months.map((m) => ({
    mes: monthLabel(m.month),
    receita: m.revenue,
    lucro: m.profit,
  }));

  const costRows: { label: string; value: number; hint?: string }[] = [
    { label: "Combustível (estimado por km)", value: total.fuelCost, hint: `${num(total.distance)} km × ${brl(cpk)}/km` },
    { label: "Abastecimentos pagos", value: fuelPaid, hint: `${perFuelings.length} abastecimento(s)` },
    { label: "Manutenção", value: total.maintenanceCost, hint: `${perMaint.length} serviço(s)` },
    ...categories.map((c) => ({ label: `Despesa · ${c.category}`, value: c.amount })),
  ];

  function exportDeliveries() {
    downloadCsv("entregas-delivery-os.csv", [
      ["Data", "Aplicativo", "Ganho", "Gorjeta", "KM", "Duração (min)", "Parado (min)", "Destino"],
      ...perDeliveries.map((d) => [
        dateTimeLabel(d.occurred_at),
        d.app_name,
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
      ["Item", "Valor"],
      ...costRows.map((r) => [r.label, r.value]),
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
          label="Lucro acumulado"
          value={brl(total.profit)}
          hint={`Margem ${num(total.revenue ? (total.profit / total.revenue) * 100 : 0)}%`}
          tone={total.profit >= 0 ? "success" : "destructive"}
        />
        <StatCard label="Custos no período" value={brl(totalCost)} tone="destructive" hint={`${brl(total.fuelCost)} combustível`} />
        <StatCard
          label="Variação vs mês anterior"
          value={`${delta >= 0 ? "+" : ""}${num(delta, 0)}%`}
          tone={delta >= 0 ? "success" : "destructive"}
          hint={prev ? `${monthLabel(prev.month)} → ${last ? monthLabel(last.month) : ""}` : "sem histórico"}
        />
      </div>

      <SectionCard className="mt-4" title="Detalhamento dos custos" description={`Período: ${period.label}`}>
        {totalCost > 0 || fuelPaid > 0 ? (
          <ul className="divide-y divide-border">
            {costRows
              .filter((r) => r.value > 0)
              .map((r) => (
                <li key={r.label} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{r.label}</p>
                    {r.hint ? <p className="truncate text-xs text-muted-foreground">{r.hint}</p> : null}
                  </div>
                  <span className="text-sm font-semibold tabular-nums">{brl(r.value)}</span>
                </li>
              ))}
            <li className="flex items-center justify-between gap-3 py-2.5">
              <p className="text-sm font-semibold">Total considerado no lucro</p>
              <span className="text-sm font-semibold tabular-nums text-destructive">{brl(totalCost)}</span>
            </li>
          </ul>
        ) : (
          <EmptyState>Nenhum custo registrado neste período.</EmptyState>
        )}
      </SectionCard>



      <SectionCard className="mt-4" title="Comparação entre meses" description="Receita x lucro real">
        {chart.length ? (
          <div className="h-72">
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
                      <td className="py-2 text-right tabular-nums">{brl(m.cost + m.km * cpk)}</td>
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
