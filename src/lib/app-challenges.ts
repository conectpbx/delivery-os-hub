import { z } from "zod";
import type { Delivery } from "./data";

export const challengeSchema = z
  .object({
    app_name: z.string().trim().min(1, "Informe o aplicativo").max(100),
    title: z.string().trim().min(1, "Informe o desafio").max(200),
    starts_at: z.string().datetime(),
    ends_at: z.string().datetime(),
    metric: z.enum(["deliveries", "revenue"]),
    target: z.number().finite().positive("A meta deve ser maior que zero").lt(1e9),
    auto_receive: z.boolean().default(true),
    reward: z.number().finite().positive("A bonificação deve ser maior que zero").lt(1e9),
  })
  .superRefine((v, ctx) => {
    if (Date.parse(v.ends_at) < Date.parse(v.starts_at))
      ctx.addIssue({
        code: "custom",
        path: ["ends_at"],
        message: "O fim deve ser posterior ao início",
      });
    if (v.metric === "deliveries" && !Number.isInteger(v.target))
      ctx.addIssue({
        code: "custom",
        path: ["target"],
        message: "Informe uma quantidade inteira de entregas",
      });
  });
export type AppChallenge = Omit<z.infer<typeof challengeSchema>, "auto_receive"> & {
  auto_receive?: boolean;
  id: string;
  received_at: string | null;
};
export const normalizedApp = (name: string) => name.trim().toLocaleLowerCase("pt-BR");

export function challengeProgress(challenge: AppChallenge, deliveries: Delivery[], now: Date) {
  const start = Date.parse(challenge.starts_at);
  const end = Date.parse(challenge.ends_at);
  const eligible = deliveries.filter((d) => {
    const at = Date.parse(d.occurred_at);
    return (
      d.status !== "em_rota" &&
      normalizedApp(d.app_name ?? "") === normalizedApp(challenge.app_name) &&
      at >= start &&
      at <= end &&
      at <= now.getTime()
    );
  });
  const value =
    challenge.metric === "deliveries"
      ? eligible.length
      : eligible.reduce((n, d) => n + Number(d.earnings) + Number(d.tip), 0);
  const achieved = value >= Number(challenge.target);
  const status = challenge.received_at
    ? challenge.auto_receive
      ? "Creditada"
      : "Recebida"
    : achieved
      ? "Conquistada"
      : now.getTime() < start
        ? "Não iniciada"
        : now.getTime() > end
          ? "Encerrada sem atingir"
          : "Em andamento";
  return {
    value,
    achieved,
    status,
    percent: Math.min(100, Math.max(0, (value / Number(challenge.target)) * 100)),
  };
}

/** Receipt date determines cash recognition. Goals and delivery counts never include rewards. */
export function receivedBonuses(challenges: AppChallenge[], from: Date, to: Date, app?: string) {
  return challenges.filter(
    (c) =>
      c.received_at &&
      Date.parse(c.received_at) >= from.getTime() &&
      Date.parse(c.received_at) <= to.getTime() &&
      (!app || normalizedApp(c.app_name) === normalizedApp(app)),
  );
}
export function bonusTotal(challenges: AppChallenge[], from: Date, to: Date, app?: string) {
  return receivedBonuses(challenges, from, to, app).reduce((n, c) => n + Number(c.reward), 0);
}

export function addBonusIncome<
  T extends {
    revenue: number;
    profit: number;
    distance: number;
    workedMin: number;
    idleMin: number;
  },
>(summary: T, bonus: number): T {
  const revenue = summary.revenue + bonus;
  const hours = (summary.workedMin + summary.idleMin) / 60;
  return {
    ...summary,
    revenue,
    profit: summary.profit + bonus,
    perKm: summary.distance > 0 ? revenue / summary.distance : 0,
    perHour: hours > 0 ? revenue / hours : 0,
  };
}
