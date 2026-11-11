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
    const pair = validCoordinates(stop.lat, stop.lng) ?? coordinateAddress(stop.address ?? "");
    return { ...stop, address: stop.address ?? "", lat: pair?.[0] ?? null, lng: pair?.[1] ?? null };
  });
  const initial = validCoordinates(d.lat, d.lng);
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
  if (d.dropoff_address && !result.some((stop) => stop.address === d.dropoff_address))
    result.push({
      kind: "entrega",
      address: d.dropoff_address,
      lat: null,
      lng: null,
      recorded_at: d.ended_at ?? d.occurred_at,
    });
  return result;
}
export function pointsOfDelivery(d: Delivery): [number, number][] {
  return stopsOf(d).flatMap((stop) => {
    const pair = validCoordinates(stop.lat, stop.lng);
    return pair ? [pair] : [];
  });
}
type RoutePoint = { coordinates: [number, number]; recordedAt: number; sequence: number };

/** Interleave simultaneous deliveries by actual capture time; retain returns to the same place. */
export function orderedRoutePoints(deliveries: Delivery[]): [number, number][] {
  const points: RoutePoint[] = deliveries.flatMap((delivery, deliveryIndex) =>
    stopsOf(delivery).flatMap((stop, stopIndex) => {
      const coordinates = validCoordinates(stop.lat, stop.lng);
      if (!coordinates) return [];
      const time = Date.parse(stop.recorded_at ?? "");
      const fallback = Date.parse(delivery.occurred_at);
      return [
        {
          coordinates,
          recordedAt: Number.isFinite(time) ? time : Number.isFinite(fallback) ? fallback : 0,
          sequence: deliveryIndex * 1000 + stopIndex,
        },
      ];
    }),
  );
  points.sort((a, b) => a.recordedAt - b.recordedAt || a.sequence - b.sequence);
  return points
    .map((point) => point.coordinates)
    .filter((point, index, all) => {
      const previous = all[index - 1];
      return !previous || point[0] !== previous[0] || point[1] !== previous[1];
    });
}

/** Recover address-only historical stops without rewriting the user's records. */
export async function resolveChainedPoints(
  deliveries: Delivery[],
  signal?: AbortSignal,
): Promise<[number, number][]> {
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
  return orderedRoutePoints(resolved);
}

function haversine(a: [number, number], b: [number, number]) {
  const R = 6371;
  const dLat = ((b[0] - a[0]) * Math.PI) / 180;
  const dLng = ((b[1] - a[1]) * Math.PI) / 180;
  const lat1 = (a[0] * Math.PI) / 180;
  const lat2 = (b[0] * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * R * Math.asin(Math.sqrt(h));
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
      kmSum: ordered.reduce((sum, delivery) => sum + Number(delivery.distance_km), 0),
      potentialPoints: ordered.reduce((count, delivery) => count + stopsOf(delivery).length, 0),
      chainKey: JSON.stringify(
        ordered.map((delivery) => [delivery.id, delivery.occurred_at, stopsOf(delivery)]),
      ),
    };
  }, [deliveries]);
  const chained = useQuery({
    queryKey: ["chained-km", chainKey],
    enabled: potentialPoints >= 2,
    staleTime: 1000 * 60 * 60 * 24,
    gcTime: 1000 * 60 * 60 * 24 * 7,
    refetchOnWindowFocus: false,
    queryFn: async ({ signal }) => {
      const chainPoints = await resolveChainedPoints(deliveries, signal);
      if (chainPoints.length < 2) return null;
      const r = await fetchRouteWithFallback(chainPoints);
      if (!r) return null;
      if (!r.legs.length) return r.distanceKm;
      let sum = 0;
      r.legs.forEach((leg: { distanceKm: number }, i: number) => {
        const a = chainPoints[i];
        const b = chainPoints[i + 1];
        if (!a || !b) return;
        const cap = haversine(a, b) * 2.5 + 2;
        sum += Math.min(leg.distanceKm, cap);
      });
      return Math.round(sum * 100) / 100;
    },
  });

  const chainKm = chained.data ?? null;
  const totalKm = chainKm ?? kmSum;

  return { kmSum, chainKm, totalKm, km: totalKm, isLoading: chained.isLoading };
}
