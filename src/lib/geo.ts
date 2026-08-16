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

/** Geocodificação reversa: coordenadas → endereço legível. */
export async function reverseGeocodeAddress(lat: number, lng: number) {
  const res = await fetch(
    `https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=18&addressdetails=1&accept-language=pt-BR&lat=${lat}&lon=${lng}`,
    { headers: { Accept: "application/json" } },
  );
  if (!res.ok) return null;
  const json = (await res.json()) as {
    display_name?: string;
    name?: string;
    address?: Record<string, string>;
  };
  const a = json.address ?? {};
  const road = a["road"] ?? a["pedestrian"] ?? "";
  const city = a["city"] ?? a["town"] ?? a["village"] ?? a["municipality"] ?? "";
  const short = [json.name || road, a["house_number"], city].filter(Boolean).join(", ");
  return { name: json.name ?? "", address: short || json.display_name || "" };
}

/** Busca o posto de combustível mais próximo (Overpass / OpenStreetMap). */
export async function nearestFuelStation(lat: number, lng: number) {
  const query = `[out:json][timeout:15];node(around:400,${lat},${lng})[amenity=fuel];out body 5;`;
  const res = await fetch("https://overpass-api.de/api/interpreter", {
    method: "POST",
    body: `data=${encodeURIComponent(query)}`,
  });
  if (!res.ok) return null;
  const json = (await res.json()) as {
    elements?: Array<{ lat: number; lon: number; tags?: Record<string, string> }>;
  };
  const list = json.elements ?? [];
  if (!list.length) return null;
  let best = list[0]!;
  let bestD = Infinity;
  for (const el of list) {
    const d = (el.lat - lat) ** 2 + (el.lon - lng) ** 2;
    if (d < bestD) {
      bestD = d;
      best = el;
    }
  }
  const t = best.tags ?? {};
  const name = t["name"] ?? t["brand"] ?? t["operator"] ?? "";
  return name || null;
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
      legs?: Array<{ distance: number; duration: number }>;
    }>;
  };
  const route = json.routes?.[0];
  if (!route) return null;
  return {
    distanceKm: Math.round((route.distance / 1000) * 100) / 100,
    durationMin: Math.round(route.duration / 60),
    coords: route.geometry.coordinates.map(([lng, lat]) => [lat, lng] as [number, number]),
    points,
    legs: (route.legs ?? []).map((l) => ({
      distanceKm: Math.round((l.distance / 1000) * 100) / 100,
      durationMin: Math.round(l.duration / 60),
    })),
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
