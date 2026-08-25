import { useQuery } from "@tanstack/react-query";
import type { Delivery } from "@/lib/data";
import { fetchRouteWithFallback } from "@/lib/geo";

export type StoredStop = { kind: string; address: string; lat: number | null; lng: number | null };

export function pointsOfDelivery(d: Delivery): [number, number][] {
  const st = ((d as unknown as { stops?: StoredStop[] }).stops ?? []).filter(
    (s) => s.lat != null && s.lng != null,
  );
  if (st.length) return st.map((s) => [s.lat as number, s.lng as number] as [number, number]);
  if (d.lat != null && d.lng != null) return [[d.lat, d.lng] as [number, number]];
  return [];
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
 * Replica o cálculo de "Distância total" da tela de Entregas:
 * encadeia cronologicamente todos os pontos salvos (coletas e entregas),
 * ignora pontos repetidos, limita trechos absurdos e devolve o deslocamento
 * entre entregas (trajeto encadeado menos a soma das distâncias individuais).
 */
export function useChainedDistance(deliveries: Delivery[]) {
  const ordered = [...deliveries].sort(
    (a, b) => new Date(a.occurred_at).getTime() - new Date(b.occurred_at).getTime(),
  );
  const kmSum = ordered.reduce((s, d) => s + Number(d.distance_km), 0);

  const seen = new Set<string>();
  const chainPoints = ordered.flatMap(pointsOfDelivery).filter((p) => {
    const key = `${p[0].toFixed(4)},${p[1].toFixed(4)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

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
  const deadheadKm =
    chainKm != null ? Math.max(Math.round((chainKm - kmSum) * 100) / 100, 0) : null;

  return { kmSum, chainKm, deadheadKm, km: deadheadKm ?? 0, isLoading: chained.isLoading };
}
