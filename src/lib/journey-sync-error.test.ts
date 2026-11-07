import test from "node:test";
import assert from "node:assert/strict";
import { journeySyncError } from "./journey-sync-error";
import { repairLegacyTrip } from "./legacy-trip";
import type { TripState } from "./trip-tracker";

test("journey synchronization distinguishes missing migration, session, permission and network", () => {
  assert.equal(journeySyncError(null), null);
  for (const code of ["PGRST202", "42883", "42P01", "PGRST205"])
    assert.match(journeySyncError({ code })!, /migração/);
  assert.match(journeySyncError({ status: 401 })!, /sessão/);
  assert.match(journeySyncError({ code: "42501" })!, /permissões/);
  assert.match(journeySyncError({ code: "22023" })!, /dados/);
  assert.match(journeySyncError(new Error("offline"))!, /Sem conexão/);
  assert.doesNotMatch(journeySyncError({ message: "private-token-and-user-id" })!, /private-token/);
});

test("legacy journey gains stable identity/version without losing distance, pause or pending save", () => {
  const old: TripState = {
    active: true,
    source: "browser",
    startedAt: "2026-11-06T10:00:00Z",
    endedAt: null,
    distanceKm: 14,
    points: 23,
    last: null,
    pauses: [{ id: "pause", started_at: "2026-11-06T11:00:00Z", ended_at: null, reason: "Almoço" }],
  };
  const repaired = repairLegacyTrip(old, () => "new-id");
  assert.equal(repaired.journeyId, "new-id");
  assert.equal(repaired.updatedAt, old.startedAt);
  assert.equal(repaired.distanceKm, 14);
  assert.deepEqual(repaired.pauses, old.pauses);
  assert.equal(repaired.synced, false);
  assert.equal(
    repairLegacyTrip(repaired, () => "another-id"),
    repaired,
  );
  const pending = repairLegacyTrip({
    ...old,
    active: false,
    pendingSave: true,
    endedAt: "2026-11-06T12:00:00Z",
  });
  assert.equal(pending.pendingSave, true);
  assert.equal(pending.updatedAt, pending.endedAt);
  const idle = { ...old, active: false, startedAt: null };
  assert.equal(repairLegacyTrip(idle), idle);
});
