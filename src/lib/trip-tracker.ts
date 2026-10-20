import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useInsert } from "./data";
import { sendNativeTripCommand, subscribeNativeGps } from "@/lib/native-gps-bridge";
import type { GpsDeviceState } from "./gps-integration";
import {
  accumulateIntegratedTrip,
  gpsCounterBaseline,
  type IntegratedBaseline,
} from "./integrated-trip";

import { ingestGpsPoint } from "./gps-filter";
export { haversineKm } from "./gps-distance";

const PREFIX = "deliveryos.trip:";
const STORAGE_WRITE_DELAY_MS = 3_000;

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
  integratedBaseline?: IntegratedBaseline;
  journeyId?: string;
  pendingSave?: boolean;
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

function load(key: string): TripState {
  if (typeof window === "undefined") return EMPTY;
  try {
    const raw = window.localStorage.getItem(key);
    // Coordenadas exatas nunca são restauradas do armazenamento persistente.
    return raw ? { ...EMPTY, ...(JSON.parse(raw) as TripState), last: null } : EMPTY;
  } catch {
    return EMPTY;
  }
}

function save(key: string | null, state: TripState) {
  if (!key) return;
  try {
    // Persiste somente o resumo da jornada. O último ponto GPS vive apenas em memória.
    window.localStorage.setItem(key, JSON.stringify({ ...state, last: null }));
    window.dispatchEvent(new Event("deliveryos:trip-changed"));
  } catch {
    /* storage indisponível */
  }
}

/**
 * Captura contínua de quilometragem via GPS.
 * Filtra pontos antigos, ruído proporcional à precisão e velocidades irreais.
 * Também aceita pontos vindos de um app nativo pela rede Wi-Fi (pushGps).
 */
export function useTripTracker() {
  const { user, loading } = useAuth();
  const addJourney = useInsert("work_journeys", "work_journeys");
  const storageKey = user ? `${PREFIX}${user.id}` : null;
  const [state, setState] = useState<TripState>(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const watchId = useRef<number | null>(null);
  const stateRef = useRef<TripState>(EMPTY);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const persistSoon = useCallback(() => {
    if (!storageKey || saveTimer.current != null) return;
    saveTimer.current = setTimeout(() => {
      saveTimer.current = null;
      save(storageKey, stateRef.current);
    }, STORAGE_WRITE_DELAY_MS);
  }, [storageKey]);

  const apply = useCallback(
    (next: TripState) => {
      stateRef.current = next;
      setState(next);
      persistSoon();
    },
    [persistSoon],
  );

  useEffect(
    () => () => {
      if (saveTimer.current != null) clearTimeout(saveTimer.current);
      save(storageKey, stateRef.current);
    },
    [storageKey],
  );

  useEffect(() => {
    const flush = () => save(storageKey, stateRef.current);
    window.addEventListener("pagehide", flush);
    return () => window.removeEventListener("pagehide", flush);
  }, [storageKey]);

  useEffect(() => {
    if (loading || !storageKey) return;
    const loaded = load(storageKey);
    stateRef.current = loaded;
    setState(loaded);
  }, [loading, storageKey]);

  const startWatch = useCallback(() => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setError("GPS indisponível neste dispositivo");
      return;
    }
    if (watchId.current != null) return;
    watchId.current = navigator.geolocation.watchPosition(
      (pos) => {
        const cur = stateRef.current;
        if (cur.source !== "browser") return;
        const point = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy ?? 999,
          at: new Date(pos.timestamp || Date.now()).toISOString(),
        };
        const result = ingestGpsPoint(cur, point, 50);
        if (!result.next) return;
        setError(null);
        apply({ ...result.next, source: "browser" });
      },
      (err) => {
        if (err.code === err.PERMISSION_DENIED) setError("Permissão de localização negada");
        else if (err.code === err.TIMEOUT) setError("O GPS demorou demais para responder");
        else setError("Não foi possível obter a localização");
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 },
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
      if (cur.integratedBaseline) return;
      // A troca de sensores não deve somar o deslocamento entre suas estimativas.
      const nativeState = cur.source === "browser" ? { ...cur, last: null } : cur;
      const result = ingestGpsPoint(nativeState, point, 60);
      if (result.next) {
        setError(null);
        apply(result.next);
      }
    },
    [apply],
  );

  // O primeiro ponto nativo muda a fonte para "external" e desliga automaticamente
  // o watchPosition do navegador, impedindo duas capturas simultâneas.
  useEffect(() => subscribeNativeGps(pushGps), [pushGps]);

  const pushIntegratedGps = useCallback(
    (reading: GpsDeviceState) => {
      const next = accumulateIntegratedTrip(stateRef.current, reading);
      if (next) {
        setError(null);
        apply(next);
      }
    },
    [apply],
  );

  const start = useCallback(
    (source: TripSource = "browser", reading?: GpsDeviceState | null) => {
      if (stateRef.current.active || stateRef.current.pendingSave) return;
      setError(null);
      const baseline = source === "external" && reading ? gpsCounterBaseline(reading) : null;
      const next = {
        ...EMPTY,
        source,
        active: true,
        startedAt: new Date().toISOString(),
        journeyId: crypto.randomUUID(),
        ...(baseline ? { integratedBaseline: baseline } : {}),
      };
      apply(next);
      save(storageKey, next);
      if (source === "browser") startWatch();
      else stopWatch();
      sendNativeTripCommand("start");
    },
    [apply, startWatch, stopWatch, storageKey],
  );

  const finish = async () => {
    const current = stateRef.current;
    if (!current.startedAt || (!current.active && !current.pendingSave)) return;
    stopWatch();
    const next = {
      ...current,
      journeyId: current.journeyId ?? crypto.randomUUID(),
      active: false,
      pendingSave: true,
      endedAt: current.endedAt ?? new Date().toISOString(),
      last: null,
    };
    apply(next);
    save(storageKey, next);
    sendNativeTripCommand("finish");
    try {
      await addJourney.mutateAsync({
        id: next.journeyId,
        started_at: next.startedAt,
        ended_at: next.endedAt,
        distance_km: next.distanceKm,
        source: next.source,
      });
      const saved = { ...stateRef.current, pendingSave: false };
      apply(saved);
      save(storageKey, saved);
    } catch {
      setError("Jornada preservada neste dispositivo. Tente salvar novamente.");
    }
  };

  const reset = useCallback(() => {
    if (stateRef.current.active || stateRef.current.pendingSave) return;
    stopWatch();
    apply(EMPTY);
    sendNativeTripCommand("reset");
  }, [apply, stopWatch]);

  return {
    trip: state,
    error,
    start,
    finish,
    reset,
    pushGps,
    pushIntegratedGps,
    saving: addJourney.isPending,
  };
}
