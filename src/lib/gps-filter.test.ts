import assert from "node:assert/strict";
import test from "node:test";
import { ingestGpsPoint } from "./gps-filter";
import type { GpsPoint, TripState } from "./trip-tracker";

const time = Date.parse("2026-10-20T10:00:00Z");
function point(meters = 0, seconds = 0, accuracy = 3): GpsPoint {
  return {
    lat: meters / 111_195,
    lng: 0,
    accuracy,
    at: new Date(time + seconds * 1000).toISOString(),
  };
}
function trip(last: GpsPoint | null = point()): TripState {
  return {
    active: true,
    source: "browser",
    startedAt: new Date(time).toISOString(),
    endedAt: null,
    distanceKm: 0,
    points: 1,
    last,
  };
}
const ingest = (state: TripState, p: GpsPoint) => ingestGpsPoint(state, p, 50, time + 10_000);

test("rejects a sub-2km teleport using actual elapsed time and recovers", () => {
  const state = trip();
  assert.equal(ingest(state, point(1000, 2)).reason, "jump");
  assert.ok(ingest(state, point(10, 3)).next);
});

test("rejects invalid coordinates, accuracy and capture times", () => {
  for (const invalid of [
    { lat: NaN },
    { lng: 181 },
    { accuracy: NaN },
    { accuracy: -1 },
    { accuracy: 51 },
    { at: "invalid" },
    { at: new Date(time - 1000).toISOString() },
    { at: new Date(time + 20_000).toISOString() },
  ]) {
    assert.equal(ingest(trip(null), { ...point(), ...invalid }).next, null);
  }
  assert.equal(ingestGpsPoint(trip(null), point(), 50, time + 61_000).next, null);
  assert.equal(ingest(trip(), point()).reason, "stale");
});

test("suppresses stationary jitter without moving the distance anchor", () => {
  const state = trip(point(0, 0, 20));
  assert.equal(ingest(state, point(10, 2, 20)).reason, "noise");
  assert.equal(state.last?.lat, 0);
  assert.ok(ingest(state, point(25, 8, 20)).next);
});

test("preserves short accurate turns rather than cutting the corner", () => {
  const first = ingest(trip(), point(8, 2)).next!;
  const second = ingest(first, { ...point(8, 4), lng: 8 / 111_195 }).next!;
  assert.ok(Math.abs(second.distanceKm * 1000 - 16) < 0.1);
});

test("retains fractional meters over many samples", () => {
  let state = trip();
  for (let i = 1; i <= 10; i++) state = ingest(state, point(i * 3.4, i)).next!;
  assert.ok(Math.abs(state.distanceKm * 1000 - 34) < 0.01);
});

test("reanchors after a signal gap without adding an unknown path", () => {
  const state = trip();
  const result = ingestGpsPoint(state, point(5000, 120), 50, time + 120_000).next!;
  assert.equal(result.distanceKm, 0);
  assert.equal(result.last?.lat, point(5000, 120).lat);
});

test("accepts spaced native readings within the speed limit", () => {
  assert.ok(ingestGpsPoint(trip(), point(1000, 30), 60, time + 30_000).next);
  assert.equal(ingest({ ...trip(), active: false }, point(10, 2)).reason, "not-active");
});
