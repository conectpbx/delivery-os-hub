import { recordedDistanceKm } from "./distance-values";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Delivery } from "@/lib/data";
import { validCoordinates, coordinateAddress } from "./delivery-location";
import { geocodeAddress } from "./geo";
import { fetchRouteWithFallback } from "@/lib/geo";

export type StoredStop = {
  kind: string;
  address: string;
  lat: number | null;
  lng: number | null;
  recorded_at?: string;
};

function stopsOf(d: Delivery): StoredStop[] {
  const stops = Array.isArray(d.stops)
    ? d.stops.filter((stop) => stop && typeof stop === "object")
    : [];
  const result: StoredStop[] = stops.map((stop) => {
    const pair =
      validCoordinates(stop.lat, stop.lng) ??
      coordinateAddress(typeof stop.address === "string" ? stop.address : "");
    return {
      ...stop,
      address: typeof stop.address === "string" ? stop.address : "",
      lat: pair?.[0] ?? null,
      lng: pair?.[1] ?? null,
    };
  });
  const initial = validCoordinates(d.lat, d.lng);
  if (initial) {
    const matchingPickup = result.find(
      (stop) =>
        stop.kind === "coleta" &&
        !validCoordinates(stop.lat, stop.lng) &&
        (!stop.address || stop.address.trim() === (d.pickup_address ?? "").trim()) &&
        (!Number.isFinite(Date.parse(stop.recorded_at ?? "")) ||
          Date.parse(stop.recorded_at!) === Date.parse(d.started_at ?? d.occurred_at)),
    );
    if (matchingPickup)
      Object.assign(matchingPickup, {
        lat: initial[0],
        lng: initial[1],
        recorded_at: matchingPickup.recorded_at ?? d.started_at ?? d.occurred_at,
      });
  }

  if (
    initial &&
    !result.some(
      (stop) => stop.lat === initial[0] && stop.lng === initial[1] && stop.kind === "coleta",
    )
  )
    result.unshift({
      kind: "coleta",
      address: d.pickup_address ?? "",
      lat: initial[0],
      lng: initial[1],
      recorded_at: d.started_at ?? d.occurred_at,
    });
  if (!result.some((stop) => stop.kind === "coleta") && d.pickup_address)
    result.unshift({ kind: "coleta", address: d.pickup_address, lat: null, lng: null });
  if (
    d.dropoff_address &&
    !(result.at(-1)?.kind === "entrega" && result.at(-1)?.address === d.dropoff_address)
  )
    result.push({
      kind: "entrega",
      address: d.dropoff_address,
      lat: null,
      lng: null,
      recorded_at: d.ended_at ?? result.at(-1)?.recorded_at ?? d.occurred_at,
    });
  return result;
}
export function pointsOfDelivery(d: Delivery): [number, number][] {
  return stopsOf(d).flatMap((stop) => {
    const pair = validCoordinates(stop.lat, stop.lng);
    return pair ? [pair] : [];
  });
}
type RoutePoint = {
  deliveryId: string;
  coordinates: [number, number] | null;
  recordedAt: number;
  sequence: number;
};
const civilDay = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Sao_Paulo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
function orderedEvents(deliveries: Delivery[]): RoutePoint[] {
  const ordered = [...deliveries].sort(
    (a, b) => Date.parse(a.occurred_at) - Date.parse(b.occurred_at) || a.id.localeCompare(b.id),
  );
  const points = ordered.flatMap((delivery, deliveryIndex) =>
    // A delivery with no location is a gap, not permission to connect A directly to C.
    (stopsOf(delivery).length
      ? stopsOf(delivery)
      : [{ lat: null, lng: null, recorded_at: delivery.occurred_at }]
    ).map((stop, stopIndex) => {
      const time = Date.parse(stop.recorded_at ?? ""),
        fallback = Date.parse(delivery.occurred_at);
      return {
        deliveryId: delivery.id,
        coordinates: validCoordinates(stop.lat, stop.lng),
        recordedAt: Number.isFinite(time) ? time : Number.isFinite(fallback) ? fallback : 0,
        sequence: deliveryIndex * 1000 + stopIndex,
      };
    }),
  );
  return points.sort((a, b) => a.recordedAt - b.recordedAt || a.sequence - b.sequence);
}
export function orderedRoutePoints(deliveries: Delivery[]): [number, number][] {
  return orderedEvents(deliveries)
    .flatMap((point) => (point.coordinates ? [point.coordinates] : []))
    .filter(
      (point, index, all) =>
        !all[index - 1] || point[0] !== all[index - 1]![0] || point[1] !== all[index - 1]![1],
    );
}
/** Do not invent travel between days or across a stop whose location could not be resolved. */
export function chainedRouteSegments(deliveries: Delivery[]): [number, number][][] {
  const segments: [number, number][][] = [];
  let current: [number, number][] = [],
    day = "",
    previousDelivery = "";
  for (const point of orderedEvents(deliveries)) {
    const nextDay = civilDay.format(new Date(point.recordedAt));
    if (!point.coordinates || (nextDay !== day && previousDelivery !== point.deliveryId)) {
      if (current.length >= 2) segments.push(current);
      current = [];
    }
    day = nextDay;
    previousDelivery = point.deliveryId;
    if (!point.coordinates) continue;
    const last = current.at(-1);
    if (!last || last[0] !== point.coordinates[0] || last[1] !== point.coordinates[1])
      current.push(point.coordinates);
  }
  if (current.length >= 2) segments.push(current);
  return segments;
}

