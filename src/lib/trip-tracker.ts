import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useInsert } from "./data";
import { supabase } from "@/integrations/supabase/client";
import type { SupabaseClient } from "@supabase/supabase-js";

const remoteDb = supabase as unknown as SupabaseClient;
const REMOTE_PULL_MS = 15_000;
const REMOTE_PUSH_MIN_MS = 30_000;

async function pushRemote(userId: string, state: TripState) {
  if (state.active || state.pendingSave) {
    const { error } = await remoteDb.from("active_work_journeys").upsert({
      user_id: userId,
      state: { ...state, last: null, synced: true },
      updated_at: new Date().toISOString(),
    });
    return !error;
  }
  const { error } = await remoteDb.from("active_work_journeys").delete().eq("user_id", userId);
  return !error;
}

async function pullRemote(userId: string): Promise<TripState | null | undefined> {
  const { data, error } = await remoteDb
    .from("active_work_journeys")
    .select("state")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) return undefined; // falha de rede: não altera nada
  return data ? ({ ...EMPTY, ...(data.state as TripState), last: null } as TripState) : null;
}

/** Decide qual estado prevalece entre este dispositivo e o servidor. */
export function mergeRemoteTrip(local: TripState, remote: TripState | null): TripState | "push" | null {
  if (!remote) {
    // Outro dispositivo finalizou (registro removido) depois que este já havia sincronizado.
    if ((local.active || local.pendingSave) && local.synced) return { ...EMPTY };
    if (local.active || local.pendingSave) return "push";
    return null;
  }
  if (!local.active && !local.pendingSave) return remote;
  if (remote.journeyId !== local.journeyId) {
    return (remote.updatedAt ?? remote.startedAt ?? "") >= (local.updatedAt ?? local.startedAt ?? "") ? remote : "push";
  }
  const remoteNewer = (remote.updatedAt ?? "") > (local.updatedAt ?? "");
  if (remoteNewer) return { ...remote, distanceKm: Math.max(remote.distanceKm, local.distanceKm), points: Math.max(remote.points, local.points) };
  if ((local.updatedAt ?? "") > (remote.updatedAt ?? "") || local.distanceKm > remote.distanceKm) return "push";
  return null;
}
import { beginPause, endPause, type JourneyPause } from "./operation-time";
import { sendNativeTripCommand, subscribeNativeGps } from "@/lib/native-gps-bridge";
import type { GpsDeviceState } from "./gps-integration";
import {
  accumulateIntegratedTrip,
  gpsCounterBaseline,
  type IntegratedBaseline,
} from "./integrated-trip";

import { haversineKm } from "./gps-distance";
export { haversineKm } from "./gps-distance";

