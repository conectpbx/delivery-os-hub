import assert from "node:assert/strict";
import test from "node:test";
import type { Delivery } from "./data";
import { deliveryMinutes, operationTime, type WorkJourney } from "./operation-time";
import { reportBreakdown } from "./metrics";

const journey: WorkJourney = {
  id: "j",
  started_at: "2026-10-12T12:00:00Z",
  ended_at: "2026-10-12T20:00:00Z",
  distance_km: 0,
  source: "browser",
};
const delivery = (values: Partial<Delivery> = {}): Delivery => ({
  id: "d",
  occurred_at: "2026-10-12T13:00:00Z",
  app_name: "app",
  earnings: 100,
  tip: 0,
  distance_km: 0,
  duration_min: 10,
  idle_min: 0,
  payment_method: "pix",
  pickup_address: null,
  dropoff_address: null,
  lat: null,
  lng: null,
  status: "concluida",
  started_at: "2026-10-12T13:00:00Z",
  ended_at: "2026-10-12T15:00:00Z",
  ...values,
});
const from = new Date("2026-10-12T00:00:00Z");
const to = new Date("2026-10-12T23:59:59.999Z");
const now = new Date("2026-10-13T00:00:00Z");

test("separates start-to-finish journey duration from delivery time, independently of GPS", () => {
  const time = operationTime([delivery()], [journey], from, to, now);
  assert.equal(time.journeyMin, 480);
  assert.equal(time.deliveryMin, 120);
  assert.equal(time.unassignedMin, 360);
  assert.equal(time.totalMin, 480);
});
test("freezes finished duration and counts elapsed active routes instead of route estimates", () => {
  assert.equal(deliveryMinutes(delivery({ estimated_duration_min: 15 }), now), 120);
  assert.equal(
    deliveryMinutes(
      delivery({ ended_at: null, status: "em_rota" }),
      new Date("2026-10-12T14:00:00Z"),
    ),
    60,
  );
});
test("overlapping routes do not inflate elapsed work time", () => {
  const time = operationTime(
    [
      delivery(),
      delivery({ id: "d2", started_at: "2026-10-12T14:00:00Z", ended_at: "2026-10-12T16:00:00Z" }),
    ],
    [journey],
    from,
    to,
    now,
  );
  assert.equal(time.deliveryMin, 180);
  assert.equal(time.totalMin, 480);
});
test("splits journeys crossing a civil month boundary", () => {
  const cross = {
    ...journey,
    started_at: "2026-10-01T02:00:00Z",
    ended_at: "2026-10-01T04:00:00Z",
  };
  const september = operationTime(
    [],
    [cross],
    new Date("2026-09-01T03:00:00Z"),
    new Date("2026-10-01T02:59:59.999Z"),
    now,
  );
  const october = operationTime(
    [],
    [cross],
    new Date("2026-10-01T03:00:00Z"),
    new Date("2026-11-01T02:59:59.999Z"),
    now,
  );
  assert.equal(september.journeyMin, 60);
  assert.equal(october.journeyMin, 60);
});
test("preserves historical manual durations without inventing journey timestamps", () => {
  const time = operationTime(
    [delivery({ started_at: null, ended_at: null, duration_min: 30, idle_min: 15 })],
    [],
    from,
    to,
    now,
  );
  assert.equal(time.hasJourney, false);
  assert.equal(time.deliveryMin, 30);
  assert.equal(time.totalMin, 45);
});
test("manual deliveries inside a recorded shift do not add hours on top of the shift", () => {
  const result = operationTime([delivery({ started_at: null, ended_at: null, duration_min: 30, idle_min: 15 })], [journey], from, to, now);
  assert.equal(result.totalMin, 480);
  assert.equal(result.deliveryMin, 30);
});
test("monthly report splits the journey at São Paulo midnight and uses journey hours for profit", () => {
  const rows = reportBreakdown([], [], [], [], "month", [{ ...journey, started_at: "2026-10-01T02:00:00Z", ended_at: "2026-10-01T04:00:00Z" }], now);
  assert.equal(rows.find((r) => r.key === "2026-09-01")?.journeyMin, 60);
  assert.equal(rows.find((r) => r.key === "2026-10-01")?.journeyMin, 60);
  const daily = reportBreakdown([delivery()], [], [], [], "day", [journey], now);
  assert.equal(daily[0]?.profitPerHour, 12.5);
});
