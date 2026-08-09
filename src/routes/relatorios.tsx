import { createFileRoute } from "@tanstack/react-router";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
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
import { byApp, costPerKm, byMonth, summarize } from "@/lib/metrics";

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

  const cpk = costPerKm(fuelings.data ?? [], profile.data);
  const months = byMonth(deliveries.data ?? [], expenses.data ?? [], cpk).slice(-12);
  const total = summarize(deliveries.data ?? [], expenses.data ?? [], maintenances.data ?? [], cpk);
  const ranking = byApp(deliveries.data ?? [], cpk);
  const last = months[months.length - 1];
  const prev = months[months.length - 2];
  const delta = last && prev && prev.profit ? ((last.profit - prev.profit) / Math.abs(prev.profit)) * 100 : 0;

  const chart = months.map((m) => ({
    mes: monthLabel(m.month),
    receita: m.revenue,
    lucro: m.profit,
  }));

  function exportDeliveries() {
    downloadCsv("entregas-delivery-os.csv", [
      ["Data", "Aplicativo", "Ganho", "Gorjeta", "KM", "Duração (min)", "Parado (min)", "Destino"],
      ...(deliveries.data ?? []).map((d) => [
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

  return (
    <AppShell
      title="Relatórios"
      subtitle="Comparação entre meses, PDF e exportação para Excel"
      actions={
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" className="gap-2" onClick={exportDeliveries}>
            <FileDown className="size-4" /> Entregas (Excel)
          </Button>
          <Button variant="outline" size="sm" className="gap-2" onClick={exportMonths}>
            <FileDown className="size-4" /> Resumo (Excel)
          </Button>
          <Button size="sm" className="gap-2" onClick={() => window.print()}>
            <Printer className="size-4" /> Gerar PDF
          </Button>
        </div>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Receita acumulada" value={brl(total.revenue)} tone="primary" />
        <StatCard label="Lucro acumulado" value={brl(total.profit)} tone={total.profit >= 0 ? "success" : "destructive"} />
        <StatCard label="Quilometragem total" value={`${num(total.distance)} km`} />
        <StatCard
          label="Variação vs mês anterior"
          value={`${delta >= 0 ? "+" : ""}${num(delta, 0)}%`}
          tone={delta >= 0 ? "success" : "destructive"}
          hint={prev ? `${monthLabel(prev.month)} → ${last ? monthLabel(last.month) : ""}` : "sem histórico"}
        />
      </div>

      <SectionCard className="mt-4" title="Comparação entre meses" description="Receita x lucro real">
        {chart.length ? (
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chart} margin={{ left: -18, right: 8, top: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
                <XAxis dataKey="mes" tickLine={false} axisLine={false} fontSize={11} />
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
                <Bar dataKey="receita" fill="var(--color-chart-1)" radius={[6, 6, 0, 0]} />
                <Bar dataKey="lucro" fill="var(--color-chart-2)" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
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

        <SectionCard title="Desempenho por aplicativo" description="Todo o histórico">
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
