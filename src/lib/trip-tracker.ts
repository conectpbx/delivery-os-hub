import { useCallback, useEffect, useRef, useState } from "react";

const KEY = "deliveryos.trip";

export type GpsPoint = {
  lat: number;
  lng: number;
  accuracy?: number;
  at?: string;
};

export type TripSource = "browser" | "external";

export type TripState = {
  active: boolean;
  source: TripSource;
  startedAt: string | null;
  endedAt: string | null;
  distanceKm: number;
  points: number;
  last: GpsPoint | null;
};

const EMPTY: TripState = {
  active: false,
  source: "browser",
  startedAt: null,
  endedAt: null,
  distanceKm: 0,
  points: 0,
  last: null,
};

export function haversineKm(a: GpsPoint, b: GpsPoint) {
  const R = 6371;
  const toRad = (v: number) => (v * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * R * Math.asin(Math.sqrt(h));
}

function load(): TripState {
  if (typeof window === "undefined") return EMPTY;
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? ({ ...EMPTY, ...(JSON.parse(raw) as TripState) }) : EMPTY;
  } catch {
    return EMPTY;
  }
}

function save(state: TripState) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* storage indisponível */
  }
}

function ingest(
  cur: TripState,
  point: GpsPoint,
  maxAccuracy = 50,
): { next: TripState | null; reason?: "not-active" | "inaccurate" | "noise" | "jump" } {
  if (!cur.active) return { next: null, reason: "not-active" };
  const acc = point.accuracy ?? 999;
  if (acc > maxAccuracy) return { next: null, reason: "inaccurate" };

  const prev = cur.last;
  let add = 0;
  if (prev) {
    const d = haversineKm(prev, point);
    // ignora ruído (<15m) e saltos absurdos (>2km entre leituras)
    if (d >= 0.015 && d <= 2) add = d;
    else if (d < 0.015) return { next: null, reason: "noise" };
    else return { next: null, reason: "jump" };
  }

  return {
    next: {
      ...cur,
      source: "external",
      distanceKm: Math.round((cur.distanceKm + add) * 1000) / 1000,
      points: cur.points + 1,
      last: point,
    },
  };
}

/**
 * Captura contínua de quilometragem via GPS.
 * Filtra pontos imprecisos (>50m de erro) e saltos irreais para evitar inflar a distância.
 * Também aceita pontos vindos de um app nativo pela rede Wi-Fi (pushGps).
 */
export function useTripTracker() {
  const [state, setState] = useState<TripState>(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const watchId = useRef<number | null>(null);
  const stateRef = useRef<TripState>(EMPTY);

  const apply = useCallback((next: TripState) => {
    stateRef.current = next;
    setState(next);
    save(next);
  }, []);

  useEffect(() => {
    const loaded = load();
    stateRef.current = loaded;
    setState(loaded);
  }, []);

  const startWatch = useCallback(() => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setError("GPS indisvironível neste dispositivo");
      return;
    }
    if (watchId.current != null) return;
    watchId.current = navigator.geolocation.watchPosition(
      (pos) => {
        const cur = stateRef.current;
        const point = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy ?? 999,
        };
        const result = ingest(cur, point, 50);
        if (!result.next) return;
        apply({ ...result.next, source: "browser" });
      },
      (err) => setError(err.message),
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 },
    );
  }, [apply]);

  const stopWatch = useCallback(() => {
    if (watchId.current != null && typeof navigator !== "undefined") {
      navigator.geolocation.clearWatch(watchId.current);
    }
    watchId.current = null;
  }, []);

  // Retoma a captura ao recarregar a página com jornada ativa (somente no browser).
  useEffect(() => {
    if (state.active && state.source === "browser") startWatch();
    return stopWatch;
  }, [state.active, state.source, startWatch, stopWatch]);

  const pushGps = useCallback(
    (point: GpsPoint) => {
      const cur = stateRef.current;
      const result = ingest(cur, point, 60);
      if (result.next) apply(result.next);
    },
    [apply],
  );

  const start = useCallback(() => {
    setError(null);
    const next = { ...EMPTY, active: true, startedAt: new Date().toISOString() };
    apply(next);
    startWatch();
  }, [apply, startWatch]);

  const finish = useCallback(() => {
    stopWatch();
    apply({ ...stateRef.current, active: false, endedAt: new Date().toISOString(), last: null });
  }, [apply, stopWatch]);

  const reset = useCallback(() => {
    stopWatch();
    apply(EMPTY);
  }, [apply, stopWatch]);

  return { trip: state, error, start, finish, reset, pushGps };
}
