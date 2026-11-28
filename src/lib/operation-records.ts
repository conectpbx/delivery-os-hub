import type { WorkJourney } from "./operation-time";
import type { TripState } from "./trip-tracker";
import { mergeRemoteTrip } from "./trip-sync";

/** Join persisted history and the latest active snapshot without capturing GPS or double counting IDs. */
export function operationRecords(
  rows: WorkJourney[],
  local: TripState | null,
  remote: TripState | null,
  loaded: boolean,
): WorkJourney[] {
  let snapshot = local;
  if (loaded) {
    if (local) {
      const merged = mergeRemoteTrip(local, remote);
      if (merged && merged !== "push") snapshot = merged;
    } else snapshot = remote;
  }
  if (!snapshot?.startedAt) return rows;
  // Persisted completion is final: an offline/stale active snapshot must not reopen it.
  if (snapshot.active && rows.some((row) => row.id === snapshot.journeyId && row.ended_at))
    return rows;
  const current: WorkJourney = {
    id: snapshot.journeyId ?? "active",
    started_at: snapshot.startedAt,
    ended_at: snapshot.endedAt,
    source: snapshot.source,
    distance_km: snapshot.distanceKm,
    pauses: snapshot.pauses ?? [],
  };
  return [...rows.filter((row) => row.id !== current.id), current];
}
