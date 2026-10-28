import type { Delivery } from "@/lib/data";
import { deliveryMinutes } from "@/lib/operation-time";

export type AppInsight = {
  app: string;
  count: number;
  revenue: number;
  earnings: number;
  tips: number;
  km: number;
  minutes: number;
  idleMin: number;
  cost: number;
  profit: number;
  perKm: number;
  perHour: number;
  ticket: number;
  revenueShare: number;
  countShare: number;
  activeDays: number;
  bestHour: number | null;
  payments: { credito: number; pix: number; dinheiro: number };
};

/** Detailed per-app comparison for users working with more than one delivery app. */
export function appInsights(deliveries: Delivery[], costPerKm: number): AppInsight[] {
  type Acc = Omit<AppInsight, "cost" | "profit" | "perKm" | "perHour" | "ticket" | "revenueShare" | "countShare" | "activeDays" | "bestHour"> & {
    days: Set<string>;
    hours: number[];
  };
  const map = new Map<string, Acc>();
  let totalRevenue = 0;
  for (const d of deliveries) {
    const app = d.app_name?.trim() || "Sem aplicativo";
    const cur =
      map.get(app) ??
      ({
        app, count: 0, revenue: 0, earnings: 0, tips: 0, km: 0, minutes: 0, idleMin: 0,
        payments: { credito: 0, pix: 0, dinheiro: 0 }, days: new Set(), hours: new Array(24).fill(0),
      } as Acc);
    const earnings = Number(d.earnings) || 0;
    const tip = Number(d.tip) || 0;
    const revenue = earnings + tip;
    const at = new Date(d.occurred_at);
    cur.count += 1;
    cur.earnings += earnings;
    cur.tips += tip;
    cur.revenue += revenue;
    cur.km += Number(d.distance_km) || 0;
    cur.minutes += deliveryMinutes(d);
    cur.idleMin += Number(d.idle_min) || 0;
    if (d.payment_method in cur.payments) cur.payments[d.payment_method] += revenue;
    cur.days.add(`${at.getFullYear()}-${at.getMonth()}-${at.getDate()}`);
    cur.hours[at.getHours()] = (cur.hours[at.getHours()] ?? 0) + revenue;
    totalRevenue += revenue;
    map.set(app, cur);
  }
  const total = deliveries.length;
  return [...map.values()]
    .map(({ days, hours, ...r }) => {
      const cost = r.km * costPerKm;
      let bestHour: number | null = null;
      hours.forEach((v, h) => {
        if (v > 0 && (bestHour === null || v > (hours[bestHour] ?? 0))) bestHour = h;
      });
      return {
        ...r,
        cost,
        profit: r.revenue - cost,
        perKm: r.km ? r.revenue / r.km : 0,
        perHour: r.minutes ? r.revenue / (r.minutes / 60) : 0,
        ticket: r.count ? r.revenue / r.count : 0,
        revenueShare: totalRevenue ? r.revenue / totalRevenue : 0,
        countShare: total ? r.count / total : 0,
        activeDays: days.size,
        bestHour,
      };
    })
    .sort((a, b) => b.profit - a.profit);
}
