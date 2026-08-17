import { useCallback, useEffect, useRef, useState } from "react";

const KEY = "deliveryos.odometer-bridge";

export type BridgeReading = {
  odometerKm: number | null;
  speedKmh: number | null;
  raw: unknown;
  at: string;
};

export type BridgeState = {
  url: string;
  enabled: boolean;
};

const EMPTY: BridgeState = { url: "", enabled: false };

function loadConfig(): BridgeState {
  if (typeof window === "undefined") return EMPTY;
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? { ...EMPTY, ...(JSON.parse(raw) as BridgeState) } : EMPTY;
  } catch {
    return EMPTY;
  }
}

function saveConfig(state: BridgeState) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* storage indisponível */
  }
}

function pickNumber(source: Record<string, unknown>, keys: string[]): number | null {
  for (const key of Object.keys(source)) {
    if (!keys.includes(key.toLowerCase())) continue;
    const value = Number(String(source[key]).replace(",", "."));
    if (Number.isFinite(value)) return value;
  }
  return null;
}

/** Normaliza respostas do tipo { odometer, speed } vindas do servidor HTTP local do app. */
export function parseReading(payload: unknown): BridgeReading {
  const flat: Record<string, unknown> =
    payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  const nested =
    flat["data"] && typeof flat["data"] === "object"
      ? (flat["data"] as Record<string, unknown>)
      : flat["status"] && typeof flat["status"] === "object"
        ? (flat["status"] as Record<string, unknown>)
        : {};
  const merged = { ...nested, ...flat };

  let odometerKm = pickNumber(merged, ["odometer", "odometer_km", "odometro", "odômetro", "km"]);
  const meters = pickNumber(merged, ["odometer_m", "distance_m", "meters"]);
  if (odometerKm == null && meters != null) odometerKm = meters / 1000;

  let speedKmh = pickNumber(merged, ["speed_kmh", "speed", "velocidade", "velocity"]);
  const mps = pickNumber(merged, ["speed_ms", "speed_mps"]);
  if (mps != null) speedKmh = mps * 3.6;

  return { odometerKm, speedKmh, raw: payload, at: new Date().toISOString() };
}

export function isMixedContentBlocked(url: string) {
  if (typeof window === "undefined") return false;
  return window.location.protocol === "https:" && url.trim().startsWith("http://");
}

export async function fetchReading(url: string, signal?: AbortSignal): Promise<BridgeReading> {
  const res = await fetch(url, { signal: signal ?? null, headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`Servidor respondeu ${res.status}`);
  const text = await res.text();
  try {
    return parseReading(JSON.parse(text));
  } catch {
    const value = Number(text.trim().replace(",", "."));
    if (Number.isFinite(value)) {
      return { odometerKm: value, speedKmh: null, raw: text, at: new Date().toISOString() };
    }
    throw new Error("Resposta não é JSON válido");
  }
}

/**
 * Lê velocidade/odômetro de um app na mesma rede Wi-Fi
 * (ex.: http://192.168.0.10:8080/status) por polling.
 */
export function useOdometerBridge(intervalMs = 5000) {
  const [config, setConfig] = useState<BridgeState>(EMPTY);
  const [reading, setReading] = useState<BridgeReading | null>(null);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    setConfig(loadConfig());
  }, []);

  const update = useCallback((next: Partial<BridgeState>) => {
    setConfig((cur) => {
      const merged = { ...cur, ...next };
      saveConfig(merged);
      return merged;
    });
  }, []);

  const poll = useCallback(async (url: string) => {
    try {
      const next = await fetchReading(url);
      setReading(next);
      setError(null);
      return next;
    } catch (e) {
      setError(
        isMixedContentBlocked(url)
          ? "Bloqueado: página HTTPS não acessa http:// da rede local"
          : e instanceof Error
            ? e.message
            : "Falha ao ler o servidor local",
      );
      return null;
    }
  }, []);

  useEffect(() => {
    if (timer.current) clearInterval(timer.current);
    if (!config.enabled || !config.url.trim()) return;
    void poll(config.url);
    timer.current = setInterval(() => void poll(config.url), intervalMs);
    return () => {
      if (timer.current) clearInterval(timer.current);
      timer.current = null;
    };
  }, [config.enabled, config.url, intervalMs, poll]);

  return { config, update, reading, error, test: poll };
}
