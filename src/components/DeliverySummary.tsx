import { memo, useMemo } from "react";

import { Brain } from "lucide-react";

import { OperationTimeStats } from "@/components/OperationTimeStats";

import { EmptyState, SectionCard, StatCard } from "@/components/ui-kit";

import { useDeliveries, useGoals, useProfile } from "@/lib/data";
import type { Delivery } from "@/lib/data";

import { brl, minutesLabel, num } from "@/lib/format";
import { adaptiveDailyRevenueGoal } from "@/lib/metrics";

import { useChainedDistance } from "@/lib/chained-distance";
import { useCalendarNow } from "@/hooks/useCalendarNow";

import { useDeliveryMetrics, type DeliveryMetric } from "@/lib/data";
import { deliveryPeriod, deliveryLearningPeriod } from "@/lib/delivery-scope";
type DeliveryInsight = {
  title: string;
  description: string;
  action: string;
};

export const DeliverySummary = memo(function DeliverySummary() {
  const now = useCalendarNow();
  const period = useMemo(() => deliveryPeriod("hoje", now), [now]);
  const todayStart = period.from!;
  const todayEnd = period.to!;
  const list = useDeliveries(period);
  const learning = useDeliveryMetrics(deliveryLearningPeriod(now));
  const goals = useGoals();
  const profile = useProfile();
  const today = useMemo(() => list.data ?? [], [list.data]);
  const all = useMemo(() => learning.data ?? [], [learning.data]);
  const total = today.reduce((s, d) => s + Number(d.earnings) + Number(d.tip), 0);
  const deliveryKmSum = today.reduce((s, d) => s + Number(d.distance_km), 0);
  const idle = today.reduce((s, d) => s + Number(d.idle_min), 0);
  const dailyGoal = useMemo(
    () =>
      adaptiveDailyRevenueGoal({
        deliveries: all,
        goals: goals.data ?? [],
        profile: profile.data,
        date: now,
      }).target,
    [all, goals.data, profile.data, now],
  );
  const goalRemaining = Math.max(0, dailyGoal - total);
  const deliveryIntel = buildDeliveryInsights({
    all,
    today,
    goalRemaining,
    dailyGoal,
  });

  const emRota = today.filter(
    (d) => (d as unknown as { status?: string }).status === "em_rota",
  ).length;

  // "Distância total" = trajeto encadeado do dia: primeira coleta confirmada/salva
  // até o último ponto informado, incluindo coletas, destinos finais e adicionais.
  const { chainKm, km } = useChainedDistance(today);

  return (
    <div>
      {list.isPending && (
        <p role="status" className="mb-2 text-sm text-muted-foreground">
          Carregando resumo do dia…
        </p>
      )}
      {list.isError && (
        <p role="alert" className="mb-2 text-sm text-destructive">
          Resumo do dia indisponível; não considere os totais completos até atualizar.
        </p>
      )}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatCard label="Total recebido" value={brl(total)} tone="primary" />
        <StatCard
          label="Pontos encadeados"
          value={`${num(km)} km`}
          hint={
            (chainKm != null ? "Pontos do dia encadeados" : "Soma das entregas do dia") +
            (today.length
              ? ` · ${num(deliveryKmSum)} km registrados em ${today.length} entrega${today.length === 1 ? "" : "s"}`
              : "") +
            (emRota ? ` · ${emRota} em andamento` : "")
          }
          tone="primary"
        />

        <StatCard label="Tempo parado" value={minutesLabel(idle)} tone="warning" />
      </div>
      <OperationTimeStats from={todayStart} to={todayEnd} />
      {deliveryIntel ? (
        <SectionCard
          title="Inteligência de entregas"
          description="Sugestões com base no mês atual e nos 56 dias anteriores ao mês"
          className="mt-4"
        >
          {today.length ? (
            <div className="grid gap-3 md:grid-cols-3">
              {deliveryIntel.map((insight) => (
                <div
                  key={insight.title}
                  className="rounded-md border border-border bg-muted/30 p-3"
                >
                  <div className="mb-2 flex items-center gap-2 text-sm font-medium">
                    <Brain className="size-4 text-primary" />
                    {insight.title}
                  </div>
                  <p className="text-xs text-muted-foreground">{insight.description}</p>
                  <p className="mt-2 text-xs font-medium text-foreground">{insight.action}</p>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState>
              Conclua a primeira entrega do dia para ativar recomendações baseadas no histórico.
            </EmptyState>
          )}
        </SectionCard>
      ) : null}
    </div>
  );
});
function buildDeliveryInsights({
  all,
  today,
  goalRemaining,
  dailyGoal,
}: {
  all: DeliveryMetric[];
  today: Delivery[];
  goalRemaining: number;
  dailyGoal: number;
}): DeliveryInsight[] | null {
  if (!today.length) return [];

  const completedHistory = all.filter(
    (d) => ((d as unknown as { status?: string }).status ?? "concluida") === "concluida",
  );
  const currentHour = new Date().getHours();
  const currentWeekday = new Date().getDay();
  const revenueToday = today.reduce((sum, d) => sum + Number(d.earnings) + Number(d.tip), 0);
  const avgTicket = average(
    completedHistory
      .filter((d) => Number(d.earnings) + Number(d.tip) > 0)
      .map((d) => Number(d.earnings) + Number(d.tip)),
  );
  const bestApp = rankByApp(completedHistory)[0];
  const bestHour = rankByHour(completedHistory, currentWeekday).find((h) => h.hour >= currentHour);
  const recent = completedHistory.filter(
    (d) => new Date(d.occurred_at).getTime() >= Date.now() - 30 * 86400000,
  );
  const minPerKm = percentile(
    recent
      .filter((d) => Number(d.distance_km) > 0)
      .map((d) => (Number(d.earnings) + Number(d.tip)) / Number(d.distance_km)),
    0.6,
  );
  const suggestedRuns = avgTicket > 0 ? Math.ceil(goalRemaining / avgTicket) : 0;

  const insights: DeliveryInsight[] = [];

  if (dailyGoal > 0) {
    insights.push({
      title: goalRemaining > 0 ? "Meta em foco" : "Meta batida",
      description:
        goalRemaining > 0
          ? `Você já fez ${brl(revenueToday)}. Faltam ${brl(goalRemaining)} para a meta de hoje.`
          : `Você já superou a meta diária de ${brl(dailyGoal)}.`,
      action:
        goalRemaining > 0 && suggestedRuns > 0
          ? `Busque cerca de ${suggestedRuns} entrega${suggestedRuns === 1 ? "" : "s"} no ticket médio de ${brl(avgTicket)}.`
          : "Priorize corridas com maior R$/km para proteger o lucro.",
    });
  }

  if (bestApp) {
    insights.push({
      title: "App mais forte",
      description: `${bestApp.app} lidera o histórico recente com ${brl(bestApp.avgRevenue)} por entrega e ${brl(bestApp.perKm)}/km.`,
      action: `Quando houver escolha, dê prioridade a ${bestApp.app} enquanto a demanda estiver boa.`,
    });
  }

  insights.push({
    title: bestHour ? "Próxima janela boa" : "Filtro de aceite",
    description: bestHour
      ? `Hoje, a partir de ${String(bestHour.hour).padStart(2, "0")}h, seu histórico rende em média ${brl(bestHour.avgRevenue)} por entrega.`
      : "Ainda não há padrão de horário suficiente para hoje.",
    action:
      minPerKm > 0
        ? `Evite ofertas abaixo de ${brl(minPerKm)}/km, salvo se ajudarem a voltar para uma área quente.`
        : "Registre distância e tempo nas próximas corridas para calibrar o filtro automaticamente.",
  });

  return insights.slice(0, 3);
}

function average(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function percentile(values: number[], p: number) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * p)))] ?? 0;
}

