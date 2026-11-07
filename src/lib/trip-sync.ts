import type { TripState } from "./trip-tracker";
export type TripSyncAction = "start" | "update" | "finish";

const empty: TripState = {
  active: false,
  source: "browser",
  startedAt: null,
  endedAt: null,
  distanceKm: 0,
  points: 0,
  last: null,
};
const version = (state: TripState) =>
  JSON.stringify([
    state.journeyId,
    state.updatedAt,
    state.active,
    state.pendingSave,
    state.endedAt,
    state.pauses,
  ]);

/** Commands remain ordered even when the device clock moves backwards. */
export function nextTripUpdateAt(state: TripState, now = Date.now()) {
  const previous = Date.parse(state.updatedAt ?? "");
  return new Date(Math.max(now, Number.isFinite(previous) ? previous + 1 : now)).toISOString();
}

export function mergeRemoteTrip(
  local: TripState,
  remote: TripState | null,
): TripState | "push" | null {
  if (!remote) {
    if (local.pendingSave) return "push";
    if ((local.active || local.pendingSave) && !local.synced) return "push";
    if ((local.active || local.pendingSave) && local.synced) return { ...empty };
    if (local.endedAt && local.journeyId) return "push";
    return null;
  }
  if (remote.journeyId === local.journeyId) {
    // A finalization is sticky even when a device's clock or GPS snapshot is ahead.
    if (remote.endedAt && !remote.active)
      return {
        ...remote,
        pendingSave: Boolean(local.pendingSave),
        synced: true,
        last: null,
        distanceKm: Math.max(remote.distanceKm, local.distanceKm),
        points: Math.max(remote.points, local.points),
      };
    if (local.endedAt && !local.active) return "push";
    if ((remote.updatedAt ?? "") > (local.updatedAt ?? ""))
      return {
        ...remote,
        synced: true,
        last: null,
        distanceKm: Math.max(remote.distanceKm, local.distanceKm),
        points: Math.max(remote.points, local.points),
      };
    if ((local.updatedAt ?? "") > (remote.updatedAt ?? "") || local.distanceKm > remote.distanceKm)
      return "push";
    if (remote.distanceKm > local.distanceKm || remote.points > local.points)
      return {
        ...remote,
        distanceKm: Math.max(remote.distanceKm, local.distanceKm),
        points: Math.max(remote.points, local.points),
        last: null,
        synced: true,
      };
    if (JSON.stringify(remote.pauses ?? []) !== JSON.stringify(local.pauses ?? []))
      return {
        ...remote,
        synced: true,
        last: null,
        distanceKm: Math.max(remote.distanceKm, local.distanceKm),
        points: Math.max(remote.points, local.points),
      };
    return local.synced ? null : { ...local, synced: true };
  }
  // Pending local history must be saved before adopting a different journey.
  if (local.pendingSave) return null;
  if (local.active && !local.synced) return "push";
  return { ...remote, synced: true, pendingSave: false, last: null };
}

type Options = {
  local: () => TripState;
  apply: (state: TripState) => void;
  read: () => Promise<TripState | null>;
  write: (state: TripState, action: TripSyncAction) => Promise<TripState>;
  error: (error: unknown | null) => void;
  now?: () => number;
  canWrite?: () => boolean;
};

/** Serialize reads and writes; late responses cannot undo a more recent local command. */
export function createTripSync(options: Options) {
  const now = options.now ?? Date.now;
  let stopped = false;
  let flushCommands = false;
  let queue = Promise.resolve();
  let reading: Promise<void> | undefined;
  let lastPush = 0;
  let refreshAgain = false;
  const enqueue = (run: () => Promise<void>, command = false) => {
    queue = queue.then(async () => {
      if (command && options.canWrite?.() === false) return;
      if (stopped && !(command && flushCommands)) return;
      try {
        await run();
      } catch (error) {
        if (!stopped) options.error(error);
      }
    });
    return queue;
  };
  const write = async (snapshot: TripState, action: TripSyncAction) => {
    const remote = await options.write(snapshot, action);
    if (stopped) return;
    lastPush = now();
    const local = options.local();
    if (version(local) === version(snapshot)) {
      if (remote.journeyId !== local.journeyId && !local.pendingSave)
        options.apply({ ...remote, synced: true, last: null });
      else if (remote.journeyId === local.journeyId) {
        // The RPC may reject a stale command and return the authoritative snapshot.
        options.apply({
          ...remote,
          synced: true,
          last: null,
          pendingSave: Boolean(local.pendingSave),
          distanceKm: Math.max(remote.distanceKm, local.distanceKm),
          points: Math.max(remote.points, local.points),
        });
      }
    }
    options.error(null);
  };
  const api = {
    publish: (state: TripState, action: TripSyncAction) =>
      enqueue(() => write(state, action), true),
    refresh(): Promise<void> {
      if (reading) {
        refreshAgain = true;
        return reading;
      }
      reading = enqueue(async () => {
        const before = version(options.local());
        const remote = await options.read();
        if (stopped || before !== version(options.local())) return;
        const local = options.local();
        const merged = mergeRemoteTrip(local, remote);
        if (merged === "push") {
          const controlChanged =
            !remote ||
            remote.journeyId !== local.journeyId ||
            remote.updatedAt !== local.updatedAt ||
            Boolean(remote.endedAt) !== Boolean(local.endedAt);
          if (controlChanged || now() - lastPush >= 30_000)
            await write(
              local,
              local.endedAt && !local.active ? "finish" : !local.synced ? "start" : "update",
            );
        } else if (merged) options.apply(merged);
        if (!stopped) options.error(null);
      }).finally(() => {
        reading = undefined;
        if (refreshAgain && !stopped) {
          refreshAgain = false;
          void api.refresh();
        }
      });
      return reading;
    },
    stop(flush = false) {
      flushCommands = flush;
      stopped = true;
    },
  };
  return api;
}
