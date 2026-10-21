import assert from "node:assert/strict";
import test from "node:test";
import type { GpsDeviceState } from "./gps-integration";
import type { GpsPoint, TripState } from "./trip-tracker";
import {
  fallbackToBrowser,
  initialGpsSource,
  ingestBrowserGps,
  ingestIntegratedGps,
  ingestNativeGps,
} from "./gps-failover";

const start = Date.parse("2026-10-21T10:00:00Z");
const at = (seconds: number) => new Date(start + seconds * 1000).toISOString();
const now = (seconds: number) => start + seconds * 1000;
function reading(seconds = 0, total = 1000): GpsDeviceState {
  return {
    token_id: "device",
    source: "integrated",
    latitude: 0,
    longitude: 0,
    accuracy_m: 5,
    speed_kmh: 10,
    total_km: total,
    trip_km: total - 900,
    captured_at: at(seconds),
    received_at: at(seconds),
    sent_at: at(seconds),
  };
}
function point(seconds: number, meters = 0): GpsPoint {
  return { lat: meters / 111_195, lng: 0, accuracy: 3, at: at(seconds) };
}
function trip(): TripState {
  return {
    active: true,
    source: "external",
    startedAt: at(0),
    endedAt: null,
    points: 0,
    last: null,
    distanceKm: 0,
    ...initialGpsSource("external", reading(), start),
  };
}

test("starts on browser immediately when integration is absent, stale or invalid", () => {
  for (const value of [null, reading(-31), { ...reading(), total_km: NaN }, reading(6)]) {
    const next = initialGpsSource("external", value, start);
    assert.equal(next.source, "browser");
    assert.equal(next.preferredGps, "external");
    assert.equal(next.integratedBaseline, undefined);
    assert.equal(next.browserFallbackSince, at(0));
  }
  assert.equal(initialGpsSource("external", reading(), start).source, "external");
  assert.equal(initialGpsSource("browser", reading(), start).source, "browser");
});

test("switches only after timeout and preserves distance and device identity", () => {
  const state = { ...trip(), distanceKm: 12, last: point(0) };
  assert.equal(fallbackToBrowser(state, now(30)), null);
  const fallback = fallbackToBrowser(state, now(31))!;
  assert.equal(fallback.source, "browser");
  assert.equal(fallback.distanceKm, 12);
  assert.equal(fallback.last, null);
  assert.equal(fallback.integratedBaseline?.tokenId, "device");
  assert.equal(fallbackToBrowser(fallback, now(60)), null);
});

test("does not switch finished or paused trips", () => {
  assert.equal(fallbackToBrowser({ ...trip(), active: false }, now(60)), null);
  const paused = {
    ...trip(),
    pauses: [{ id: "p", reason: "Almoço", started_at: at(1), ended_at: null }],
  };
  assert.equal(fallbackToBrowser(paused, now(60)), null);
  assert.equal(ingestBrowserGps({ ...paused, source: "browser" }, point(60), now(60)), null);
  assert.equal(ingestNativeGps(paused, point(60), now(60)), null);
});

test("browser fallback and integrated recovery never add overlapping counter distance", () => {
  let state = ingestIntegratedGps(trip(), reading(10, 1000.1), now(10))!;
  assert.equal(state.distanceKm, 0.1);
  state = fallbackToBrowser(state, now(41))!;
  state = ingestBrowserGps(state, point(42), now(42))!;
  state = ingestBrowserGps(state, point(44, 10), now(44))!;
  const browserDistance = state.distanceKm;
  assert.ok(browserDistance > 0.109 && browserDistance < 0.111);
  state = ingestIntegratedGps(state, reading(45, 1000.5), now(45))!;
  assert.equal(state.source, "external");
  assert.equal(state.distanceKm, browserDistance);
  assert.equal(state.last, null);
  assert.equal(ingestBrowserGps(state, point(46, 100), now(46)), null);
  state = ingestIntegratedGps(state, reading(55, 1000.6), now(55))!;
  assert.ok(Math.abs(state.distanceKm - browserDistance - 0.1) < 0.001);
  // Mais uma queda/reconexão não reaproveita o contador anterior.
  state = fallbackToBrowser(state, now(86))!;
  state = ingestIntegratedGps(state, reading(87, 1001), now(87))!;
  assert.ok(Math.abs(state.distanceKm - browserDistance - 0.1) < 0.001);
});

