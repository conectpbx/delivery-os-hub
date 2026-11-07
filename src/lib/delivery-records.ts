import type { Delivery, DeliveryStop } from "./data";
import { geocodeAddress, fetchRouteWithFallback } from "./geo";
export type StoredStop = DeliveryStop;

export function recordedStops(
  stops: (Omit<StoredStop, "recorded_at"> & { recorded_at?: string | undefined })[],
): StoredStop[] {
  const now = Date.now();
  return stops.map((stop, index) => ({
    ...stop,
    recorded_at:
      stop.recorded_at && Number.isFinite(Date.parse(stop.recorded_at))
        ? stop.recorded_at
        : new Date(now + index).toISOString(),
  }));
}

/** Mantém registros antigos visíveis mesmo quando foram salvos antes do histórico de paradas. */
export function historyStops(delivery: Delivery): StoredStop[] {
  if (Array.isArray(delivery.stops) && delivery.stops.length) return delivery.stops;

  const legacy: StoredStop[] = [];
  if (delivery.pickup_address || (delivery.lat != null && delivery.lng != null)) {
    legacy.push({
      kind: "coleta",
      address: delivery.pickup_address ?? "",
      lat: delivery.lat != null ? Number(delivery.lat) : null,
      lng: delivery.lng != null ? Number(delivery.lng) : null,
      recorded_at: delivery.occurred_at,
    });
  }
  if (delivery.dropoff_address) {
    legacy.push({
      kind: "entrega",
      address: delivery.dropoff_address,
      lat: null,
      lng: null,
    });
  }
  return legacy;
}

export function stopLocation(stop: StoredStop) {
  if (stop.address?.trim()) return stop.address.trim();
  if (stop.lat != null && stop.lng != null) {
    return `${Number(stop.lat).toFixed(5)}, ${Number(stop.lng).toFixed(5)}`;
  }
  return "Local não informado";
}

export async function routeTotals(
  pts: { address: string; lat: number | null; lng: number | null }[],
): Promise<{
  distanceKm: number;
  durationMin: number;
  pts: typeof pts;
  approximate: boolean;
} | null> {
  const resolved: typeof pts = [];
  for (const s of pts) {
    if (s.lat != null && s.lng != null) {
      resolved.push(s);
      continue;
    }
    if (!s.address.trim()) continue;
    const hit = await geocodeAddress(s.address);
    resolved.push(hit ? { ...s, ...hit } : s);
  }
  const coords = resolved
    .filter((s) => s.lat != null && s.lng != null)
    .map((s) => [s.lat!, s.lng!] as [number, number]);
  if (coords.length < 2) return null;
  const r = await fetchRouteWithFallback(coords);
  if (!r) return null;
  return {
    distanceKm: r.distanceKm,
    durationMin: r.durationMin,
    pts: resolved,
    approximate: !!r.approximate,
  };
}
