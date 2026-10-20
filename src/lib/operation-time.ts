import type { Delivery } from "./data";

export const PAUSE_REASONS = ["Almoço", "Descanso", "Manutenção", "Abastecimento", "Pessoal", "Outros"] as const;
export type JourneyPause = {
  id: string;
  reason: string;
  started_at: string;
  ended_at: string | null;
};

export function beginPause(pauses: JourneyPause[], reason: string, at: string): JourneyPause[] {
  if (!reason.trim() || pauses.some((p) => !p.ended_at)) return pauses;
  return [...pauses, { id: crypto.randomUUID(), reason: reason.trim(), started_at: at, ended_at: null }];
}

export function endPause(pauses: JourneyPause[], at: string): JourneyPause[] {
  return pauses.map((p) => p.ended_at ? p : { ...p, ended_at: new Date(Math.max(Date.parse(p.started_at), Date.parse(at))).toISOString() });
}

export type WorkJourney = {
  id: string;
  started_at: string;
  ended_at: string | null;
  distance_km: number;
  source: string;
  pauses?: JourneyPause[];
};

type Interval = [number, number];
function unionMinutes(intervals: Interval[]) {
  const sorted = intervals.filter(([a, b]) => b > a).sort((a, b) => a[0] - b[0]);
  let end = 0;
  let milliseconds = 0;
  for (const [a, b] of sorted) {
    milliseconds += Math.max(0, b - Math.max(a, end));
    end = Math.max(end, b);
  }
  return milliseconds / 60000;
}

export function deliveryMinutes(delivery: Delivery, now = new Date()) {
  const interval = deliveryInterval(delivery, now);
  if (interval) {
    return Math.max(0, (interval[1] - interval[0]) / 60000);
  }
  return Math.max(0, Number(delivery.duration_min) || 0);
}

/** Legacy open routes were created at pickup: use that timestamp only when an end or open status exists. */
export function deliveryInterval(delivery: Delivery, now = new Date()): Interval | null {
  if (!delivery.ended_at && delivery.status !== "em_rota") return null;
  const start = Date.parse(delivery.started_at ?? delivery.occurred_at);
  const end = delivery.ended_at ? Date.parse(delivery.ended_at) : now.getTime();
  return Number.isFinite(start) && Number.isFinite(end) && end >= start ? [start, end] : null;
}

/** Elapsed time is independent of GPS and overlapping routes are never double-counted. */
export function operationTime(
  deliveries: Delivery[],
  journeys: WorkJourney[],
  from: Date,
  to: Date,
  now = new Date(),
) {
  const lower = from.getTime();
  const upper = Math.min(to.getTime() + 1, now.getTime());
  const clip = (a: number, b: number): Interval => [Math.max(lower, a), Math.min(upper, b)];
  const journeyIntervals = journeys.map((j) =>
    clip(Date.parse(j.started_at), j.ended_at ? Date.parse(j.ended_at) : now.getTime()),
  );
  const pauseIntervals = journeys.flatMap((j) => (j.pauses ?? []).map((p) =>
    clip(Math.max(Date.parse(j.started_at), Date.parse(p.started_at)),
      Math.min(j.ended_at ? Date.parse(j.ended_at) : now.getTime(), p.ended_at ? Date.parse(p.ended_at) : now.getTime())),
  )).filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b) && b > a);
  const withoutPauses = (interval: Interval): Interval[] => {
    let fragments = [interval];
    for (const [start, end] of pauseIntervals) {
      fragments = fragments.flatMap(([a, b]) => end <= a || start >= b
        ? [[a, b] as Interval]
        : [[a, Math.min(b, start)], [Math.max(a, end), b]] as Interval[]);
    }
    return fragments.filter(([a, b]) => b > a);
  };
  const routeIntervals: Interval[] = [];
  let legacyDeliveryMin = 0;
  let recordedIdleMin = 0;
  let outsideLegacyMin = 0;
  let outsideIdleMin = 0;
  for (const delivery of deliveries) {
    const occurred = Date.parse(delivery.occurred_at);
    const inPeriod = occurred >= lower && occurred <= upper;
    const covered = journeyIntervals.some(([a, b]) => occurred >= a && occurred < b);
    if (inPeriod) recordedIdleMin += Math.max(0, Number(delivery.idle_min) || 0);
    if (inPeriod && !covered) outsideIdleMin += Math.max(0, Number(delivery.idle_min) || 0);
    const interval = deliveryInterval(delivery, now);
    if (interval) {
      routeIntervals.push(...withoutPauses(clip(interval[0], interval[1])));
    } else if (inPeriod) {
      legacyDeliveryMin += deliveryMinutes(delivery, now);
      if (!covered) outsideLegacyMin += deliveryMinutes(delivery, now);
    }
  }
  const measuredDeliveryMin = unionMinutes(routeIntervals);
  const journeyMin = unionMinutes(journeyIntervals);
  const pauseMin = unionMinutes(pauseIntervals);
  const hasJourney = journeyIntervals.some(([a, b]) => b > a);
  // Outside recorded journeys, retain historical delivery/idle data without inventing a shift.
  const outsideRoutes: Interval[] = [];
  for (const [a, b] of routeIntervals) {
    let fragments: Interval[] = [[a, b]];
    for (const [start, end] of journeyIntervals) {
      fragments = fragments.flatMap(([x, y]) =>
        end <= x || start >= y
          ? [[x, y] as Interval]
          : ([
              [x, Math.min(y, start)],
              [Math.max(x, end), y],
            ] as Interval[]),
      );
    }
    outsideRoutes.push(...fragments);
  }
  const totalMin = hasJourney
    ? journeyMin + unionMinutes(outsideRoutes) + outsideLegacyMin + outsideIdleMin
    : measuredDeliveryMin + legacyDeliveryMin + recordedIdleMin;
  const deliveryMin = hasJourney
    ? Math.min(Math.max(0, totalMin - pauseMin), measuredDeliveryMin + legacyDeliveryMin)
    : measuredDeliveryMin + legacyDeliveryMin;
  return {
    journeyMin,
    deliveryMin,
    totalMin,
    recordedIdleMin,
    hasJourney,
    pauseMin,
    unassignedMin: hasJourney ? Math.max(0, totalMin - deliveryMin - pauseMin) : recordedIdleMin,
  };
}
