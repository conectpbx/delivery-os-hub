import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth, authStore } from "@/hooks/useAuth";
import { useInsert } from "./data";
import { supabase } from "@/integrations/supabase/client";
import type { SupabaseClient } from "@supabase/supabase-js";

const remoteDb = supabase as unknown as SupabaseClient;
import { createTripSync, nextTripUpdateAt, type TripSyncAction } from "./trip-sync";
export { mergeRemoteTrip } from "./trip-sync";
const REMOTE_PULL_MS = 5_000;

async function pushRemote(
  userId: string,
  state: TripState,
  action: TripSyncAction,
): Promise<TripState> {
  if (typeof navigator !== "undefined" && navigator.onLine === false) throw new Error("offline");
  const { data, error } = await remoteDb
    .rpc("sync_active_work_journey", {
      _user_id: userId,
      _state: { ...state, last: null, pendingSave: false, synced: true },
      _action: action,
    })
    .abortSignal(AbortSignal.timeout(10_000));
  if (error) throw error;
  return { ...EMPTY, ...(data as TripState), last: null, synced: true };
}

async function pullRemote(userId: string): Promise<TripState | null> {
  const { data, error } = await remoteDb
    .from("active_work_journeys")
    .select("state")
    .eq("user_id", userId)
    .abortSignal(AbortSignal.timeout(10_000))
    .maybeSingle();
  if (error) throw error;
  return data ? { ...EMPTY, ...(data.state as TripState), last: null, synced: true } : null;
}

