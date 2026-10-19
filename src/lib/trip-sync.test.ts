import { describe, expect, it } from "bun:test";
import { mergeRemoteTrip, type TripState } from "./trip-tracker";
const base: TripState = { active: false, source: "browser", startedAt: null, endedAt: null, distanceKm: 0, points: 0, last: null };
const active: TripState = { ...base, active: true, startedAt: "2026-10-18T10:00:00Z", journeyId: "a", updatedAt: "2026-10-18T10:00:00Z" };
describe("sincronização entre dispositivos", () => {
  it("adota jornada iniciada em outro dispositivo", () => {
    expect(mergeRemoteTrip(base, active)).toMatchObject({ active: true, journeyId: "a" });
  });
  it("adota pausa feita em outro dispositivo", () => {
    const paused = { ...active, updatedAt: "2026-10-18T11:00:00Z", pauses: [{ id: "p", reason: "Almoço", started_at: "2026-10-18T11:00:00Z", ended_at: null }] };
    const r = mergeRemoteTrip(active, paused) as TripState;
    expect(r.pauses?.[0]?.reason).toBe("Almoço");
  });
  it("encerra localmente quando outro dispositivo finalizou", () => {
    expect(mergeRemoteTrip({ ...active, synced: true }, null)).toMatchObject({ active: false });
  });
  it("envia jornada local ainda não sincronizada", () => {
    expect(mergeRemoteTrip(active, null)).toBe("push");
  });
});
