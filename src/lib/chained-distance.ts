import { useQuery } from "@tanstack/react-query";
import type { Delivery } from "@/lib/data";
import { fetchRouteWithFallback } from "@/lib/geo";

export type StoredStop = {
  kind: string;
  address: string;
  lat: number | null;
  lng: number | null;
  recorded_at?: string;
};

export function pointsOfDelivery(d: Delivery): [number, number][] {
  const st = ((d as unknown as { stops?: StoredStop[] }).stops ?? []).filter(
    (s) => s.lat != null && s.lng != null,
  );
  if (st.length) return st.map((s) => [s.lat as number, s.lng as number] as [number, number]);
  if (d.lat != null && d.lng != null) return [[d.lat, d.lng] as [number, number]];
  return [];
}

type RoutePoint = { coordinates: [number, number]; recordedAt: number; sequence: number };

/** Intercala pontos de entregas simultâneas pela hora em que cada ponto foi salvo. */
export function orderedRoutePoints(deliveries: Delivery[]): [number, number][] {
  const points: RoutePoint[] = deliveries.flatMap((delivery, deliveryIndex) => {
    const stops = ((delivery as unknown as { stops?: StoredStop[] }).stops ?? []).filter(
      (stop) => stop.lat != null && stop.lng != null,
    );
    const deliveryTime = new Date(delivery.occurred_at).getTime();

    if (!stops.length && delivery.lat != null && delivery.lng != null) {
      return [
        {
          coordinates: [delivery.lat, delivery.lng],
          recordedAt: deliveryTime,
          sequence: deliveryIndex,
        },
      ];
    }

    return stops.map((stop, stopIndex) => ({
      coordinates: [stop.lat as number, stop.lng as number] as [number, number],
      recordedAt: stop.recorded_at ? new Date(stop.recorded_at).getTime() : deliveryTime,
      sequence: deliveryIndex * 1000 + stopIndex,
    }));
  });

  points.sort((a, b) => a.recordedAt - b.recordedAt || a.sequence - b.sequence);

  // Remove somente repetições consecutivas. Voltar ao mesmo local mais tarde conta no trajeto.
  return points
    .map((point) => point.coordinates)
    .filter((point, index, all) => {
      const previous = all[index - 1];
      return !previous || point[0] !== previous[0] || point[1] !== previous[1];
    });
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
  const ordered = [...deliveries].sort(
    (a, b) => new Date(a.occurred_at).getTime() - new Date(b.occurred_at).getTime(),
  );
  const kmSum = ordered.reduce((s, d) => s + Number(d.distance_km), 0);

  const chainPoints = orderedRoutePoints(ordered);

  const chainKey = chainPoints.map(([a, b]) => `${a.toFixed(5)},${b.toFixed(5)}`).join("|");
  const chained = useQuery({
    queryKey: ["chained-km", chainKey],
    enabled: chainPoints.length >= 2,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
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
