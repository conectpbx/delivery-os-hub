export type Stop = {
  id: string;
  kind: "coleta" | "entrega";
  address: string;
  lat: number | null;
  lng: number | null;
};

export type RouteLeg = {
  distanceKm: number;
  durationMin: number;
};

export type RouteResult = {
  distanceKm: number;
  durationMin: number;
  coords: [number, number][]; // [lat, lng]
  points: [number, number][];
  legs: RouteLeg[]; // trecho a trecho: ponto 1→2, 2→3, ...
};


export function newStop(kind: Stop["kind"] = "entrega"): Stop {
  return {
    id: Math.random().toString(36).slice(2),
    kind,
    address: "",
    lat: null,
    lng: null,
  };
}

/** Geocodificação direta gratuita (OpenStreetMap / Nominatim). */
export async function geocodeAddress(address: string) {
  const q = address.trim();
  if (!q) return null;
  const res = await fetch(
    `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&accept-language=pt-BR&countrycodes=br&q=${encodeURIComponent(q)}`,
    { headers: { Accept: "application/json" } },
  );
  if (!res.ok) return null;
  const json = (await res.json()) as Array<{ lat: string; lon: string }>;
  const hit = json[0];
  if (!hit) return null;
  return { lat: Number(hit.lat), lng: Number(hit.lon) };
}

/** Rota real por ruas usando o OSRM público (gratuito). */
export async function fetchRoute(points: [number, number][]): Promise<RouteResult | null> {
  if (points.length < 2) return null;
  const path = points.map(([lat, lng]) => `${lng},${lat}`).join(";");
  const res = await fetch(
    `https://router.project-osrm.org/route/v1/driving/${path}?overview=full&geometries=geojson`,
  );
  if (!res.ok) return null;
  const json = (await res.json()) as {
    routes?: Array<{
      distance: number;
      duration: number;
      geometry: { coordinates: [number, number][] };
    }>;
  };
  const route = json.routes?.[0];
  if (!route) return null;
  return {
    distanceKm: Math.round((route.distance / 1000) * 100) / 100,
    durationMin: Math.round(route.duration / 60),
    coords: route.geometry.coordinates.map(([lng, lat]) => [lat, lng] as [number, number]),
    points,
  };
}

export function navigationUrl(stops: { address: string; lat: number | null; lng: number | null }[]) {
  const usable = stops.filter((s) => s.address || (s.lat != null && s.lng != null));
  if (!usable.length) return null;
  const value = (s: (typeof usable)[number]) =>
    s.lat != null && s.lng != null ? `${s.lat},${s.lng}` : s.address;
  const destination = encodeURIComponent(value(usable[usable.length - 1]!));
  const origin = usable.length > 1 ? encodeURIComponent(value(usable[0]!)) : null;
  const waypoints = usable
    .slice(1, -1)
    .map((s) => encodeURIComponent(value(s)))
    .join("%7C");
  return (
    `https://www.google.com/maps/dir/?api=1&destination=${destination}` +
    (origin ? `&origin=${origin}` : "") +
    (waypoints ? `&waypoints=${waypoints}` : "")
  );
}
