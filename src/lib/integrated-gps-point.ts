import type { GpsDeviceState } from "./gps-integration";
import type { GpsPoint } from "./trip-tracker";

/** Nunca inicia a jornada a partir de uma posição antiga do dispositivo. */
export function integratedGpsPoint(
  state: GpsDeviceState,
  startedAt: string,
  now = Date.now(),
): GpsPoint | null {
  const capturedAt = new Date(state.captured_at).getTime();
  const started = new Date(startedAt).getTime();
  if (
    !Number.isFinite(capturedAt) ||
    !Number.isFinite(started) ||
    capturedAt < started ||
    now - capturedAt > 60_000 ||
    capturedAt > now + 5_000 ||
    !Number.isFinite(state.latitude) ||
    Math.abs(state.latitude) > 90 ||
    !Number.isFinite(state.longitude) ||
    Math.abs(state.longitude) > 180 ||
    !Number.isFinite(state.accuracy_m) ||
    state.accuracy_m < 0 ||
    state.accuracy_m > 60
  )
    return null;
  return {
    lat: state.latitude,
    lng: state.longitude,
    accuracy: state.accuracy_m,
    at: state.captured_at,
  };
}