function rankByApp(deliveries: DeliveryMetric[]) {
  const map = new Map<string, { app: string; revenue: number; km: number; count: number }>();
  for (const d of deliveries) {
    const cur = map.get(d.app_name) ?? { app: d.app_name, revenue: 0, km: 0, count: 0 };
    cur.revenue += Number(d.earnings) + Number(d.tip);
    cur.km += Number(d.distance_km);
    cur.count += 1;
    map.set(d.app_name, cur);
  }
  return [...map.values()]
    .filter((item) => item.count >= 2)
    .map((item) => ({
      ...item,
      avgRevenue: item.revenue / item.count,
      perKm: item.km > 0 ? item.revenue / item.km : 0,
    }))
    .sort((a, b) => b.perKm - a.perKm || b.avgRevenue - a.avgRevenue);
}

function rankByHour(deliveries: DeliveryMetric[], weekday: number) {
  const map = new Map<number, { hour: number; revenue: number; count: number }>();
  for (const d of deliveries) {
    const date = new Date(d.occurred_at);
    if (date.getDay() !== weekday) continue;
    const hour = date.getHours();
    const cur = map.get(hour) ?? { hour, revenue: 0, count: 0 };
    cur.revenue += Number(d.earnings) + Number(d.tip);
    cur.count += 1;
    map.set(hour, cur);
  }
  return [...map.values()]
    .filter((item) => item.count >= 2)
    .map((item) => ({ ...item, avgRevenue: item.revenue / item.count }))
    .sort((a, b) => b.avgRevenue - a.avgRevenue);
}
