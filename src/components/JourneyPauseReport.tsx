import { Button } from "@/components/ui/button";
import { SectionCard, EmptyState } from "@/components/ui-kit";
import { FileDown } from "lucide-react";
import { dateTimeLabel, downloadCsv, minutesLabel } from "@/lib/format";
import type { WorkJourney } from "@/lib/operation-time";

export function JourneyPauseReport({ journeys, from, to, now }: { journeys: WorkJourney[]; from: Date; to: Date; now: Date }) {
  const rows = journeys.flatMap((j) => (j.pauses ?? []).map((p) => {
    const start = Math.max(Date.parse(p.started_at), Date.parse(j.started_at), from.getTime());
    const end = Math.min(Date.parse(p.ended_at ?? j.ended_at ?? now.toISOString()), Date.parse(j.ended_at ?? now.toISOString()), to.getTime() + 1, now.getTime());
    return { ...p, journeyId: j.id, minutes: Math.max(0, (end - start) / 60000) };
  })).filter((p) => p.minutes > 0).sort((a, b) => Date.parse(b.started_at) - Date.parse(a.started_at));
  const totals = new Map<string, number>();
  rows.forEach((p) => totals.set(p.reason, (totals.get(p.reason) ?? 0) + p.minutes));
  return <SectionCard title="Pausas da jornada" className="mt-4" actions={<Button variant="outline" size="sm" className="gap-2" disabled={!rows.length} onClick={() => downloadCsv("pausas-delivery-os.csv", [["Motivo", "Início", "Término", "Minutos no período"], ...rows.map((p) => [p.reason, dateTimeLabel(p.started_at), p.ended_at ? dateTimeLabel(p.ended_at) : "Em andamento", p.minutes])])}><FileDown className="size-4" />Pausas (Excel)</Button>}>
    {rows.length ? <>
      <dl className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3">{[...totals].map(([reason, minutes]) => <div key={reason} className="min-w-0"><dt className="break-words text-xs text-muted-foreground">{reason}</dt><dd className="text-lg font-semibold tabular-nums">{minutesLabel(minutes)}</dd></div>)}</dl>
      <div className="divide-y divide-border">{rows.map((p) => <div key={`${p.journeyId}:${p.id}`} className="flex min-w-0 flex-wrap items-center justify-between gap-2 py-3"><div className="min-w-0"><p className="break-words text-sm font-medium">{p.reason}</p><p className="break-words text-xs text-muted-foreground">{dateTimeLabel(p.started_at)} → {p.ended_at ? dateTimeLabel(p.ended_at) : "Em andamento"}</p></div><span className="shrink-0 text-sm font-medium tabular-nums text-warning">{minutesLabel(p.minutes)}</span></div>)}</div>
    </> : <EmptyState>Nenhuma pausa registrada neste período.</EmptyState>}
  </SectionCard>;
}