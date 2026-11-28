import test from "node:test";
import assert from "node:assert/strict";
import { operationRecords } from "./operation-records";
import { operationTime } from "./operation-time";
import type { TripState } from "./trip-tracker";
const remote: TripState = {
  active: true,
  journeyId: "j",
  source: "external",
  startedAt: "2026-11-20T10:00:00Z",
  endedAt: null,
  distanceKm: 10,
  points: 2,
  last: null,
  updatedAt: "2026-11-20T10:00:00Z",
  synced: true,
  pauses: [
    {
      id: "p",
      started_at: "2026-11-20T11:00:00Z",
      ended_at: "2026-11-20T11:10:00Z",
      reason: "Pausa",
    },
  ],
};
test("a read-only observer without local storage sees another device's unassigned time", () => {
  const records = operationRecords([], null, remote, true);
  const time = operationTime(
    [],
    records,
    new Date("2026-11-20T00:00:00Z"),
    new Date("2026-11-20T23:59:59Z"),
    new Date("2026-11-20T12:00:00Z"),
  );
  assert.equal(time.journeyMin, 120);
  assert.equal(time.pauseMin, 10);
  assert.equal(time.unassignedMin, 110);
});
test("remote completion replaces a stale active local snapshot and does not duplicate history", () => {
  const ended = {
    ...remote,
    active: false,
    endedAt: "2026-11-20T12:00:00Z",
    updatedAt: "2026-11-20T12:00:00Z",
  };
  const history = [
    {
      id: "j",
      started_at: remote.startedAt!,
      ended_at: ended.endedAt,
      source: "external" as const,
      distance_km: 10,
    },
  ];
  const rows = operationRecords(history, remote, ended, true);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.ended_at, ended.endedAt);
});
test("a failed read preserves an unsynced local journey", () => {
  assert.equal(operationRecords([], { ...remote, synced: false }, null, false)[0]?.id, "j");
});

test("old completed deliveries do not consume the current shift, but an open route does", () => {
  const records = operationRecords([], null, remote, true);
  const delivery = {
    id: "d",
    occurred_at: "2026-11-20T05:00:00Z",
    status: "concluida",
    duration_min: 10,
    idle_min: 0,
  } as import("./data").Delivery;
  const from = new Date("2026-11-20T00:00:00Z"),
    to = new Date("2026-11-20T23:59:59Z"),
    now = new Date("2026-11-20T12:00:00Z");
  assert.equal(operationTime([delivery], records, from, to, now).unassignedMin, 110);
  assert.equal(
    operationTime([{ ...delivery, status: "em_rota" }], records, from, to, now).unassignedMin,
    0,
  );
});

test("completed persisted journeys stay finished when an offline active snapshot is stale", () => {
  const rows = [
    {
      id: "j",
      started_at: remote.startedAt!,
      ended_at: "2026-11-20T12:00:00Z",
      source: "external",
      distance_km: 10,
      pauses: remote.pauses ?? [],
    },
  ];
  const records = operationRecords(rows, remote, null, false);
  assert.equal(records, rows);
  const result = operationTime(
    [],
    records,
    new Date("2026-11-20T00:00:00Z"),
    new Date("2026-11-20T23:59:59Z"),
    new Date("2026-11-20T18:00:00Z"),
  );
  assert.equal(result.journeyMin, 120);
  assert.equal(result.unassignedMin, 110);
});
