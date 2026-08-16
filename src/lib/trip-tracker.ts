import { useCallback, useEffect, useRef, useState } from "react";

const KEY = "deliveryos.trip";

export type TripState = {
  active: boolean;
  startedAt: string | null;
  endedAt: string | null;
  distanceKm: number;
  points: number;
  last: { lat: number; lng: number } | null;
};

const EMPTY: TripState = {
  active: false,
  startedAt: null,
  endedAt: null,
  distanceKm: 0,
  points: 0,
  last: null,
};

export function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
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

/**
 * Captura contínua de quilometragem via GPS.
 * Filtra pontos imprecisos (>50m de erro) e saltos irreais para evitar inflar a distância.
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
      setError("GPS indisponível neste dispositivo");
      return;
    }
    if (watchId.current != null) return;
    watchId.current = navigator.geolocation.watchPosition(
      (pos) => {
        const cur = stateRef.current;
        if (!cur.active) return;
        const acc = pos.coords.accuracy ?? 999;
        if (acc > 50) return;
        const point = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        const prev = cur.last;
        let add = 0;
        if (prev) {
          const d = haversineKm(prev, point);
          // ignora ruído (<15m) e saltos absurdos (>2km entre leituras)
          if (d >= 0.015 && d <= 2) add = d;
          else if (d < 0.015) return;
          else return;
        }
        apply({
          ...cur,
          distanceKm: Math.round((cur.distanceKm + add) * 1000) / 1000,
          points: cur.points + 1,
          last: point,
        });
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

  // Retoma a captura ao recarregar a página com jornada ativa.
  useEffect(() => {
    if (state.active) startWatch();
    return stopWatch;
  }, [state.active, startWatch, stopWatch]);

  const start = useCallback(() => {
    setError(null);
    apply({ ...EMPTY, active: true, startedAt: new Date().toISOString() });
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

  return { trip: state, error, start, finish, reset };
}