import { beginPause, endPause, type JourneyPause } from "./operation-time";
import { sendNativeTripCommand, subscribeNativeGps } from "@/lib/native-gps-bridge";
import type { GpsDeviceState } from "./gps-integration";
import type { IntegratedBaseline } from "./integrated-trip";
import {
  fallbackToBrowser,
  initialGpsSource,
  ingestBrowserGps,
  ingestIntegratedGps,
  ingestNativeGps,
} from "./gps-failover";
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
  preferredGps?: TripSource;
  externalGpsAt?: string;
  externalRebaseAfter?: string | null;
  browserFallbackSince?: string | null;
  browserGpsAt?: string | null;
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
  const [syncError, setSyncError] = useState<string | null>(null);
  const syncRef = useRef<ReturnType<typeof createTripSync> | null>(null);
  const finishInFlight = useRef(false);
  const [finishing, setFinishing] = useState(false);
  const watchId = useRef<number | null>(null);
  const locationDenied = useRef(false);
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
      saveTimer.current = null;
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
    finishInFlight.current = false;
    setFinishing(false);
    setSyncError(null);
    if (loading || !storageKey) {
      stateRef.current = { ...EMPTY };
      setState(stateRef.current);
      setSyncError(null);
      return;
    }
    const loaded = load(storageKey);
    stateRef.current = loaded;
    setState(loaded);
  }, [loading, storageKey]);

  const userId = user?.id ?? null;
  const syncNow = useCallback(
    (next: TripState, action: TripSyncAction = "update") =>
      syncRef.current?.publish(next, action) ?? Promise.resolve(),
    [],
  );
  const retrySync = useCallback(() => {
    void syncRef.current?.refresh();
  }, []);

  useEffect(() => {
    if (loading || !userId) return;
    const sync = createTripSync({
      local: () => stateRef.current,
      canWrite: () => authStore.getSnapshot().session?.user.id === userId,
      apply: (next) => {
        stateRef.current = next;
        setState(next);
        save(storageKey, next);
      },
      read: () => pullRemote(userId),
      write: (next, action) => pushRemote(userId, next, action),
      error: (error) =>
        setSyncError(
          error
            ? "Não foi possível sincronizar a jornada. Confira a conexão e tente novamente."
            : null,
        ),
    });
    syncRef.current = sync;
    const refresh = () => {
      if (navigator.onLine !== false) void sync.refresh();
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key !== storageKey || !storageKey) return;
      const next = load(storageKey);
      stateRef.current = next;
      setState(next);
      refresh();
    };
    const channel = remoteDb
      .channel(`active-journey:${userId}:${crypto.randomUUID()}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "active_work_journeys",
          filter: `user_id=eq.${userId}`,
        },
        refresh,
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "active_work_journeys",
          filter: `user_id=eq.${userId}`,
        },
        refresh,
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") refresh();
      });
    refresh();
    const timer = setInterval(refresh, REMOTE_PULL_MS);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", refresh);
    window.addEventListener("focus", refresh);
    window.addEventListener("storage", onStorage);
    return () => {
      sync.stop(authStore.getSnapshot().session?.user.id === userId);
      if (syncRef.current === sync) syncRef.current = null;
      void remoteDb.removeChannel(channel);
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", refresh);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("storage", onStorage);
    };
  }, [loading, userId, storageKey]);

  const startWatch = useCallback(() => {
    if (
      !stateRef.current.active ||
      stateRef.current.source !== "browser" ||
      stateRef.current.pauses?.some((pause) => !pause.ended_at)
    )
      return;
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setError("GPS indisponível neste dispositivo");
      return;
    }
    if (watchId.current != null) return;
    if (locationDenied.current) {
      setError(
        "Permita a localização nas configurações do navegador para usar o GPS deste dispositivo.",
      );
      return;
    }
    watchId.current = navigator.geolocation.watchPosition(
      (pos) => {
        const cur = stateRef.current;
        if (cur.source !== "browser") return;
        if (cur.pauses?.some((pause) => !pause.ended_at)) return;
        const point = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy ?? 999,
          at: new Date(pos.timestamp || Date.now()).toISOString(),
        };
        const next = ingestBrowserGps(cur, point);
        if (!next) return;
        setError(null);
        apply(next);
      },
      (err) => {
        if (!stateRef.current.active || stateRef.current.source !== "browser") return;
        if (err.code === err.PERMISSION_DENIED) {
          locationDenied.current = true;
          setError(
            "Permita a localização nas configurações do navegador para usar o GPS deste dispositivo.",
          );
          if (watchId.current != null) navigator.geolocation.clearWatch(watchId.current);
          watchId.current = null;
        } else if (err.code === err.TIMEOUT) setError("O GPS demorou demais para responder");
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

  const paused = state.pauses?.some((pause) => !pause.ended_at) ?? false;
  // Suspende durante pausas e reinicia ao voltar para o primeiro plano no iOS.
  useEffect(() => {
    if (state.active && state.source === "browser" && !paused) startWatch();
    return stopWatch;
  }, [state.active, state.source, paused, startWatch, stopWatch]);

  useEffect(() => {
    if (!state.active) return;
    const check = () => {
      const next = fallbackToBrowser(stateRef.current);
      if (next) {
        setError(null);
        apply(next);
      }
      const current = stateRef.current;
      if (
        document.visibilityState === "visible" &&
        current.active &&
        current.source === "browser" &&
        !current.pauses?.some((pause) => !pause.ended_at)
      ) {
        startWatch();
      }
    };
    check();
    const timer = setInterval(check, 5_000);
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      stopWatch();
      check();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", check);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", check);
    };
  }, [state.active, apply, startWatch, stopWatch]);

  const retryBrowserGps = useCallback(() => {
    if (
      !stateRef.current.active ||
      stateRef.current.source !== "browser" ||
      stateRef.current.pauses?.some((pause) => !pause.ended_at)
    )
      return;
    setError(null);
    locationDenied.current = false;
    stopWatch();
    startWatch();
  }, [startWatch, stopWatch]);

  const pushGps = useCallback(
    (point: GpsPoint) => {
      const next = ingestNativeGps(stateRef.current, point);
      if (next) {
        setError(null);
        apply(next);
      }
    },
    [apply],
  );

  useEffect(() => subscribeNativeGps(pushGps), [pushGps]);

  const pushIntegratedGps = useCallback(
    (reading: GpsDeviceState) => {
      const next = ingestIntegratedGps(stateRef.current, reading);
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
      locationDenied.current = false;
      const gpsSource = initialGpsSource(source, reading);
      const next = {
        ...EMPTY,
        ...gpsSource,
        active: true,
        startedAt: new Date().toISOString(),
        journeyId: crypto.randomUUID(),
        updatedAt: new Date().toISOString(),
      };
      apply(next);
      save(storageKey, next);
      void syncNow(next, "start");
      if (next.source === "browser") startWatch();
      else stopWatch();
      sendNativeTripCommand("start");
    },
    [apply, startWatch, stopWatch, storageKey, syncNow],
  );

  const finish = async () => {
    const current = stateRef.current;
    if (finishInFlight.current || !current.startedAt || (!current.active && !current.pendingSave))
      return;
    finishInFlight.current = true;
    setFinishing(true);
    const owner = userId;
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
    try {
      await syncNow(next, "finish");
      if (authStore.getSnapshot().session?.user.id !== owner) return;
      const record = stateRef.current.journeyId === next.journeyId ? stateRef.current : next;
      await addJourney.mutateAsync({
        id: record.journeyId,
        started_at: record.startedAt,
        ended_at: record.endedAt,
        distance_km: record.distanceKm,
        source: record.source,
        pauses: record.pauses,
      });
      if (
        authStore.getSnapshot().session?.user.id !== owner ||
        stateRef.current.journeyId !== next.journeyId
      )
        return;
      const saved = { ...stateRef.current, pendingSave: false };
      apply(saved);
      save(storageKey, saved);
      await syncNow(saved, "finish");
      retrySync();
    } catch {
      if (authStore.getSnapshot().session?.user.id === owner)
        setError("Jornada preservada neste dispositivo. Tente salvar novamente.");
    } finally {
      if (authStore.getSnapshot().session?.user.id === owner) {
        finishInFlight.current = false;
        setFinishing(false);
      }
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
    const next = {
      ...current,
      last: null,
      updatedAt: nextTripUpdateAt(current),
      pauses: beginPause(current.pauses ?? [], reason, new Date().toISOString()),
    };
    apply(next);
    save(storageKey, next);
    syncNow(next);
  };
  const resume = () => {
    const current = stateRef.current;
    if (!current.active) return;
    const next = {
      ...current,
      last: null,
      updatedAt: nextTripUpdateAt(current),
      pauses: endPause(current.pauses ?? [], new Date().toISOString()),
    };
    apply(next);
    save(storageKey, next);
    syncNow(next);
  };

  return {
    trip: state,
    syncError,
    retrySync,
    error,
    start,
    finish,
    reset,
    pushGps,
    pushIntegratedGps,
    saving: finishing || addJourney.isPending,
    retryBrowserGps,
    pause,
    resume,
  };
}
