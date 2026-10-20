import { haversineKm } from "./gps-distance";
import type { GpsPoint, TripState } from "./trip-tracker";

/** Filtra sem mover a âncora ao receber ruído: deslocamentos lentos se acumulam. */
export function ingestGpsPoint(
  trip: TripState,
  point: GpsPoint,
  maxAccuracy = 50,
  now = Date.now(),
): { next: TripState | null; reason?: string } {
  if (!trip.active) return { next: null, reason: "not-active" };
  const captured = Date.parse(point.at ?? "");
  const accuracy = point.accuracy;
  if (
    !Number.isFinite(point.lat) ||
    Math.abs(point.lat) > 90 ||
    !Number.isFinite(point.lng) ||
    Math.abs(point.lng) > 180 ||
    accuracy == null ||
    !Number.isFinite(accuracy) ||
    accuracy < 0 ||
    accuracy > maxAccuracy
  )
    return { next: null, reason: "inaccurate" };
  if (
    !Number.isFinite(captured) ||
    captured < now - 60_000 ||
    captured > now + 5_000 ||
    (trip.startedAt != null && captured < Date.parse(trip.startedAt))
  )
    return { next: null, reason: "stale" };

  const previous = trip.last;
  let distance = 0;
  if (previous) {
    const elapsed = captured - Date.parse(previous.at ?? "");
    if (!Number.isFinite(elapsed) || elapsed <= 0) return { next: null, reason: "stale" };
    // Após perda prolongada de sinal, não inventa uma linha reta entre posições.
    if (elapsed <= 60_000) {
      distance = haversineKm(previous, point);
      if (distance / (elapsed / 3_600_000) > 180) return { next: null, reason: "jump" };
      // Boa precisão permite curvas curtas; precisão ruim mantém uma zona morta maior.
      const noiseMeters = Math.max(3, ((previous.accuracy ?? accuracy) + accuracy) / 2);
      if (distance * 1000 < noiseMeters) return { next: null, reason: "noise" };
    }
  }
  return {
    next: {
      ...trip,
      source: "external",
      // Não arredonda cada amostra: isso acumularia erro ao longo da jornada.
      distanceKm: trip.distanceKm + distance,
      points: trip.points + 1,
      last: point,
    },
  };
}