test("rebases delayed readings behind browser progress, including after reload", () => {
  let state = fallbackToBrowser(trip(), now(31))!;
  state = ingestBrowserGps(state, point(40), now(40))!;
  const restored = { ...JSON.parse(JSON.stringify(state)), last: null } as TripState;
  const delayed = ingestIntegratedGps(restored, reading(39, 1001), now(41))!;
  assert.equal(delayed.source, "external");
  assert.equal(delayed.externalRebaseAfter, at(40));
  const caughtUp = ingestIntegratedGps(delayed, reading(41, 1001.1), now(43))!;
  assert.equal(caughtUp.externalRebaseAfter, null);
  assert.equal(caughtUp.distanceKm, restored.distanceKm);
  assert.ok(
    ingestIntegratedGps(caughtUp, reading(45, 1001.2), now(47))!.distanceKm > restored.distanceKm,
  );
  assert.equal(ingestIntegratedGps(restored, reading(0), now(41)), null);
  assert.equal(ingestIntegratedGps(restored, { ...reading(41), token_id: "other" }, now(41)), null);
  assert.ok(ingestIntegratedGps(restored, reading(41), now(41)));
});

test("a cached reading before fallback cannot trigger a reconnect loop", () => {
  const state = fallbackToBrowser(trip(), now(31))!;
  assert.equal(ingestIntegratedGps(state, reading(), now(31)), null);
  assert.equal(ingestIntegratedGps(state, reading(30), now(31)), null);
  assert.equal(ingestIntegratedGps(state, { ...reading(32), received_at: at(0) }, now(32)), null);
});

test("paused integrated readings rebase counters without adding pause mileage", () => {
  const state = {
    ...trip(),
    pauses: [{ id: "p", reason: "Almoço", started_at: at(1), ended_at: null }],
  };
  const paused = ingestIntegratedGps(state, reading(20, 1001), now(20))!;
  assert.equal(paused.distanceKm, 0);
  const resumed = { ...paused, pauses: [{ ...state.pauses[0]!, ended_at: at(21) }] };
  assert.equal(ingestIntegratedGps(resumed, reading(30, 1001.1), now(30))?.distanceKm, 0.1);
});

test("native stationary noise is a heartbeat, but replayed and inaccurate points are not", () => {
  const browser = { ...trip(), ...initialGpsSource("browser", null, start) };
  delete browser.integratedBaseline;
  let state = ingestNativeGps(browser, point(1), now(1))!;
  state = ingestNativeGps(state, point(25, 1), now(25))!;
  assert.equal(state.distanceKm, 0);
  assert.equal(state.externalGpsAt, at(25));
  assert.equal(fallbackToBrowser(state, now(50)), null);
  assert.equal(ingestNativeGps(state, point(24, 1), now(25)), null);
  assert.equal(ingestNativeGps(state, { ...point(26), accuracy: 90 }, now(26)), null);
  assert.ok(fallbackToBrowser(state, now(56)));
});

test("native recovery reanchors instead of joining browser and native estimates", () => {
  const browser = { ...trip(), ...initialGpsSource("browser", null, start) };
  delete browser.integratedBaseline;
  let state = ingestNativeGps(browser, point(1), now(1))!;
  state = fallbackToBrowser(state, now(32))!;
  state = ingestBrowserGps(state, point(33, 500), now(33))!;
  state = ingestBrowserGps(state, point(35, 510), now(35))!;
  const distance = state.distanceKm;
  assert.equal(ingestNativeGps(state, point(31, 1000), now(36)), null);
  state = ingestNativeGps(state, point(36, 1000), now(36))!;
  assert.equal(state.distanceKm, distance);
  assert.equal(state.source, "external");
  assert.ok(ingestNativeGps(state, point(38, 1010), now(38))!.distanceKm > distance);
});

test("does not accept GPS input after the journey finishes", () => {
  const state = { ...trip(), active: false };
  assert.equal(ingestIntegratedGps(state, reading(1), now(1)), null);
  assert.equal(ingestNativeGps(state, point(1), now(1)), null);
  assert.equal(ingestBrowserGps({ ...state, source: "browser" }, point(1), now(1)), null);
});

test("stationary browser fixes refresh health without accumulating jitter", () => {
  let state = fallbackToBrowser(trip(), now(31))!;
  state = ingestBrowserGps(state, point(32), now(32))!;
  state = ingestBrowserGps(state, point(40, 1), now(40))!;
  assert.equal(state.distanceKm, 0);
  assert.equal(state.browserGpsAt, at(40));
  assert.equal(ingestBrowserGps(state, point(39, 5), now(40)), null);
});

test("delayed native recovery skips overlap until a new capture baseline is established", () => {
  const browser = { ...trip(), ...initialGpsSource("browser", null, start) };
  delete browser.integratedBaseline;
  let state = ingestNativeGps(browser, point(1), now(1))!;
  state = fallbackToBrowser(state, now(32))!;
  state = ingestBrowserGps(state, point(33, 500), now(33))!;
  state = ingestBrowserGps(state, point(40, 510), now(40))!;
  const distance = state.distanceKm;
  state = ingestNativeGps(state, point(38, 1000), now(41))!;
  assert.equal(state.externalRebaseAfter, at(40));
  state = ingestNativeGps(state, point(41, 2000), now(43))!;
  assert.equal(state.distanceKm, distance);
  assert.equal(state.externalRebaseAfter, null);
  assert.ok(ingestNativeGps(state, point(43, 2010), now(45))!.distanceKm > distance);
});
