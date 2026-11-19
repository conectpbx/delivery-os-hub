import type { Goal } from "./data";
import type { AppChallenge } from "./app-challenges";

/** Visual grouping only: keep every record for financial history and later review. */
export function monthlyGoalIsFinished(
  goal: Goal,
  currentMonth: string,
  actual?: { revenue: number; profit: number; count: number },
) {
  const month = goal.month.slice(0, 7);
  if (month < currentMonth) return true;
  if (month > currentMonth) return false;
  const targets = [
    [Number(goal.revenue_target), actual?.revenue ?? 0],
    [Number(goal.profit_target), actual?.profit ?? 0],
    [Number(goal.deliveries_target), actual?.count ?? 0],
  ].filter(([target]) => Number.isFinite(target) && target! > 0);
  return targets.length > 0 && targets.every(([target, value]) => value! >= target!);
}
export function challengeIsFinished(challenge: AppChallenge, achieved: boolean, now: Date) {
  return (
    Boolean(challenge.received_at) || achieved || Date.parse(challenge.ends_at) < now.getTime()
  );
}