const PREFIX = "deliveryos.trip:";
const GPS_SAMPLE_INTERVAL_MS = 2_000;
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
  pauses?: JourneyPause[];
  /** Momento da última mudança relevante (início, pausa, retomada, fim). */
  updatedAt?: string;
  /** Já foi enviado ao servidor para sincronização entre dispositivos. */
  synced?: boolean;
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
    if (prev.at && point.at && new Date(point.at).getTime() <= new Date(prev.at).getTime()) {
      return { next: null, reason: "noise" };
    }
    const d = haversineKm(prev, point);
    const elapsedHours =
      prev.at && point.at
        ? (new Date(point.at).getTime() - new Date(prev.at).getTime()) / 3_600_000
        : 0;
    // O limite cresce em capturas nativas espaçadas (por exemplo, após execução em segundo
    // plano), mas nunca permite uma velocidade média acima de 180 km/h.
    const maxDistanceKm = Math.max(2, elapsedHours * 180);
    if (elapsedHours < 0) return { next: null, reason: "noise" };
    if (d >= 0.015 && d <= maxDistanceKm) add = d;
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
  const { user, loading } = useAuth();
  const addJourney = useInsert("work_journeys", "work_journeys");
  const storageKey = user ? `${PREFIX}${user.id}` : null;
  const [state, setState] = useState<TripState>(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const watchId = useRef<number | null>(null);
  const stateRef = useRef<TripState>(EMPTY);
  const lastSampleAt = useRef(0);
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

  const userId = user?.id ?? null;
  const lastPush = useRef(0);
  const syncNow = useCallback(
    (next: TripState) => {
      if (!userId) return;
      lastPush.current = Date.now();
      void pushRemote(userId, next).then((ok) => {
        if (ok && (next.active || next.pendingSave) && !stateRef.current.synced && stateRef.current.journeyId === next.journeyId) {
          stateRef.current = { ...stateRef.current, synced: true };
          setState(stateRef.current);
          save(storageKey, stateRef.current);
        }
      });
    },
    [userId, storageKey],
  );

  // Sincroniza a jornada entre dispositivos (Android, iPhone, computador).
  useEffect(() => {
    if (loading || !userId) return;
    let cancelled = false;
    const pull = async () => {
      if (typeof navigator !== "undefined" && navigator.onLine === false) return;
      const remote = await pullRemote(userId);
      if (cancelled || remote === undefined) return;
      const merged = mergeRemoteTrip(stateRef.current, remote);
      if (merged === "push") syncNow(stateRef.current);
      else if (merged) {
        stateRef.current = merged;
        setState(merged);
        save(storageKey, merged);
      } else if ((stateRef.current.active) && Date.now() - lastPush.current > REMOTE_PUSH_MIN_MS && remote && stateRef.current.distanceKm > remote.distanceKm) {
        syncNow(stateRef.current);
      }
    };
    void pull();
    const id = setInterval(pull, REMOTE_PULL_MS);
    const onVisible = () => { if (document.visibilityState === "visible") void pull(); };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", pull);
    return () => {
      cancelled = true;
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", pull);
    };
  }, [loading, userId, storageKey, syncNow]);

  const startWatch = useCallback(() => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setError("GPS indisponível neste dispositivo");
      return;
    }
    if (watchId.current != null) return;
    watchId.current = navigator.geolocation.watchPosition(
      (pos) => {
        const now = Date.now();
        if (now - lastSampleAt.current < GPS_SAMPLE_INTERVAL_MS) return;
        lastSampleAt.current = now;
        const cur = stateRef.current;
        if (cur.pauses?.some((pause) => !pause.ended_at)) return;
        const point = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy ?? 999,
          at: new Date(pos.timestamp || Date.now()).toISOString(),
        };
        const result = ingest(cur, point, 50);
        if (!result.next) return;
        apply({ ...result.next, source: "browser" });
      },
      (err) => {
        if (err.code === err.PERMISSION_DENIED) setError("Permissão de localização negada");
        else if (err.code === err.TIMEOUT) setError("O GPS demorou demais para responder");
        else setError("Não foi possível obter a localização");
      },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 },
    );
  }, [apply]);

  const stopWatch = useCallback(() => {
    if (watchId.current != null && typeof navigator !== "undefined") {
      navigator.geolocation.clearWatch(watchId.current);
    }
    watchId.current = null;
    lastSampleAt.current = 0;
  }, []);

  // Retoma a captura ao recarregar a página com jornada ativa (somente no browser).
  useEffect(() => {
    if (state.active && state.source === "browser") startWatch();
    return stopWatch;
  }, [state.active, state.source, startWatch, stopWatch]);

  const pushGps = useCallback(
    (point: GpsPoint) => {
      const cur = stateRef.current;
      if (cur.pauses?.some((pause) => !pause.ended_at)) return;
      if (cur.integratedBaseline) return;
      const result = ingest(cur, point, 60);
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
      if (stateRef.current.pauses?.some((pause) => !pause.ended_at)) {
        const baseline = gpsCounterBaseline(reading);
        if (baseline) apply({ ...stateRef.current, integratedBaseline: baseline, last: null });
        return;
      }
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
        updatedAt: new Date().toISOString(),
        ...(baseline ? { integratedBaseline: baseline } : {}),
      };
      apply(next);
      save(storageKey, next);
      syncNow(next);
      if (source === "browser") startWatch();
      else stopWatch();
      sendNativeTripCommand("start");
    },
    [apply, startWatch, stopWatch, storageKey, syncNow],
  );

  const finish = async () => {
    const current = stateRef.current;
    if (!current.startedAt || (!current.active && !current.pendingSave)) return;
    stopWatch();
    const endedAt = current.endedAt ?? new Date().toISOString();
    const next = {
      ...current,
      journeyId: current.journeyId ?? crypto.randomUUID(),
      active: false,
      pendingSave: true,
      endedAt,
      updatedAt: new Date().toISOString(),
      pauses: endPause(current.pauses ?? [], endedAt),
      last: null,
    };
    apply(next);
    save(storageKey, next);
    sendNativeTripCommand("finish");
    syncNow(next);
    try {
      await addJourney.mutateAsync({
        id: next.journeyId,
        started_at: next.startedAt,
        ended_at: next.endedAt,
        distance_km: next.distanceKm,
        source: next.source,
        pauses: next.pauses,
      });
      const saved = { ...stateRef.current, pendingSave: false };
      apply(saved);
      save(storageKey, saved);
      syncNow(saved);
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

  const pause = (reason: string) => {
    const current = stateRef.current;
    if (!current.active) return;
    const next = { ...current, last: null, updatedAt: new Date().toISOString(), pauses: beginPause(current.pauses ?? [], reason, new Date().toISOString()) };
    apply(next);
    save(storageKey, next);
    syncNow(next);
  };
  const resume = () => {
    const current = stateRef.current;
    if (!current.active) return;
    const next = { ...current, last: null, updatedAt: new Date().toISOString(), pauses: endPause(current.pauses ?? [], new Date().toISOString()) };
    apply(next);
    save(storageKey, next);
    syncNow(next);
  };

  return {
    trip: state,
    error,
    start,
    finish,
    reset,
    pushGps,
    pushIntegratedGps,
    saving: addJourney.isPending,
    pause,
    resume,
  };
}
