import type { GpsDeviceState } from "./gps-integration";
import type { TripState } from "./trip-tracker";

export type IntegratedBaseline = {
  tokenId: string;
  totalKm: number;
  tripKm: number;
  capturedAt: string;
};

export function gpsCounterBaseline(
  reading: GpsDeviceState,
  now = Date.now(),
): IntegratedBaseline | null {
  const captured = Date.parse(reading.captured_at);
  const received = Date.parse(reading.received_at);
  if (
    !reading.token_id ||
    !Number.isFinite(reading.total_km) ||
    reading.total_km < 0 ||
    !Number.isFinite(captured) ||
    !Number.isFinite(received) ||
    !Number.isFinite(reading.trip_km) ||
    reading.trip_km < 0 ||
    received < now - 300_000 ||
    received > now + 300_000 ||
    captured < now - 300_000 ||
    captured > now + 300_000
  )
    return null;
  return {
    tokenId: reading.token_id,
    totalKm: reading.total_km,
    tripKm: reading.trip_km,
    capturedAt: reading.captured_at,
  };
}

/** O contador do dispositivo inclui os trechos entre consultas e sobrevive a recargas. */
export function accumulateIntegratedTrip(
  trip: TripState,
  reading: GpsDeviceState,
  now = Date.now(),
): TripState | null {
  if (!trip.active || !trip.startedAt) return null;
  const next = gpsCounterBaseline(reading, now);
  if (!next) return null;
  const previous = trip.integratedBaseline;
  if (!previous) {
    if (Date.parse(next.capturedAt) < Date.parse(trip.startedAt)) return null;
    return {
      ...trip,
      source: "external",
      integratedBaseline: next,
      last: null,
      points: trip.points + 1,
    };
  }
  if (
    next.tokenId !== previous.tokenId ||
    Date.parse(next.capturedAt) <= Date.parse(previous.capturedAt)
  )
    return null;
  const totalDelta = next.totalKm - previous.totalKm;
  const delta = totalDelta === 0 ? next.tripKm - previous.tripKm : totalDelta;
  const elapsedHours = (Date.parse(next.capturedAt) - Date.parse(previous.capturedAt)) / 3_600_000;
  // Uma reinicialização do contador não reduz a jornada. Saltos não viram quilômetros.
  const distance = delta >= 0 && delta <= Math.max(0.2, elapsedHours * 180) ? delta : 0;
  return {
    ...trip,
    source: "external",
    integratedBaseline: next,
    last: null,
    distanceKm: Math.round((trip.distanceKm + distance) * 1000) / 1000,
    points: trip.points + 1,
  };
}
