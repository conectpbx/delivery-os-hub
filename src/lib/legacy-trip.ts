import type { TripState } from "./trip-tracker";

/** Old drafts predate the identity/version required by the guarded synchronization RPC. */
export function repairLegacyTrip(
  state: TripState,
  newId: () => string = () => crypto.randomUUID(),
): TripState {
  if (
    (!state.active && !state.pendingSave && !state.endedAt) ||
    !state.startedAt ||
    !Number.isFinite(Date.parse(state.startedAt))
  )
    return state;
  if (state.journeyId && state.updatedAt) return state;
  return {
    ...state,
    journeyId: state.journeyId || newId(),
    updatedAt: state.updatedAt || state.endedAt || state.startedAt,
    synced: false,
  };
}
