import assert from "node:assert/strict";
import test from "node:test";
import { accumulateIntegratedTrip, gpsCounterBaseline } from "./integrated-trip";
import type { GpsDeviceState } from "./gps-integration";
import type { TripState } from "./trip-tracker";

const start = Date.parse("2026-10-08T10:00:00Z");
const reading = (seconds = 0, total = 1000, trip = 50): GpsDeviceState => ({
  token_id: "gps",
  source: "test",
  latitude: -23.55,
  longitude: -46.63,
  accuracy_m: 100,
  speed_kmh: 20,
  trip_km: trip,
  total_km: total,
  captured_at: new Date(start + seconds * 1000).toISOString(),
  received_at: new Date(start + seconds * 1000).toISOString(),
  sent_at: new Date(start + seconds * 1000).toISOString(),
});
const state = (): TripState => ({
  active: true,
  source: "external",
  startedAt: new Date(start).toISOString(),
  endedAt: null,
  distanceKm: 0,
  points: 0,
  last: null,
  integratedBaseline: gpsCounterBaseline(reading(), start)!,
});

test("atualiza km pelo contador mesmo com coordenadas iguais ou imprecisas", () => {
  const next = accumulateIntegratedTrip(state(), reading(60, 1000.5), start + 60_000);
  assert.equal(next?.distanceKm, 0.5);
  assert.equal(next?.last, null);
});

test("não importa os quilômetros percorridos antes do início", () => {
  const trip = state();
  delete trip.integratedBaseline;
  assert.equal(accumulateIntegratedTrip(trip, reading(-1), start), null);
  assert.equal(accumulateIntegratedTrip(trip, reading(1), start + 1000)?.distanceKm, 0);
});

test("não duplica leitura e não mistura dispositivos", () => {
  const next = accumulateIntegratedTrip(state(), reading(60, 1001), start + 60_000)!;
  assert.equal(accumulateIntegratedTrip(next, reading(60, 1001), start + 60_000), null);
  assert.equal(
    accumulateIntegratedTrip(next, { ...reading(90, 1002), token_id: "other" }, start + 90_000),
    null,
  );
});

test("retoma distância após restaurar resumo sem coordenadas", () => {
  const next = accumulateIntegratedTrip(state(), reading(60, 1001), start + 60_000)!;
  const restored = JSON.parse(JSON.stringify(next)) as TripState;
  assert.equal(
    accumulateIntegratedTrip(restored, reading(120, 1002), start + 120_000)?.distanceKm,
    2,
  );
});

test("reset e saltos do contador não inflam nem reduzem a jornada", () => {
  const initial = { ...state(), distanceKm: 2 };
  const reset = accumulateIntegratedTrip(initial, reading(60, 0), start + 60_000)!;
  assert.equal(reset.distanceKm, 2);
  const moving = accumulateIntegratedTrip(reset, reading(120, 0.5), start + 120_000)!;
  assert.equal(moving.distanceKm, 2.5);
  assert.equal(
    accumulateIntegratedTrip(moving, reading(122, 1000), start + 122_000)?.distanceKm,
    2.5,
  );
});

test("usa contador de jornada quando o odômetro total permanece fixo", () => {
  assert.equal(
    accumulateIntegratedTrip(state(), reading(60, 1000, 50.5), start + 60_000)?.distanceKm,
    0.5,
  );
});

test("ignora leituras após finalizar e leituras antigas", () => {
  assert.equal(
    accumulateIntegratedTrip({ ...state(), active: false }, reading(60, 1001), start + 60_000),
    null,
  );
  assert.equal(accumulateIntegratedTrip(state(), reading(60, 1001), start + 400_000), null);
});
