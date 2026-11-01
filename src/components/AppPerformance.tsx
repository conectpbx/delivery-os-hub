import { receivedBonuses, normalizedApp, type AppChallenge } from "@/lib/app-challenges";
import { useMemo, useState } from "react";
import type { Delivery } from "@/lib/data";
import { appInsights, type AppInsightTime } from "@/lib/app-insights";
import {
  brl,
  dateLabel,
  dateTimeLabel,
  downloadCsv,
  localDateValue,
  minutesLabel,
  num,
  paymentMethodLabel,
} from "@/lib/format";
import { EmptyState, SectionCard } from "@/components/ui-kit";
import { Button } from "@/components/ui/button";

const appName = (d: Delivery) => d.app_name?.trim() || "Sem aplicativo";

export function AppPerformance({
  deliveries,
  costPerKm,
  periodLabel,
  detailed = false,
  time,
  bonuses = [],
}: {
  deliveries: Delivery[];
  costPerKm: number;
  periodLabel: string;
  detailed?: boolean;
  time: AppInsightTime;
  bonuses?: AppChallenge[];
}) {
  const [selected, setSelected] = useState("");
  const [page, setPage] = useState(0);
  const paidBonuses = useMemo(
    () => receivedBonuses(bonuses, time.from, time.to),
    [bonuses, time.from, time.to],
  );
  const apps = useMemo(
    () =>
      [...new Set([...deliveries.map(appName), ...paidBonuses.map((b) => b.app_name)])].sort(
        (a, b) => a.localeCompare(b),
      ),
    [deliveries, paidBonuses],
  );
  // A period change must never leave an invisible application filter active.
  const active = apps.includes(selected) ? selected : "";
  const filtered = useMemo(
    () =>
      deliveries
        .filter((d) => !active || appName(d) === active)
        .sort((a, b) => Date.parse(b.occurred_at) - Date.parse(a.occurred_at)),
    [deliveries, active],
  );
  const summaries = useMemo(
    () => appInsights(filtered, costPerKm, time),
    [filtered, costPerKm, time],
  );
  const selectedBonuses = paidBonuses.filter(
    (b) => !active || normalizedApp(b.app_name) === normalizedApp(active),
  );
  const bonusRevenue = selectedBonuses.reduce((n, b) => n + Number(b.reward), 0);
  const revenue = summaries.reduce((v, r) => v + r.revenue, 0);
  const tips = summaries.reduce((v, r) => v + r.tips, 0);
  const cost = summaries.reduce((v, r) => v + r.cost, 0);
  const km = summaries.reduce((v, r) => v + r.km, 0);
  const days = useMemo(() => {
    const groups = new Map<string, Delivery[]>();
    for (const d of filtered) {
      const key = localDateValue(new Date(d.occurred_at));
      groups.set(key, [...(groups.get(key) ?? []), d]);
    }
    return [...groups]
      .sort(([a], [b]) => b.localeCompare(a))
      .map(([day, rows]) => ({
        day,
        rows: appInsights(rows, costPerKm, {
          ...time,
          from: new Date(`${day}T00:00:00`),
          to: new Date(`${day}T23:59:59.999`),
        }),
      }));
  }, [filtered, costPerKm, time]);
  const currentPage = Math.min(page, Math.max(0, Math.ceil(filtered.length / 20) - 1));
  const exportSelection = () =>
    downloadCsv("visao-aplicativo-delivery-os.csv", [
      [
        "Tipo",
        "Período",
        "Data",
        "Aplicativo",
        "Recebimento",
        "Ganhos",
        "Gratificação do cliente",
        "Receita",
        "Km",
        "Custo por km estimado",
        "Resultado após custo por km",
        "Destino",
      ],
      ...filtered.map((d) => {
        const income = Number(d.earnings) + Number(d.tip);
        const estimated = Number(d.distance_km) * costPerKm;
        return [
          "Entrega",
          periodLabel,
          dateTimeLabel(d.occurred_at),
          appName(d),
          paymentMethodLabel(d.payment_method),
          Number(d.earnings),
          Number(d.tip),
          income,
          Number(d.distance_km),
          estimated,
          income - estimated,
          d.dropoff_address ?? "",
        ];
      }),
      ...selectedBonuses.map((b) => [
        "Bonificação",
        periodLabel,
        dateTimeLabel(b.received_at!),
        b.app_name,
        "",
        0,
        0,
        Number(b.reward),
        0,
        0,
        Number(b.reward),
        b.title,
      ]),
    ]);
  return (
    <SectionCard
      className="mt-4"
      title={detailed ? "Entregas e resultados por aplicativo" : "Visão por aplicativo"}
      description={`${periodLabel} · ${active || "Todos os aplicativos"}`}
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-xs font-medium">
            Aplicativo
            <select
              className="ml-2 max-w-full rounded-md border border-input bg-background p-2 text-sm"
              value={active}
              onChange={(e) => {
                setSelected(e.target.value);
                setPage(0);
              }}
            >
              <option value="">Todos os aplicativos</option>
              {apps.map((app) => (
                <option key={app} value={app}>
                  {app}
                </option>
              ))}
            </select>
          </label>
          {detailed && (
            <Button
              className="no-print"
              variant="outline"
              size="sm"
              disabled={!filtered.length && !selectedBonuses.length}
              onClick={exportSelection}
            >
              Exportar seleção (Excel)
            </Button>
          )}
        </div>
      }
    >
      {!filtered.length && !selectedBonuses.length ? (
        <EmptyState>Sem entregas no período selecionado.</EmptyState>
      ) : (
        <>
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              ["Receita de entregas", brl(revenue)],
              ["Bonificações recebidas", brl(bonusRevenue)],
              ["Receita total", brl(revenue + bonusRevenue)],
              ["Resultado estimado", brl(revenue + bonusRevenue - cost)],
              ["Entregas", String(filtered.length)],
              ["Quilometragem", `${num(km)} km`],
              ["Gratificações do cliente", brl(tips)],
              ["Custo estimado por km", brl(cost)],
              ["Ticket médio de entregas", filtered.length ? brl(revenue / filtered.length) : "—"],
              ["Receita por km", km > 0 ? brl(revenue / km) : "—"],
            ].map(([label, value]) => (
              <div key={label} className="rounded-lg bg-muted/50 p-3">
                <dt className="text-xs text-muted-foreground">{label}</dt>
                <dd className="mt-1 text-lg font-semibold tabular-nums">{value}</dd>
              </div>
            ))}
          </dl>
          {detailed && (
            <dl className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
              {(
                [
                  ["Pix", "pix"],
                  ["Crédito", "credito"],
                  ["Dinheiro", "dinheiro"],
                ] as const
              ).map(([label, method]) => (
                <div key={method} className="rounded-lg border border-border p-3">
                  <dt className="text-xs text-muted-foreground">{label}</dt>
                  <dd className="mt-1 text-sm font-semibold tabular-nums">
                    {brl(summaries.reduce((v, r) => v + r.payments[method], 0))}
                  </dd>
                </div>
              ))}
            </dl>
          )}
          <p className="mt-3 text-xs text-muted-foreground">
            Resultado estimado = receita com gratificações do cliente e bonificações recebidas menos
            combustível e reserva de manutenção por km. Despesas gerais, manutenção por dia e tempo
            fora das entregas não são rateados por aplicativo. Os totais gerais da página permanecem
            no período completo.
          </p>
          {selectedBonuses.length > 0 && (
            <div className="mt-3">
              <h3 className="text-sm font-semibold">Bonificações da seleção</h3>
              <ul className="divide-y divide-border">
                {selectedBonuses.map((b) => (
                  <li key={b.id} className="flex justify-between gap-3 py-2 text-sm">
                    <span>
                      {b.app_name} · {b.title} · {dateTimeLabel(b.received_at!)}
                    </span>
                    <strong className="shrink-0">{brl(Number(b.reward))}</strong>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm">
              <caption className="mb-2 text-left font-medium">
                Evolução diária das entregas por aplicativo (sem bonificações)
              </caption>
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  {[
                    "Dia",
                    "Aplicativo",
                    "Entregas",
                    "Receita",
                    "Custo estimado",
                    "Resultado estimado",
                    "Em entregas",
                  ].map((h) => (
                    <th key={h} className="whitespace-nowrap p-2">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {days.flatMap(({ day, rows }) =>
                  rows.map((r) => (
                    <tr key={`${day}-${r.app}`} className="border-b border-border/60">
                      <td className="whitespace-nowrap p-2">{dateLabel(day)}</td>
                      <td className="p-2">{r.app}</td>
                      <td className="p-2 tabular-nums">{r.count}</td>
                      <td className="whitespace-nowrap p-2 tabular-nums">{brl(r.revenue)}</td>
                      <td className="whitespace-nowrap p-2">{brl(r.cost)}</td>
                      <td className="whitespace-nowrap p-2 font-medium">{brl(r.profit)}</td>
                      <td className="whitespace-nowrap p-2">{minutesLabel(r.minutes)}</td>
                    </tr>
                  )),
                )}
              </tbody>
            </table>
          </div>
          {detailed && filtered.length > 0 && (
            <div className="mt-5">
              <h3 className="text-sm font-semibold">
                Detalhes das entregas · {filtered.length} registros
              </h3>
              <ul className="mt-2 divide-y divide-border">
                {filtered.slice(currentPage * 20, currentPage * 20 + 20).map((d) => (
                  <li key={d.id} className="py-3 text-sm">
                    <div className="flex justify-between gap-3">
                      <span className="font-medium">
                        {appName(d)} · {dateTimeLabel(d.occurred_at)}
                      </span>
                      <span className="shrink-0 font-semibold">
                        {brl(Number(d.earnings) + Number(d.tip))}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {paymentMethodLabel(d.payment_method)} · {num(Number(d.distance_km))} km ·
                      gratificação do cliente {brl(Number(d.tip))} ·{" "}
                      {d.status === "em_rota" ? "Em rota" : "Registrada"}
                    </p>
                    <p className="mt-1 break-words text-xs text-muted-foreground">
                      {d.pickup_address || "Origem não informada"} →{" "}
                      {d.dropoff_address || "Destino não informado"}
                    </p>
                  </li>
                ))}
              </ul>
              <div className="no-print mt-3 flex items-center justify-between gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={currentPage === 0}
                  onClick={() => setPage(currentPage - 1)}
                >
                  Anterior
                </Button>
                <span className="text-xs">
                  Página {currentPage + 1} de {Math.ceil(filtered.length / 20)}
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={(currentPage + 1) * 20 >= filtered.length}
                  onClick={() => setPage(currentPage + 1)}
                >
                  Próxima
                </Button>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                A impressão inclui a página de entregas exibida. A exportação inclui todas as
                entregas e bonificações da seleção.
              </p>
            </div>
          )}
        </>
      )}
    </SectionCard>
  );
}
