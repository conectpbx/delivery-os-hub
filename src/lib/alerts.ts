import { useEffect, useMemo } from "react";
import { toast } from "sonner";
import type { Delivery, Expense, Fueling, Goal, Maintenance, Profile } from "./data";
import { brl, num } from "./format";
import {
  adaptiveDailyRevenueGoal,
  costPerKm,
  endOfDay,
  inRange,
  startOfDay,
  summarize,
} from "./metrics";

export type SmartAlert = {
  id: string;
  kind: "lembrete" | "aviso" | "motivacional" | "dica";
  severity: "info" | "success" | "warning" | "danger";
  title: string;
  message: string;
  /** Alertas urgentes também viram toast (1x por dia). */
  toast?: boolean;
};

const TODAY = () => new Date().toISOString().slice(0, 10);
const STORE_KEY = "delivery-os:alerts-shown";

function readStore(): Record<string, string> {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(window.localStorage.getItem(STORE_KEY) ?? "{}") as Record<string, string>;
  } catch {
    return {};
  }
}

function shouldToast(id: string) {
  if (typeof window === "undefined") return false;
  const store = readStore();
  if (store[id] === TODAY()) return false;
  store[id] = TODAY();
  try {
    window.localStorage.setItem(STORE_KEY, JSON.stringify(store));
  } catch {
    /* noop */
  }
  return true;
}

const MOTIVATION = [
  "Constância vence velocidade: cada corrida registrada é um passo a mais.",
  "Você está no controle dos seus números — poucos entregadores estão.",
  "Dia bom se constrói rodada por rodada. Bora!",
  "Quem mede, melhora. Continue registrando tudo.",
];

function daysBetween(a: Date, b: Date) {
  return Math.round((a.getTime() - b.getTime()) / 86400000);
}

