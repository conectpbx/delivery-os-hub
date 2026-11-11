import type { TripState } from "./trip-tracker";
import type { Delivery } from "./data";
import { operationTime, type JourneyPause } from "./operation-time";
export type DeliveryBaseline = { journeyId: string; distanceKm: number; at: string };
export function deliveryBaseline(
  trip: TripState,
  at = new Date().toISOString(),
): DeliveryBaseline | null {
  return trip.active && trip.journeyId && Number.isFinite(trip.distanceKm)
    ? { journeyId: trip.journeyId, distanceKm: trip.distanceKm, at }
    : null;
}
/** Preserve only this delivery's baseline; never infer a start from the whole journey. */
export function automaticDeliveryMeasurement(
  trip: TripState,
  baseline: DeliveryBaseline | null,
  startedAt: string | null,
  now = new Date(),
) {
  if (!trip.active || !trip.journeyId || !trip.startedAt || trip.pauses?.some((p) => !p.ended_at))
    return null;
  if (
    baseline?.journeyId === trip.journeyId &&
    startedAt === baseline.at &&
    Date.parse(baseline.at) >= Date.parse(trip.startedAt) &&
    Date.parse(baseline.at) <= now.getTime() &&
    baseline.distanceKm <= trip.distanceKm
  )
    return baseline;
  return deliveryBaseline(trip, now.toISOString());
}
export function deliveryGpsSuggestion(
  trip: TripState,
  baseline: DeliveryBaseline | null,
  now = new Date(),
) {
  if (
    !baseline ||
    !trip.active ||
    baseline.journeyId !== trip.journeyId ||
    !trip.startedAt ||
    trip.pauses?.some((pause) => !pause.ended_at)
  )
    return null;
  const lastReading = Date.parse(
    trip.source === "external" ? (trip.externalGpsAt ?? "") : (trip.browserGpsAt ?? ""),
  );
  if (
    !Number.isFinite(lastReading) ||
    now.getTime() - lastReading > 30_000 ||
    lastReading > now.getTime() + 5000
  )
    return null;
  const distance = trip.distanceKm - baseline.distanceKm;
  if (
    !Number.isFinite(distance) ||
    distance < 0 ||
    Date.parse(baseline.at) < Date.parse(trip.startedAt) ||
    Date.parse(baseline.at) > now.getTime()
  )
    return null;
  const time = operationTime(
    [],
    [
      {
        id: trip.journeyId,
        started_at: trip.startedAt,
        ended_at: null,
        distance_km: trip.distanceKm,
        source: trip.source,
        pauses: trip.pauses ?? [],
      },
    ],
    new Date(baseline.at),
    now,
    now,
  );
  return {
    distanceKm: Math.round(distance * 100) / 100,
    durationMin: Math.max(0, Math.round(time.journeyMin - time.pauseMin)),
  };
}
export function deliveryMoney(gross: number, feePercent: number, tip: number) {
  if (
    !Number.isFinite(gross) ||
    gross <= 0 ||
    gross >= 1e9 ||
    !Number.isFinite(feePercent) ||
    feePercent < 0 ||
    feePercent > 100 ||
    !Number.isFinite(tip) ||
    tip < 0 ||
    tip >= 1e9
  )
    throw new Error("Confira o valor, a taxa e a gratificação da entrega");
  return {
    gross_earnings: gross,
    fee_percent: feePercent,
    earnings: Math.round(gross * (1 - feePercent / 100) * 100) / 100,
    tip,
  };
}
export function frequentDeliveryValues(
  rows: Pick<Delivery, "app_name" | "gross_earnings" | "earnings" | "fee_percent">[],
  app: string,
): number[] {
  const counts = new Map<number, number>();
  for (const row of rows) {
    if (row.app_name !== app) continue;
    const divisor = 1 - Number(row.fee_percent ?? 0) / 100;
    const gross =
      Number(row.gross_earnings) > 0
        ? Number(row.gross_earnings)
        : divisor > 0
          ? Number(row.earnings) / divisor
          : 0;
    const rounded = Math.round(gross * 100) / 100;
    if (Number.isFinite(rounded) && rounded > 0)
      counts.set(rounded, (counts.get(rounded) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([value]) => value);
}

export function deliveryActiveMinutes(from: string, to: string, pauses: JourneyPause[] = []) {
  const start = new Date(from),
    end = new Date(to);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || start > end)
    throw new Error("Confira o horário de início da entrega");
  const time = operationTime(
    [],
    [{ id: "measured", started_at: from, ended_at: to, distance_km: 0, source: "browser", pauses }],
    start,
    end,
    end,
  );
  return Math.max(0, Math.round(time.journeyMin - time.pauseMin));
}

export function deliveryEntryMoney(
  gross: number,
  feePercent: number,
  tip: number,
  mode: "quick" | "full",
) {
  return deliveryMoney(gross, mode === "quick" ? 0 : feePercent, mode === "quick" ? 0 : tip);
}