/** Recover address-only historical stops without rewriting the user's records. */
async function resolveChainedDeliveries(
  deliveries: Delivery[],
  signal?: AbortSignal,
): Promise<Delivery[]> {
  const resolved: Delivery[] = [];
  // Queue one historical lookup at a time so live GPS reverse lookups can interleave.
  for (const delivery of deliveries) {
    const stops = [];
    for (const stop of stopsOf(delivery)) {
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
      const hit =
        !validCoordinates(stop.lat, stop.lng) && stop.address.trim()
          ? await geocodeAddress(stop.address)
          : null;
      stops.push(hit ? { ...stop, ...hit } : stop);
    }
    resolved.push({ ...delivery, stops } as Delivery);
  }
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
  return resolved;
}

export async function resolveChainedPoints(deliveries: Delivery[], signal?: AbortSignal) {
  return orderedRoutePoints(await resolveChainedDeliveries(deliveries, signal));
}
export async function calculateChainedDistance(
  deliveries: Delivery[],
  router: (
    points: [number, number][],
  ) => Promise<{ distanceKm: number; approximate?: boolean } | null> = fetchRouteWithFallback,
  signal?: AbortSignal,
) {
  const resolved = await resolveChainedDeliveries(deliveries, signal);
  const segments = chainedRouteSegments(resolved);
  let distance = 0,
    count = 0,
    approximate = false;
  let partial = resolved.some(
    (delivery) =>
      !stopsOf(delivery).length ||
      stopsOf(delivery).some((stop) => !validCoordinates(stop.lat, stop.lng)),
  );
  for (const segment of segments) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    const route = await router(segment);
    if (!route || !Number.isFinite(route.distanceKm) || route.distanceKm < 0) {
      partial = true;
      continue;
    }
    // The provider's total already accounts for every leg; do not round/cap each short leg.
    distance += route.distanceKm;
    count++;
    approximate ||= Boolean(route.approximate);
  }
  return {
    distanceKm: count ? Math.round(distance * 100) / 100 : null,
    approximate,
    partial,
    segments: count,
  };
}

/**
 * Calcula a quilometragem total do período encadeando, em ordem cronológica,
 * todos os pontos salvos das entregas (coletas, destinos finais e pontos
 * adicionais). O resultado representa o trajeto do dia desde a primeira coleta
 * confirmada/salva até o último ponto informado.
 */
export function useChainedDistance(deliveries: Delivery[]) {
  const { chainKey, potentialPoints, kmSum } = useMemo(() => {
    const ordered = [...deliveries].sort(
      (a, b) => new Date(a.occurred_at).getTime() - new Date(b.occurred_at).getTime(),
    );
    return {
      kmSum: ordered.reduce((sum, delivery) => sum + recordedDistanceKm(delivery.distance_km), 0),
      potentialPoints: ordered.reduce((count, delivery) => count + stopsOf(delivery).length, 0),
      chainKey: JSON.stringify(
        ordered.map((delivery) => [delivery.id, delivery.occurred_at, stopsOf(delivery)]),
      ),
    };
  }, [deliveries]);
  const chained = useQuery({
    queryKey: ["chained-km", "v3", chainKey],
    enabled: potentialPoints >= 2,
    staleTime: 1000 * 60 * 60 * 24,
    gcTime: 1000 * 60 * 60 * 24 * 7,
    refetchOnWindowFocus: false,
    queryFn: ({ signal }) => calculateChainedDistance(deliveries, fetchRouteWithFallback, signal),
  });

  const chainKm = chained.data?.distanceKm ?? null;
  const totalKm = chainKm ?? kmSum;

  return {
    kmSum,
    chainKm,
    totalKm,
    km: totalKm,
    approximate: chained.data?.approximate ?? false,
    partial: chained.data?.partial ?? false,
    isLoading: chained.isLoading,
  };
}
