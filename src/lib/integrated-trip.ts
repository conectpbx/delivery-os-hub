import type { GpsDeviceState } from "./gps-integration";
import type { TripState } from "./trip-tracker";
import { haversineKm } from "./gps-distance";

export type IntegratedBaseline = {
  tokenId: string;
  totalKm: number;
  tripKm: number;
  capturedAt: string;
  distanceMode?: "counter" | "coordinates";
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
  const point =
    Number.isFinite(reading.latitude) &&
    Math.abs(reading.latitude) <= 90 &&
    Number.isFinite(reading.longitude) &&
    Math.abs(reading.longitude) <= 180 &&
    Number.isFinite(reading.accuracy_m) &&
    reading.accuracy_m >= 0 &&
    reading.accuracy_m <= 60
      ? {
          lat: reading.latitude,
          lng: reading.longitude,
          accuracy: reading.accuracy_m,
          at: reading.captured_at,
        }
      : null;
  if (!previous) {
    if (Date.parse(next.capturedAt) < Date.parse(trip.startedAt)) return null;
    return {
      ...trip,
      source: "external",
      integratedBaseline: next,
      last: point,
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
  const maxDistance = Math.max(0.2, elapsedHours * 180);
  const coordinateDelta = point && trip.last ? haversineKm(trip.last, point) : 0;
  const mode =
    previous.distanceMode ??
    (delta > 0 ? "counter" : coordinateDelta >= 0.015 ? "coordinates" : undefined);
  // Mantém uma única fonte de distância por jornada para não somar o mesmo trecho duas vezes.
  // Contadores arredondados precisam de tempo suficiente: um salto rejeitado não apaga a base.
  if (mode !== "coordinates" && delta > maxDistance) return null;
  const distance =
    mode === "coordinates"
      ? coordinateDelta >= 0.015 && coordinateDelta <= maxDistance
        ? coordinateDelta
        : 0
      : delta >= 0
        ? delta
        : 0;
  return {
    ...trip,
    source: "external",
    integratedBaseline: { ...next, ...(mode ? { distanceMode: mode } : {}) },
    last: mode === "coordinates" && coordinateDelta < 0.015 ? (trip.last ?? point) : point,
    distanceKm: Math.round((trip.distanceKm + distance) * 1000) / 1000,
    points: trip.points + 1,
  };
}
