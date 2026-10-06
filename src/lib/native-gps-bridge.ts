import type { GpsPoint } from "@/lib/trip-tracker";

export const NATIVE_GPS_EVENT = "deliveryos:gps";
export const NATIVE_TRIP_COMMAND_EVENT = "deliveryos:trip-command";

export type NativeTripCommand = "start" | "finish" | "reset";

type NativeGpsPayload = {
  lat?: unknown;
  lng?: unknown;
  latitude?: unknown;
  longitude?: unknown;
  accuracy?: unknown;
  at?: unknown;
  timestamp?: unknown;
};

function finiteNumber(value: unknown) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Normaliza e valida dados recebidos de Android/iOS antes de usá-los no cálculo. */
export function parseNativeGpsMessage(message: unknown): GpsPoint | null {
  let data = message;
  if (typeof data === "string") {
    try {
      data = JSON.parse(data) as unknown;
    } catch {
      return null;
    }
  }
  if (!data || typeof data !== "object") return null;

  const envelope = data as { type?: unknown; payload?: unknown };
  if (envelope.type != null && envelope.type !== NATIVE_GPS_EVENT) return null;
  const raw = (envelope.payload ?? data) as NativeGpsPayload;
  if (!raw || typeof raw !== "object") return null;

  const lat = finiteNumber(raw.lat ?? raw.latitude);
  const lng = finiteNumber(raw.lng ?? raw.longitude);
  const accuracy = finiteNumber(raw.accuracy);
  if (lat == null || lng == null || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return null;
  }
  if (accuracy != null && (accuracy < 0 || accuracy > 10_000)) return null;

  const rawTime = raw.at ?? raw.timestamp;
  const parsedTime =
    typeof rawTime === "number"
      ? new Date(rawTime < 10_000_000_000 ? rawTime * 1000 : rawTime)
      : typeof rawTime === "string"
        ? new Date(rawTime)
        : new Date();
  if (!Number.isFinite(parsedTime.getTime())) return null;

  return {
    lat,
    lng,
    ...(accuracy != null ? { accuracy } : {}),
    at: parsedTime.toISOString(),
  };
}

/**
 * Aceita tanto `window.postMessage` quanto `CustomEvent`, cobrindo WebViews Android/iOS
 * sem acoplar a aplicação web a um SDK nativo específico.
 */
export function subscribeNativeGps(onPoint: (point: GpsPoint) => void) {
  if (typeof window === "undefined") return () => undefined;

  const receive = (payload: unknown) => {
    const point = parseNativeGpsMessage(payload);
    if (point) onPoint(point);
  };
  const onMessage = (event: MessageEvent<unknown>) => receive(event.data);
  const onCustomEvent = (event: Event) => receive((event as CustomEvent<unknown>).detail);

  window.addEventListener("message", onMessage);
  window.addEventListener(NATIVE_GPS_EVENT, onCustomEvent);
  return () => {
    window.removeEventListener("message", onMessage);
    window.removeEventListener(NATIVE_GPS_EVENT, onCustomEvent);
  };
}

/** Notifica o host nativo e também emite um evento local para integrações injetadas. */
export function sendNativeTripCommand(command: NativeTripCommand) {
  if (typeof window === "undefined") return;
  const message = { type: NATIVE_TRIP_COMMAND_EVENT, command };
  window.dispatchEvent(new CustomEvent(NATIVE_TRIP_COMMAND_EVENT, { detail: message }));

  const nativeWindow = window as typeof window & {
    ReactNativeWebView?: { postMessage?: (value: string) => void };
  };
  nativeWindow.ReactNativeWebView?.postMessage?.(JSON.stringify(message));
}
