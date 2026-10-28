import { useMemo, useState } from "react";
import { Download, Trophy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState, SectionCard } from "@/components/ui-kit";
import type { Delivery } from "@/lib/data";
import { appInsights, type AppInsight } from "@/lib/app-insights";
import { brl, downloadCsv, minutesLabel, num } from "@/lib/format";
import { cn } from "@/lib/utils";

type SortKey = "profit" | "revenue" | "perHour" | "perKm" | "ticket" | "count";
const SORTS: { key: SortKey; label: string }[] = [
  { key: "profit", label: "Lucro" },
  { key: "revenue", label: "Receita" },
  { key: "perHour", label: "R$/hora" },
  { key: "perKm", label: "R$/km" },
  { key: "ticket", label: "Ticket" },
  { key: "count", label: "Entregas" },
];

const pct = (v: number) => `${Math.round(v * 100)}%`;

function leader(rows: AppInsight[], key: keyof AppInsight) {
  return rows.reduce<AppInsight | null>(
    (best, r) => (!best || (r[key] as number) > (best[key] as number) ? r : best),
    null,
  );
}

export function AppComparison({
  deliveries,
  costPerKm,
  periodLabel,
  detailed = false,
}: {
  deliveries: Delivery[];
  costPerKm: number;
  periodLabel: string;
  detailed?: boolean;
}) {
  const [sort, setSort] = useState<SortKey>("profit");
  const rows = useMemo(() => appInsights(deliveries, costPerKm), [deliveries, costPerKm]);
  const sorted = useMemo(() => [...rows].sort((a, b) => b[sort] - a[sort]), [rows, sort]);
  const multi = rows.length > 1;
  const leaders = multi
    ? [
        { label: "Mais lucro", r: leader(rows, "profit"), v: (r: AppInsight) => brl(r.profit) },
        { label: "Melhor R$/hora", r: leader(rows.filter((r) => r.minutes > 0), "perHour"), v: (r: AppInsight) => brl(r.perHour) },
        { label: "Melhor R$/km", r: leader(rows.filter((r) => r.km > 0), "perKm"), v: (r: AppInsight) => brl(r.perKm) },
        { label: "Maior ticket", r: leader(rows, "ticket"), v: (r: AppInsight) => brl(r.ticket) },
      ]
    : [];

  const exportCsv = () =>
    downloadCsv("aplicativos-delivery-os.csv", [
      ["Aplicativo", "Entregas", "% entregas", "Ganhos", "Gorjetas", "Receita", "% receita", "Km", "Custo est.", "Lucro", "R$/km", "R$/hora", "Ticket médio", "Tempo em entregas (min)", "Tempo parado (min)", "Dias ativos", "Melhor horário", "Crédito", "Pix", "Dinheiro"],
      ...sorted.map((r) => [
        r.app, r.count, pct(r.countShare), r.earnings.toFixed(2), r.tips.toFixed(2), r.revenue.toFixed(2), pct(r.revenueShare),
        r.km.toFixed(1), r.cost.toFixed(2), r.profit.toFixed(2), r.perKm.toFixed(2), r.perHour.toFixed(2), r.ticket.toFixed(2),
        Math.round(r.minutes), Math.round(r.idleMin), r.activeDays, r.bestHour === null ? "" : `${r.bestHour}h`,
        r.payments.credito.toFixed(2), r.payments.pix.toFixed(2), r.payments.dinheiro.toFixed(2),
      ]),
    ]);

  return (
    <SectionCard
      title={detailed ? "Comparativo de aplicativos" : "Ranking de aplicativos"}
      description={`${periodLabel} · ${rows.length} ${rows.length === 1 ? "aplicativo" : "aplicativos"}`}
      actions={
        rows.length ? (
          <div className="flex flex-wrap gap-1">
            {SORTS.slice(0, detailed ? SORTS.length : 3).map((s) => (
              <Button key={s.key} size="sm" variant={sort === s.key ? "default" : "outline"} className="h-7 px-2 text-xs" onClick={() => setSort(s.key)}>
                {s.label}
              </Button>
            ))}
            {detailed ? (
              <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={exportCsv}>
                <Download className="mr-1 size-3" /> CSV
              </Button>
            ) : null}
          </div>
        ) : null
      }
    >
      {!rows.length ? (
        <EmptyState>Sem entregas neste período.</EmptyState>
      ) : (
        <div className="space-y-4">
          {multi ? (
            <>
              <div>
                <p className="mb-1 text-xs text-muted-foreground">Participação na receita</p>
                <div className="flex h-3 overflow-hidden rounded-full bg-muted">
                  {rows.map((r, i) => (
                    <div key={r.app} title={`${r.app}: ${pct(r.revenueShare)}`} style={{ width: `${r.revenueShare * 100}%`, opacity: 1 - i * (0.6 / rows.length) }} className="bg-primary first:rounded-l-full last:rounded-r-full border-r border-background last:border-r-0" />
                  ))}
                </div>
              </div>
              {detailed ? (
                <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
                  {leaders.map((l) =>
                    l.r ? (
                      <div key={l.label} className="rounded-lg border border-border/70 p-2">
                        <p className="flex items-center gap-1 text-[11px] text-muted-foreground"><Trophy className="size-3 text-primary" />{l.label}</p>
                        <p className="truncate text-sm font-semibold">{l.r.app}</p>
                        <p className="text-xs tabular-nums text-muted-foreground">{l.v(l.r)}</p>
                      </div>
                    ) : null,
                  )}
                </div>
              ) : null}
            </>
          ) : null}

          <ul className="space-y-2">
            {sorted.map((r, i) => (
              <li key={r.app} className="rounded-lg border border-border/70 p-3">
                <div className="flex items-start gap-3">
                  <span className={cn("grid size-7 shrink-0 place-items-center rounded-lg text-xs font-semibold", i === 0 ? "bg-primary text-primary-foreground" : "bg-accent text-accent-foreground")}>{i + 1}</span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{r.app}</p>
                    <p className="text-xs text-muted-foreground">
                      {r.count} entregas{multi ? ` (${pct(r.countShare)})` : ""} · {num(r.km)} km · {brl(r.perKm)}/km
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <span className={cn("block text-sm font-semibold tabular-nums", r.profit >= 0 ? "text-success" : "text-destructive")}>{brl(r.profit)}</span>
                    <span className="text-[11px] text-muted-foreground">lucro{multi ? ` · ${pct(r.revenueShare)} receita` : ""}</span>
                  </div>
                </div>
                <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 border-t border-border/60 pt-2 text-xs sm:grid-cols-3">
                  <Item k="Receita" v={brl(r.revenue)} />
                  <Item k="R$/hora" v={r.minutes ? brl(r.perHour) : "—"} />
                  <Item k="Ticket médio" v={brl(r.ticket)} />
                  {detailed ? (
                    <>
                      <Item k="Gorjetas" v={brl(r.tips)} />
                      <Item k="Custo estimado" v={brl(r.cost)} />
                      <Item k="Em entregas" v={minutesLabel(r.minutes)} />
                      <Item k="Tempo parado" v={minutesLabel(r.idleMin)} />
                      <Item k="Dias ativos" v={String(r.activeDays)} />
                      <Item k="Melhor horário" v={r.bestHour === null ? "—" : `${r.bestHour}h–${r.bestHour + 1}h`} />
                      <Item k="Pix" v={brl(r.payments.pix)} />
                      <Item k="Crédito" v={brl(r.payments.credito)} />
                      <Item k="Dinheiro" v={brl(r.payments.dinheiro)} />
                    </>
                  ) : null}
                </dl>
              </li>
            ))}
          </ul>
        </div>
      )}
    </SectionCard>
  );
}

function Item({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-2">
      <dt className="text-muted-foreground">{k}</dt>
      <dd className="font-medium tabular-nums">{v}</dd>
    </div>
  );
}