export function buildAlerts(input: {
  deliveries: Delivery[];
  fuelings: Fueling[];
  maintenances: Maintenance[];
  expenses: Expense[];
  goals: Goal[];
  profile: Profile | null | undefined;
}): SmartAlert[] {
  const { deliveries, fuelings, maintenances, expenses, goals, profile } = input;
  const alerts: SmartAlert[] = [];
  const now = new Date();
  const cpk = costPerKm(fuelings, profile);

  const today = deliveries.filter((d) => inRange(d.occurred_at, startOfDay(), endOfDay()));
  const sToday = summarize(
    today,
    expenses.filter((e) => inRange(e.occurred_at, startOfDay(), endOfDay())),
    [],
    cpk,
  );

  // ---- Metas ----
  const dailyGoalPlan = adaptiveDailyRevenueGoal({ deliveries, goals, profile, date: now });
  const dailyGoal = dailyGoalPlan.target;
  if (dailyGoal > 0) {
    const pct = (sToday.revenue / dailyGoal) * 100;
    const hour = now.getHours();
    if (pct >= 100) {
      alerts.push({
        id: "meta-diaria-ok",
        kind: "motivacional",
        severity: "success",
        title: "Meta diária batida! 🏆",
        message: `Você já fez ${brl(sToday.revenue)} hoje. Tudo daqui pra frente é lucro extra.`,
        toast: true,
      });
    } else if (pct >= 70) {
      alerts.push({
        id: "meta-diaria-reta-final",
        kind: "motivacional",
        severity: "info",
        title: `Reta final: ${num(pct, 0)}% da meta`,
        message: `Faltam ${brl(dailyGoal - sToday.revenue)} para fechar o dia no alvo${
          dailyGoalPlan.isAdjusted ? " mensal reajustado" : ""
        }. Você consegue!`,
        toast: true,
      });
    } else if (hour >= 18 && pct < 50) {
      alerts.push({
        id: "meta-diaria-atras",
        kind: "aviso",
        severity: "warning",
        title: "Ritmo abaixo da meta",
        message: `Só ${num(pct, 0)}% da meta até agora. ${
          dailyGoalPlan.isAdjusted
            ? `A meta inteligente de hoje está em ${brl(dailyGoal)} para compensar o mês.`
            : "Considere migrar para uma região de maior demanda."
        }`,
      });
    }
  }

  // ---- Meta mensal ----
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthDeliveries = deliveries.filter((d) => new Date(d.occurred_at) >= monthStart);
  const monthRevenue = monthDeliveries.reduce((s, d) => s + Number(d.earnings) + Number(d.tip), 0);
  const monthTarget = dailyGoalPlan.monthTarget;
  if (monthTarget > 0) {
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const expected = (monthTarget / daysInMonth) * now.getDate();
    if (monthRevenue >= monthTarget) {
      alerts.push({
        id: "meta-mensal-ok",
        kind: "motivacional",
        severity: "success",
        title: "Meta do mês conquistada! 🚀",
        message: `${brl(monthRevenue)} acumulados. Excelente trabalho.`,
        toast: true,
      });
    } else if (monthRevenue < expected * 0.8) {
      alerts.push({
        id: "meta-mensal-atras",
        kind: "aviso",
        severity: "warning",
        title: "Mês abaixo do ritmo",
        message: `Esperado ${brl(expected)} até hoje, você está em ${brl(monthRevenue)}. Faltam ${brl(
          monthTarget - monthRevenue,
        )}.`,
      });
    }
  }

  // ---- Manutenção ----
  for (const m of maintenances) {
    if (m.status === "concluida" && !m.next_due_date && !m.next_due_km) continue;
    if (m.next_due_date) {
      const diff = daysBetween(new Date(m.next_due_date), startOfDay());
      if (diff < 0) {
        alerts.push({
          id: `manut-atrasada-${m.id}`,
          kind: "aviso",
          severity: "danger",
          title: `Manutenção atrasada: ${m.service_type}`,
          message: `Vencida há ${Math.abs(diff)} dia(s). Agende o quanto antes para evitar custo maior.`,
          toast: true,
        });
      } else if (diff <= 7) {
        alerts.push({
          id: `manut-proxima-${m.id}`,
          kind: "lembrete",
          severity: "warning",
          title: `Manutenção em ${diff} dia(s): ${m.service_type}`,
          message: "Programe uma parada para não perder dias de trabalho depois.",
        });
      }
    }
  }

  // ---- Abastecimento ----
  const lastFuel = [...fuelings].sort(
    (a, b) => new Date(b.occurred_at).getTime() - new Date(a.occurred_at).getTime(),
  )[0];
  if (!lastFuel) {
    alerts.push({
      id: "sem-abastecimento",
      kind: "dica",
      severity: "info",
      title: "Cadastre um abastecimento",
      message: "Com os abastecimentos o sistema calcula seu custo por km e o lucro real.",
    });
  } else {
    const dias = daysBetween(startOfDay(), startOfDay(new Date(lastFuel.occurred_at)));
    if (dias >= 7) {
      alerts.push({
        id: "abastecimento-antigo",
        kind: "lembrete",
        severity: "info",
        title: `Último abastecimento há ${dias} dias`,
        message: "Registre os novos abastecimentos para manter o custo por km atualizado.",
      });
    }
    const media =
      fuelings.reduce((s, f) => s + Number(f.price_per_liter), 0) / (fuelings.length || 1);
    if (Number(lastFuel.price_per_liter) > media * 1.1 && fuelings.length > 2) {
      alerts.push({
        id: "combustivel-caro",
        kind: "aviso",
        severity: "warning",
        title: "Você abasteceu acima da média",
        message: `Último litro a ${brl(Number(lastFuel.price_per_liter))} contra média de ${brl(
          media,
        )}. Vale procurar outro posto.`,
      });
    }
  }

  // ---- Rentabilidade / operação ----
  if (sToday.count >= 3) {
    if (sToday.profit < 0) {
      alerts.push({
        id: "lucro-negativo",
        kind: "aviso",
        severity: "danger",
        title: "Lucro negativo hoje",
        message: `Custos de ${brl(sToday.fuelCost + sToday.otherCost)} superaram a receita. Reveja corridas longas de baixo valor.`,
        toast: true,
      });
    }
    const ticket = sToday.revenue / sToday.count;
    if (sToday.perKm > 0 && sToday.perKm < cpk * 2) {
      alerts.push({
        id: "ganho-por-km-baixo",
        kind: "dica",
        severity: "warning",
        title: "Ganho por km apertado",
        message: `Você está recebendo ${brl(sToday.perKm)}/km com custo de ${brl(
          cpk,
        )}/km. Priorize corridas acima de ${brl(cpk * 3)}/km.`,
      });
    }
    if (sToday.idleMin > sToday.workedMin * 0.5 && sToday.idleMin > 60) {
      alerts.push({
        id: "tempo-parado-alto",
        kind: "aviso",
        severity: "warning",
        title: "Muito tempo parado",
        message: `${Math.round(sToday.idleMin)} min ociosos hoje. Testar outra região ou horário pode elevar o ganho/hora.`,
      });
    }
    alerts.push({
      id: "ticket-medio",
      kind: "dica",
      severity: "info",
      title: `Ticket médio de ${brl(ticket)}`,
      message: `Com ${sToday.count} entregas e ${brl(sToday.perHour)}/hora hoje.`,
    });
  }

  // ---- Entregas em rota esquecidas ----
  const emRota = deliveries.filter(
    (d) => (d as unknown as { status?: string }).status === "em_rota",
  );
  if (emRota.length) {
    alerts.push({
      id: "entregas-em-rota",
      kind: "lembrete",
      severity: "warning",
      title: `${emRota.length} entrega(s) em rota`,
      message: "Finalize com o endereço de entrega para os cálculos de distância ficarem corretos.",
    });
  }

  // ---- Sem registro hoje ----
  if (!today.length && now.getHours() >= 12) {
    alerts.push({
      id: "sem-registro-hoje",
      kind: "lembrete",
      severity: "info",
      title: "Nenhuma entrega registrada hoje",
      message: "Registre suas corridas para acompanhar lucro real e metas em tempo real.",
    });
  }

  // ---- Motivacional do dia ----
  const idx = new Date().getDate() % MOTIVATION.length;
  alerts.push({
    id: "motivacional-dia",
    kind: "motivacional",
    severity: "success",
    title: "Dica do dia",
    message: MOTIVATION[idx]!,
  });

  const order = { danger: 0, warning: 1, success: 2, info: 3 } as const;
  return alerts.sort((a, b) => order[a.severity] - order[b.severity]);
}

/** Constrói os alertas e dispara toasts (uma vez por dia) dos mais urgentes. */
export function useSmartAlerts(input: Parameters<typeof buildAlerts>[0]) {
  const alerts = useMemo(
    () => buildAlerts(input),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      input.deliveries,
      input.fuelings,
      input.maintenances,
      input.expenses,
      input.goals,
      input.profile,
    ],
  );

  const signature = alerts
    .filter((a) => a.toast)
    .map((a) => a.id)
    .join("|");

  useEffect(() => {
    for (const a of alerts) {
      if (!a.toast || !shouldToast(a.id)) continue;
      const fn =
        a.severity === "danger"
          ? toast.error
          : a.severity === "success"
            ? toast.success
            : a.severity === "warning"
              ? toast.warning
              : toast;
      fn(a.title, { description: a.message, duration: 7000 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  return alerts;
}
