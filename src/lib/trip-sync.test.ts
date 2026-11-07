import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mergeRemoteTrip, type TripState } from "./trip-tracker";
const base: TripState = {
  active: false,
  source: "browser",
  startedAt: null,
  endedAt: null,
  distanceKm: 0,
  points: 0,
  last: null,
};
const active: TripState = {
  ...base,
  active: true,
  startedAt: "2026-10-18T10:00:00Z",
  journeyId: "a",
  updatedAt: "2026-10-18T10:00:00Z",
};
describe("sincronização entre dispositivos", () => {
  it("adota jornada iniciada em outro dispositivo", () => {
    const r = mergeRemoteTrip(base, active) as TripState;
    assert.equal(r.active, true);
    assert.equal(r.journeyId, "a");
  });
  it("adota pausa feita em outro dispositivo", () => {
    const paused = {
      ...active,
      updatedAt: "2026-10-18T11:00:00Z",
      pauses: [{ id: "p", reason: "Almoço", started_at: "2026-10-18T11:00:00Z", ended_at: null }],
    };
    const r = mergeRemoteTrip(active, paused) as TripState;
    assert.equal(r.pauses?.[0]?.reason, "Almoço");
  });
  it("encerra localmente quando outro dispositivo finalizou", () => {
    assert.equal((mergeRemoteTrip({ ...active, synced: true }, null) as TripState).active, false);
  });
  it("envia jornada local ainda não sincronizada", () => {
    assert.equal(mergeRemoteTrip(active, null), "push");
  });
});

import { nextTripUpdateAt } from "./trip-sync";
it("commands advance their version despite an equal or backwards device clock", () => {
  const at = Date.parse(active.updatedAt!);
  assert.equal(Date.parse(nextTripUpdateAt(active, at)), at + 1);
  assert.equal(Date.parse(nextTripUpdateAt(active, at - 60000)), at + 1);
});
it("adopts a remote pause/resume with an equal legacy timestamp", () => {
  const paused = {
    ...active,
    pauses: [{ id: "p", reason: "Almoço", started_at: active.startedAt!, ended_at: null }],
  };
  const result = mergeRemoteTrip({ ...active, synced: true }, paused) as TripState;
  assert.equal(result.pauses?.[0]?.ended_at, null);
  const resumed = {
    ...paused,
    pauses: [{ ...paused.pauses[0]!, ended_at: "2026-10-18T10:01:00Z" }],
    distanceKm: 2,
  };
  assert.equal(
    (mergeRemoteTrip(result, resumed) as TripState).pauses?.[0]?.ended_at,
    "2026-10-18T10:01:00Z",
  );
});
