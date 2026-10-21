import type { GpsDeviceState } from "./gps-integration";
import { ingestGpsPoint } from "./gps-filter";
import { accumulateIntegratedTrip, gpsCounterBaseline } from "./integrated-trip";
import type { GpsPoint, TripSource, TripState } from "./trip-tracker";

export const GPS_FAILOVER_MS = 30_000;

function fresh(at: string | undefined, now: number) {
  const time = Date.parse(at ?? "");
  return Number.isFinite(time) && time >= now - GPS_FAILOVER_MS && time <= now + 5_000;
}

export function initialGpsSource(
  source: TripSource,
  reading?: GpsDeviceState | null,
  now = Date.now(),
): Partial<TripState> {
  const baseline =
    source === "external" &&
    reading &&
    fresh(reading.captured_at, now) &&
    fresh(reading.received_at, now)
      ? gpsCounterBaseline(reading, now)
      : null;
  return {
    source: baseline ? "external" : "browser",
    preferredGps: source,
    ...(baseline ? { integratedBaseline: baseline, externalGpsAt: baseline.capturedAt } : {}),
    ...(source === "external" && !baseline
      ? { browserFallbackSince: new Date(now).toISOString() }
      : {}),
  };
}

export function fallbackToBrowser(trip: TripState, now = Date.now()): TripState | null {
  if (!trip.active || trip.source !== "external" || trip.pauses?.some((pause) => !pause.ended_at))
    return null;
  const last =
    trip.externalGpsAt ?? trip.integratedBaseline?.capturedAt ?? trip.startedAt ?? undefined;
  if (fresh(last, now)) return null;
  return {
    ...trip,
    source: "browser",
    preferredGps: "external",
    last: null,
    browserFallbackSince: new Date(now).toISOString(),
    updatedAt: new Date(now).toISOString(),
  };
}

function canResume(trip: TripState, capturedAt: string) {
  // Uma resposta em cache de antes da falha não deve reativar a integração.
  const cutoff = trip.browserFallbackSince ?? trip.startedAt;
  return !cutoff || Date.parse(capturedAt) >= Date.parse(cutoff);
}

export function ingestBrowserGps(
  trip: TripState,
  point: GpsPoint,
  now = Date.now(),
): TripState | null {
  if (trip.source !== "browser" || trip.pauses?.some((pause) => !pause.ended_at)) return null;
  if (trip.browserGpsAt && Date.parse(point.at ?? "") <= Date.parse(trip.browserGpsAt)) return null;
  const result = ingestGpsPoint(trip, point, 50, now);
  const next = result.next ?? (result.reason === "noise" ? trip : null);
  return next ? { ...next, source: "browser", browserGpsAt: point.at! } : null;
}

export function ingestIntegratedGps(
  trip: TripState,
  reading: GpsDeviceState,
  now = Date.now(),
): TripState | null {
  if (!trip.active || !fresh(reading.captured_at, now) || !fresh(reading.received_at, now))
    return null;
  const baseline = gpsCounterBaseline(reading, now);
  if (
    !baseline ||
    (trip.integratedBaseline && baseline.tokenId !== trip.integratedBaseline.tokenId)
  )
    return null;
  if (
    trip.integratedBaseline &&
    Date.parse(baseline.capturedAt) <= Date.parse(trip.integratedBaseline.capturedAt)
  )
    return null;
  if (!canResume(trip, baseline.capturedAt)) return null;
  const paused = trip.pauses?.some((pause) => !pause.ended_at);
  // A primeira leitura após o fallback estabelece a base, sem somar o contador
  // acumulado enquanto o navegador era responsável pela distância.
  const next =
    trip.source === "browser" || paused || trip.externalRebaseAfter
      ? { ...trip, source: "external" as const, integratedBaseline: baseline, last: null }
      : accumulateIntegratedTrip(trip, reading, now);
  return next
    ? {
        ...next,
        preferredGps: "external",
        externalGpsAt: reading.captured_at,
        // Leituras chegam com atraso de rede. Suspende a soma até estabelecer
        // uma base capturada depois do último ponto já contado pelo navegador.
        externalRebaseAfter:
          trip.source === "browser"
            ? trip.browserGpsAt && Date.parse(reading.captured_at) < Date.parse(trip.browserGpsAt)
              ? trip.browserGpsAt
              : null
            : trip.externalRebaseAfter &&
                Date.parse(reading.captured_at) < Date.parse(trip.externalRebaseAfter)
              ? trip.externalRebaseAfter
              : null,
        ...(trip.source === "browser" ? { updatedAt: new Date(now).toISOString() } : {}),
        browserFallbackSince: null,
        browserGpsAt: null,
      }
    : null;
}

export function ingestNativeGps(
  trip: TripState,
  point: GpsPoint,
  now = Date.now(),
): TripState | null {
  if (trip.pauses?.some((pause) => !pause.ended_at)) return null;
  if (trip.integratedBaseline || !fresh(point.at, now) || !canResume(trip, point.at ?? ""))
    return null;
  if (trip.externalGpsAt && Date.parse(point.at!) <= Date.parse(trip.externalGpsAt)) return null;
  const switching = trip.source === "browser";
  const result = ingestGpsPoint(
    switching || trip.externalRebaseAfter ? { ...trip, last: null } : trip,
    point,
    60,
    now,
  );
  // Um GPS parado continua saudável, mesmo quando o filtro descarta o ruído.
  const next = result.next ?? (result.reason === "noise" ? trip : null);
  if (!next) return null;
  const cutoff = switching ? trip.browserGpsAt : trip.externalRebaseAfter;
  const rebase = !switching && !!trip.externalRebaseAfter;
  return {
    ...next,
    ...(rebase ? { distanceKm: trip.distanceKm } : {}),
    externalRebaseAfter: cutoff && Date.parse(point.at!) < Date.parse(cutoff) ? cutoff : null,
    source: "external",
    preferredGps: "external",
    externalGpsAt: point.at!,
    ...(switching ? { updatedAt: new Date(now).toISOString() } : {}),
    browserFallbackSince: null,
    browserGpsAt: null,
  };
}
