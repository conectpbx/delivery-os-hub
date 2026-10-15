import assert from "node:assert/strict";
import test from "node:test";
import type { Delivery } from "./data";
import { beginPause, endPause, deliveryMinutes, operationTime, type WorkJourney } from "./operation-time";
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

test("lunch and maintenance pauses are separated from unassigned and delivery time", () => {
  const pauses = [
    { id: "lunch", reason: "Almoço", started_at: "2026-10-12T14:00:00Z", ended_at: "2026-10-12T15:00:00Z" },
    { id: "maintenance", reason: "Manutenção", started_at: "2026-10-12T17:00:00Z", ended_at: "2026-10-12T17:30:00Z" },
  ];
  const time = operationTime([delivery()], [{ ...journey, pauses }], from, to, now);
  assert.equal(time.pauseMin, 90);
  assert.equal(time.deliveryMin, 60);
  assert.equal(time.unassignedMin, 330);
  assert.equal(time.totalMin, 480);
  const [row] = reportBreakdown([delivery()], [], [], [], "day", [{ ...journey, pauses }], now);
  assert.equal(row?.pauseMin, 90);
});
test("only one pause is open and resuming preserves its reason and start", () => {
  const pauses = beginPause([], "Almoço", "2026-10-12T14:00:00Z");
  assert.equal(beginPause(pauses, "Manutenção", "2026-10-12T14:10:00Z").length, 1);
  const closed = endPause(pauses, "2026-10-12T14:30:00Z");
  assert.equal(closed[0]?.reason, "Almoço");
  assert.equal(closed[0]?.started_at, "2026-10-12T14:00:00Z");
  assert.equal(closed[0]?.ended_at, "2026-10-12T14:30:00.000Z");
});
test("active pauses stop at journey finish and overlapping pauses never double count", () => {
  const pauses = [{ id: "p", reason: "Manutenção", started_at: "2026-10-12T19:00:00Z", ended_at: null }];
  const result = operationTime([], [{ ...journey, pauses: [...pauses, { ...pauses[0], id: "p2", reason: "Almoço" }] }], from, to, now);
  assert.equal(result.pauseMin, 60);
  assert.equal(result.unassignedMin, 420);
});
test("pauses crossing a civil month boundary are clipped separately", () => {
  const cross = { ...journey, started_at: "2026-10-01T02:00:00Z", ended_at: "2026-10-01T04:00:00Z", pauses: [{ id: "p", reason: "Almoço", started_at: "2026-10-01T02:30:00Z", ended_at: "2026-10-01T03:30:00Z" }] };
  const rows = reportBreakdown([], [], [], [], "month", [cross], now);
  assert.equal(rows.find((r) => r.key === "2026-09-01")?.pauseMin, 30);
  assert.equal(rows.find((r) => r.key === "2026-10-01")?.pauseMin, 30);
});

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
  const result = operationTime(
    [delivery({ started_at: null, ended_at: null, duration_min: 30, idle_min: 15 })],
    [journey],
    from,
    to,
    now,
  );
  assert.equal(result.totalMin, 480);
  assert.equal(result.deliveryMin, 30);
});
test("monthly report splits the journey at São Paulo midnight and uses journey hours for profit", () => {
  const rows = reportBreakdown(
    [],
    [],
    [],
    [],
    "month",
    [{ ...journey, started_at: "2026-10-01T02:00:00Z", ended_at: "2026-10-01T04:00:00Z" }],
    now,
  );
  assert.equal(rows.find((r) => r.key === "2026-09-01")?.journeyMin, 60);
  assert.equal(rows.find((r) => r.key === "2026-10-01")?.journeyMin, 60);
  const daily = reportBreakdown([delivery()], [], [], [], "day", [journey], now);
  assert.equal(daily[0]?.profitPerHour, 12.5);
});
test("legacy open delivery uses its creation time rather than route estimate", () => {
  const open = delivery({
    started_at: null,
    ended_at: null,
    status: "em_rota",
    occurred_at: "2026-10-12T13:00:00Z",
    duration_min: 20,
  });
  const time = operationTime([open], [journey], from, to, new Date("2026-10-12T15:00:00Z"));
  assert.equal(time.deliveryMin, 120);
  assert.equal(time.unassignedMin, 60);
});
test("legacy route with recorded finish retains the elapsed interval after completion", () => {
  assert.equal(deliveryMinutes(delivery({ started_at: null, duration_min: 53 }), now), 120);
});
test("open legacy route crossing midnight remains delivery time in yesterday and today's report", () => {
  const open = delivery({
    occurred_at: "2026-10-12T23:00:00-03:00",
    started_at: null,
    ended_at: null,
    status: "em_rota",
  });
  const rows = reportBreakdown(
    [open],
    [],
    [],
    [],
    "day",
    [],
    new Date("2026-10-13T01:00:00-03:00"),
  );
  assert.equal(rows.find((r) => r.key === "2026-10-12")?.workedMin, 60);
  assert.equal(rows.find((r) => r.key === "2026-10-13")?.workedMin, 60);
  assert.equal(rows.find((r) => r.key === "2026-10-13")?.unassignedMin, 0);
});
test("October 13 records use the recorded finish instead of the 53-minute estimate", () => {
  const records = [
    delivery({
      id: "1",
      started_at: null,
      ended_at: null,
      occurred_at: "2026-10-13T13:13:01.579666Z",
      duration_min: 23,
    }),
    delivery({
      id: "2",
      started_at: null,
      ended_at: null,
      occurred_at: "2026-10-13T13:28:35.794851Z",
      duration_min: 31,
    }),
    delivery({
      id: "3",
      started_at: null,
      ended_at: null,
      occurred_at: "2026-10-13T13:45:31.664382Z",
      duration_min: 31,
    }),
    delivery({
      id: "4",
      started_at: null,
      ended_at: null,
      occurred_at: "2026-10-13T15:14:15.021528Z",
      duration_min: 35,
    }),
    delivery({
      id: "5",
      started_at: null,
      ended_at: null,
      occurred_at: "2026-10-13T16:07:27.603567Z",
      duration_min: 25,
    }),
    delivery({
      id: "6",
      started_at: null,
      ended_at: "2026-10-13T19:45:01.443Z",
      occurred_at: "2026-10-13T17:40:46.092702Z",
      duration_min: 53,
    }),
  ];
  const shift = {
    ...journey,
    started_at: "2026-10-13T12:45:30.294Z",
    ended_at: "2026-10-13T20:17:35.488Z",
  };
  const start = new Date("2026-10-13T00:00:00-03:00");
  const end = new Date("2026-10-13T23:59:59.999-03:00");
  const time = operationTime(records, [shift], start, end, new Date("2026-10-14T11:53:00Z"));
  assert.equal(Math.round(time.journeyMin), 452);
  assert.equal(Math.round(time.deliveryMin), 269);
  assert.equal(Math.round(time.unassignedMin), 183);
  const [row] = reportBreakdown(
    records,
    [],
    [],
    [],
    "day",
    [shift],
    new Date("2026-10-14T11:53:00Z"),
    { from: start, to: end },
  );
  assert.equal(row?.workedMin, time.deliveryMin);
  assert.equal(row?.unassignedMin, time.unassignedMin);
});
