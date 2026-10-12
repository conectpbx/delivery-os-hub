import type { Delivery } from "./data";

export type WorkJourney = {
  id: string;
  started_at: string;
  ended_at: string | null;
  distance_km: number;
  source: string;
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
  if (delivery.started_at && (delivery.ended_at || delivery.status === "em_rota")) {
    return (
      Math.max(
        0,
        ((delivery.ended_at ? Date.parse(delivery.ended_at) : now.getTime()) -
          Date.parse(delivery.started_at)) /
          60000,
      ) || 0
    );
  }
  return Math.max(0, Number(delivery.duration_min) || 0);
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
    if (delivery.started_at && (delivery.ended_at || delivery.status === "em_rota")) {
      routeIntervals.push(
        clip(
          Date.parse(delivery.started_at),
          delivery.ended_at ? Date.parse(delivery.ended_at) : now.getTime(),
        ),
      );
    } else if (inPeriod) {
      legacyDeliveryMin += deliveryMinutes(delivery, now);
      if (!covered) outsideLegacyMin += deliveryMinutes(delivery, now);
    }
  }
  const measuredDeliveryMin = unionMinutes(routeIntervals);
  const journeyMin = unionMinutes(journeyIntervals);
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
    ? Math.min(totalMin, measuredDeliveryMin + legacyDeliveryMin)
    : measuredDeliveryMin + legacyDeliveryMin;
  return {
    journeyMin,
    deliveryMin,
    totalMin,
    recordedIdleMin,
    hasJourney,
    unassignedMin: hasJourney ? Math.max(0, totalMin - deliveryMin) : recordedIdleMin,
  };
}
