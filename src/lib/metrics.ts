import type { Delivery, Expense, Fueling, Goal, Maintenance, Profile } from "./data";
import { monthKey } from "./format";

export function avgFuelPrice(fuelings: Fueling[]) {
  const valid = fuelings.filter((f) => Number(f.price_per_liter) > 0);
  if (!valid.length) return 6.1;
  return valid.reduce((s, f) => s + Number(f.price_per_liter), 0) / valid.length;
}

export function costPerKm(fuelings: Fueling[], profile: Profile | null | undefined) {
  const eff = Number(profile?.fuel_efficiency) > 0 ? Number(profile?.fuel_efficiency) : 12;
  return avgFuelPrice(fuelings) / eff;
}

export function inRange(iso: string, from: Date, to: Date) {
  const d = new Date(iso).getTime();
  return d >= from.getTime() && d <= to.getTime();
}

export function startOfDay(d = new Date()) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export function endOfDay(d = new Date()) {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

export function startOfWeek(d = new Date()) {
  const start = startOfDay(d);
  const daysSinceMonday = (start.getDay() + 6) % 7;
  start.setDate(start.getDate() - daysSinceMonday);
  return start;
}

export function endOfWeek(d = new Date()) {
  const end = startOfWeek(d);
  end.setDate(end.getDate() + 6);
  return endOfDay(end);
}

export function startOfMonth(d = new Date()) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

export function endOfMonth(d = new Date()) {
  return endOfDay(new Date(d.getFullYear(), d.getMonth() + 1, 0));
}

export type Summary = {
  revenue: number;
  fuelCost: number;
  otherCost: number;
  maintenanceCost: number;
  profit: number;
  distance: number;
  idleMin: number;
  workedMin: number;
  count: number;
  perKm: number;
  perHour: number;
};

export function summarize(
  deliveries: Delivery[],
  expenses: Expense[],
  maintenances: Maintenance[],
  cpk: number,
): Summary {
  const revenue = deliveries.reduce((s, d) => s + Number(d.earnings) + Number(d.tip), 0);
  const distance = deliveries.reduce((s, d) => s + Number(d.distance_km), 0);
  const workedMin = deliveries.reduce((s, d) => s + Number(d.duration_min), 0);
  const idleMin = deliveries.reduce((s, d) => s + Number(d.idle_min), 0);
  const fuelCost = distance * cpk;
  const otherCost = expenses.reduce((s, e) => s + Number(e.amount), 0);
  const maintenanceCost = maintenances.reduce((s, m) => s + Number(m.cost), 0);
  const profit = revenue - fuelCost - otherCost - maintenanceCost;
  const hours = (workedMin + idleMin) / 60;
  return {
    revenue,
    fuelCost,
    otherCost,
    maintenanceCost,
    profit,
    distance,
    idleMin,
    workedMin,
    count: deliveries.length,
    perKm: distance > 0 ? revenue / distance : 0,
    perHour: hours > 0 ? revenue / hours : 0,
  };
}

/**
 * Builds the financial summary from the costs the user actually recorded.
 *
 * `summarize` intentionally estimates fuel consumption from the driven distance
 * for operational projections. Reports, however, must reconcile with the cash
 * entries in Financeiro, so fuel is the sum of the recorded fueling totals.
 */
export function summarizeRecordedCosts(
  deliveries: Delivery[],
  expenses: Expense[],
  maintenances: Maintenance[],
  fuelings: Fueling[],
): Summary {
  const summary = summarize(deliveries, expenses, maintenances, 0);
  const fuelCost = fuelings.reduce((sum, fueling) => sum + Number(fueling.total), 0);

  return {
    ...summary,
    fuelCost,
    profit: summary.revenue - fuelCost - summary.otherCost - summary.maintenanceCost,
  };
}

export function currentRevenueTarget(
  goals: Goal[],
  profile: Profile | null | undefined,
  date = new Date(),
) {
  const key = monthKey(date);
  const monthlyGoal = goals.find((g) => g.month.slice(0, 7) === key);
  return Number(monthlyGoal?.revenue_target ?? 0) || Number(profile?.monthly_goal ?? 0);
}

export function adaptiveDailyRevenueGoal(input: {
  deliveries: Delivery[];
  goals: Goal[];
  profile: Profile | null | undefined;
  date?: Date;
}) {
  const { deliveries, goals, profile } = input;
  const date = input.date ?? new Date();
  const monthTarget = currentRevenueTarget(goals, profile, date);
  const manualDailyGoal = Number(profile?.daily_goal ?? 0);

  if (monthTarget <= 0) {
    return {
      target: manualDailyGoal,
      monthTarget: 0,
      revenueBeforeToday: 0,
      remainingBeforeToday: 0,
      remainingDaysIncludingToday: 0,
      isAdjusted: false,
    };
  }

  const monthStart = new Date(date.getFullYear(), date.getMonth(), 1);
  const todayStart = startOfDay(date);
  const daysInMonth = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  const remainingDaysIncludingToday = Math.max(1, daysInMonth - date.getDate() + 1);
  const revenueBeforeToday = deliveries
    .filter((d) => {
      const occurred = new Date(d.occurred_at);
      return occurred >= monthStart && occurred < todayStart;
    })
    .reduce((sum, d) => sum + Number(d.earnings) + Number(d.tip), 0);
  const remainingBeforeToday = Math.max(0, monthTarget - revenueBeforeToday);
  const adjustedTarget = remainingBeforeToday / remainingDaysIncludingToday;

  return {
    target: adjustedTarget,
    monthTarget,
    revenueBeforeToday,
    remainingBeforeToday,
    remainingDaysIncludingToday,
    isAdjusted: manualDailyGoal > 0 ? Math.abs(adjustedTarget - manualDailyGoal) >= 0.01 : true,
  };
}

export function byApp(deliveries: Delivery[], cpk: number) {
  const map = new Map<string, { app: string; revenue: number; km: number; count: number }>();
  for (const d of deliveries) {
    const cur = map.get(d.app_name) ?? { app: d.app_name, revenue: 0, km: 0, count: 0 };
    cur.revenue += Number(d.earnings) + Number(d.tip);
    cur.km += Number(d.distance_km);
    cur.count += 1;
    map.set(d.app_name, cur);
  }
  return [...map.values()]
    .map((r) => ({ ...r, profit: r.revenue - r.km * cpk, perKm: r.km ? r.revenue / r.km : 0 }))
    .sort((a, b) => b.profit - a.profit);
}

export function byMonth(deliveries: Delivery[], expenses: Expense[], cpk: number) {
  const map = new Map<
    string,
    { month: string; revenue: number; km: number; cost: number; count: number }
  >();
  const ensure = (key: string) => {
    const cur = map.get(key) ?? { month: key, revenue: 0, km: 0, cost: 0, count: 0 };
    map.set(key, cur);
    return cur;
  };
  for (const d of deliveries) {
    const cur = ensure(monthKey(new Date(d.occurred_at)));
    cur.revenue += Number(d.earnings) + Number(d.tip);
    cur.km += Number(d.distance_km);
    cur.count += 1;
  }

  for (const e of expenses) {
    ensure(monthKey(new Date(e.occurred_at))).cost += Number(e.amount);
  }
  return [...map.values()]
    .map((m) => ({ ...m, profit: m.revenue - m.km * cpk - m.cost }))
    .sort((a, b) => a.month.localeCompare(b.month));
}

export function byMonthRecordedCosts(
  deliveries: Delivery[],
  expenses: Expense[],
  fuelings: Fueling[],
  maintenances: Maintenance[],
) {
  const map = new Map<
    string,
    { month: string; revenue: number; km: number; cost: number; count: number }
  >();
  const ensure = (key: string) => {
    const current = map.get(key) ?? { month: key, revenue: 0, km: 0, cost: 0, count: 0 };
    map.set(key, current);
    return current;
  };

  for (const delivery of deliveries) {
    const current = ensure(monthKey(new Date(delivery.occurred_at)));
    current.revenue += Number(delivery.earnings) + Number(delivery.tip);
    current.km += Number(delivery.distance_km);
    current.count += 1;
  }
  for (const expense of expenses) {
    ensure(monthKey(new Date(expense.occurred_at))).cost += Number(expense.amount);
  }
  for (const fueling of fuelings) {
    ensure(monthKey(new Date(fueling.occurred_at))).cost += Number(fueling.total);
  }
  for (const maintenance of maintenances) {
    ensure(monthKey(new Date(maintenance.performed_at))).cost += Number(maintenance.cost);
  }

  return [...map.values()]
    .map((month) => ({ ...month, profit: month.revenue - month.cost }))
    .sort((a, b) => a.month.localeCompare(b.month));
}

export function heatmap(deliveries: Delivery[]) {
  const grid: number[][] = Array.from({ length: 7 }, () => Array<number>(24).fill(0));
  for (const d of deliveries) {
    const date = new Date(d.occurred_at);
    grid[date.getDay()]![date.getHours()] =
      (grid[date.getDay()]![date.getHours()] ?? 0) + Number(d.earnings) + Number(d.tip);
  }
  const max = Math.max(...grid.flat(), 1);
  return { grid, max };
}

export const PERIODS = [
  { key: "1", label: "Hoje", mode: "days", days: 1 },
  { key: "week", label: "Semanal", mode: "week" },
  { key: "15", label: "Quinzenal", mode: "days", days: 15 },
  { key: "month", label: "Mês atual", mode: "month" },
  { key: "all", label: "Tudo", mode: "all" },
] as const;

export type Period = (typeof PERIODS)[number];

export function periodRange(period: Period, now = new Date()) {
  const to =
    period.mode === "week"
      ? endOfWeek(now)
      : period.mode === "month"
        ? endOfMonth(now)
        : endOfDay(now);
  const from =
    period.mode === "month"
      ? startOfMonth(now)
      : period.mode === "week"
        ? startOfWeek(now)
        : period.mode === "days"
          ? startOfDay(new Date(now.getTime() - (period.days - 1) * 86400000))
          : new Date(0);
  return { from, to };
}

export function filterByPeriod<T>(items: T[], key: (item: T) => string, period: Period) {
  const { from, to } = periodRange(period);
  return items.filter((i) => inRange(key(i), from, to));
}

export function filterByRange<T>(items: T[], key: (item: T) => string, from: Date, to: Date) {
  return items.filter((i) => inRange(key(i), from, to));
}

export function costsByCategory(expenses: Expense[]) {
  const map = new Map<string, number>();
  for (const e of expenses) map.set(e.category, (map.get(e.category) ?? 0) + Number(e.amount));
  return [...map.entries()]
    .map(([category, amount]) => ({ category, amount }))
    .sort((a, b) => b.amount - a.amount);
}
