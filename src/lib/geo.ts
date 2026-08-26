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

export type CurrentPosition = {
  lat: number;
  lng: number;
  accuracy: number;
};

const POSITION_OPTIONS: PositionOptions = {
  enableHighAccuracy: true,
  timeout: 12000,
  maximumAge: 15000,
};

const reverseGeocodeCache = new Map<string, { name: string; address: string }>();

function coordsCacheKey(lat: number, lng: number) {
  return `${lat.toFixed(5)},${lng.toFixed(5)}`;
}

export function geolocationErrorMessage(error: GeolocationPositionError) {
  if (error.code === error.PERMISSION_DENIED) {
    return "Permissão de localização negada — libere o GPS nas configurações do navegador";
  }
  if (error.code === error.TIMEOUT) {
    return "O GPS demorou demais para responder. Tente novamente a céu aberto.";
  }
  return "Não foi possível obter a localização";
}

export function isGeolocationError(error: unknown): error is GeolocationPositionError {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof (error as { code?: unknown }).code === "number"
  );
}

export function getCurrentPosition(options: PositionOptions = POSITION_OPTIONS) {
  return new Promise<CurrentPosition>((resolve, reject) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      reject(new Error("GPS indisponível neste dispositivo"));
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (pos) =>
        resolve({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: Math.round(pos.coords.accuracy ?? 0),
        }),
      reject,
      options,
    );
  });
}

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
  const cacheKey = coordsCacheKey(lat, lng);
  const cached = reverseGeocodeCache.get(cacheKey);
  if (cached) return cached;

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
  const result = { name: json.name ?? "", address: short || json.display_name || "" };
  reverseGeocodeCache.set(cacheKey, result);
  return result;
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
  try {
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
  } catch {
    // Servidor de rota público indisponível/instável — quem chamar deve usar o reserva (linha reta).
    return null;
  }
}

/** Distância em linha reta entre dois pontos (Haversine), em km. */
function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.asin(Math.sqrt(a));
}

/**
 * Rota com reserva: tenta a rota real (OSRM); se o serviço público falhar
 * (fora do ar, instável, limite de uso), cai para a distância em linha reta
 * multiplicada por um fator de correção (ruas raramente são retas),
 * para nunca deixar a entrega salva com 0 km por causa de uma falha externa.
 */
export async function fetchRouteWithFallback(
  points: [number, number][],
): Promise<(RouteResult & { approximate?: boolean }) | null> {
  const real = await fetchRoute(points);
  if (real) return real;
  if (points.length < 2) return null;

  const STRAIGHT_LINE_CORRECTION = 1.3; // ruas curvam; compensação típica urbana
  let totalKm = 0;
  const legs: RouteLeg[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const [lat1, lng1] = points[i]!;
    const [lat2, lng2] = points[i + 1]!;
    const km =
      Math.round(haversineKm(lat1, lng1, lat2, lng2) * STRAIGHT_LINE_CORRECTION * 100) / 100;
    legs.push({ distanceKm: km, durationMin: Math.round((km / 30) * 60) }); // estimativa a 30 km/h
    totalKm += km;
  }
  return {
    distanceKm: Math.round(totalKm * 100) / 100,
    durationMin: legs.reduce((s, l) => s + l.durationMin, 0),
    coords: points,
    points,
    legs,
    approximate: true,
  };
}

export function navigationUrl(
  stops: { address: string; lat: number | null; lng: number | null }[],
) {
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
