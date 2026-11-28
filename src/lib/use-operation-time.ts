import { operationRecords } from "./operation-records";
import type { TripState } from "./trip-tracker";
// @refresh reset
// Remount consumers when this hook changes: an older mounted version may have
// a different hook signature after an editor update.
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useDeliveries, useJourneys, useActiveWorkJourney } from "./data";
import { operationTime } from "./operation-time";

export function useOperationTime(from: Date, to: Date) {
  const { user } = useAuth();
  const includeRemote = to.getTime() >= Date.now();
  const deliveries = useDeliveries({ from, to, overlap: true }, includeRemote);
  const journeys = useJourneys({ from, to, overlap: true }, includeRemote);
  const [now, setNow] = useState<Date | null>(null);
  const [local, setLocal] = useState<{ owner: string | null; snapshot: TripState | null }>({
    owner: null,
    snapshot: null,
  });
  const active = local.owner === user?.id ? local.snapshot : null;
  const remote = useActiveWorkJourney(includeRemote);
  useEffect(() => {
    const setActive = (snapshot: TripState | null) =>
      setLocal({ owner: user?.id ?? null, snapshot });
    const update = () => {
      if (document.visibilityState === "hidden") return;
      setNow(new Date());
      if (!user) {
        setActive(null);
        return;
      }
      try {
        const raw = JSON.parse(localStorage.getItem(`deliveryos.trip:${user.id}`) ?? "null");
        setActive(raw?.startedAt && (raw.active || raw.pendingSave) ? (raw as TripState) : null);
      } catch {
        setActive(null);
      }
    };
    update();
    const timer = setInterval(update, 15000);
    window.addEventListener("deliveryos:trip-changed", update);
    window.addEventListener("storage", update);
    window.addEventListener("focus", update);
    document.addEventListener("visibilitychange", update);
    return () => {
      clearInterval(timer);
      window.removeEventListener("deliveryos:trip-changed", update);
      window.removeEventListener("storage", update);
      window.removeEventListener("focus", update);
      document.removeEventListener("visibilitychange", update);
    };
  }, [user]);
  const records = useMemo(
    () =>
      operationRecords(
        journeys.data ?? [],
        active,
        remote.data ?? null,
        includeRemote && remote.isSuccess,
      ),
    [journeys.data, active, remote.data, remote.isSuccess, includeRemote],
  );
  const fromTime = from.getTime(),
    toTime = to.getTime();
  const computed = useMemo(
    () =>
      operationTime(
        deliveries.data ?? [],
        records,
        new Date(fromTime),
        new Date(toTime),
        now ?? new Date(fromTime),
      ),
    [deliveries.data, records, fromTime, toTime, now],
  );
  return {
    ...computed,
    records,
    now: now ?? from,
    isPending:
      deliveries.isPending || journeys.isPending || (includeRemote && remote.isPending && !active),
    isError: deliveries.isError || journeys.isError || (includeRemote && remote.isError && !active),
    retry: () => {
      void deliveries.refetch();
      void journeys.refetch();
      if (includeRemote) void remote.refetch();
    },
  };
}
