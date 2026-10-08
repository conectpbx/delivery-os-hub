import assert from "node:assert/strict";
import test from "node:test";
import { integratedGpsPoint } from "./integrated-gps-point";
import type { GpsDeviceState } from "./gps-integration";

const start = "2026-10-08T10:00:00Z";
const now = new Date("2026-10-08T10:00:10Z").getTime();
const reading: GpsDeviceState = {
  token_id: "device",
  source: "integrated",
  latitude: -23.55,
  longitude: -46.63,
  accuracy_m: 10,
  speed_kmh: 20,
  trip_km: 50,
  total_km: 1000,
  captured_at: "2026-10-08T10:00:05Z",
  sent_at: start,
  received_at: start,
};

test("usa coordenadas novas do GPS integrado sem importar a distância anterior", () => {
  assert.deepEqual(integratedGpsPoint(reading, start, now), {
    lat: -23.55,
    lng: -46.63,
    accuracy: 10,
    at: reading.captured_at,
  });
});

test("descarta leitura anterior ao clique de iniciar jornada", () => {
  assert.equal(
    integratedGpsPoint({ ...reading, captured_at: "2026-10-08T09:59:59Z" }, start, now),
    null,
  );
});

test("descarta leitura desatualizada, futura ou sem precisão suficiente", () => {
  assert.equal(integratedGpsPoint(reading, start, now + 60_000), null);
  assert.equal(
    integratedGpsPoint({ ...reading, captured_at: "2026-10-08T10:01:00Z" }, start, now),
    null,
  );
  assert.equal(integratedGpsPoint({ ...reading, accuracy_m: 100 }, start, now), null);
});

test("descarta coordenadas e datas inválidas", () => {
  for (const invalid of [
    { latitude: NaN },
    { longitude: 181 },
    { accuracy_m: -1 },
    { captured_at: "invalid" },
  ]) {
    assert.equal(integratedGpsPoint({ ...reading, ...invalid }, start, now), null);
  }
});
