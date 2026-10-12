import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useDeliveries, useJourneys } from "./data";
import { operationTime, type WorkJourney } from "./operation-time";

export function useOperationTime(from: Date, to: Date) {
  const { user } = useAuth();
  const deliveries = useDeliveries();
  const journeys = useJourneys();
  const [now, setNow] = useState<Date | null>(null);
  const [active, setActive] = useState<WorkJourney | null>(null);
  useEffect(() => {
    const update = () => {
      setNow(new Date());
      if (!user) {
        setActive(null);
        return;
      }
      try {
        const raw = JSON.parse(localStorage.getItem(`deliveryos.trip:${user.id}`) ?? "null");
        setActive(
          raw?.startedAt && (raw.active || raw.pendingSave)
            ? {
                id: raw.journeyId ?? "active",
                started_at: raw.startedAt,
                ended_at: raw.endedAt,
                source: raw.source,
                distance_km: raw.distanceKm,
              }
            : null,
        );
      } catch {
        setActive(null);
      }
    };
    update();
    const timer = setInterval(update, 15000);
    window.addEventListener("deliveryos:trip-changed", update);
    window.addEventListener("storage", update);
    window.addEventListener("focus", update);
    return () => {
      clearInterval(timer);
      window.removeEventListener("deliveryos:trip-changed", update);
      window.removeEventListener("storage", update);
      window.removeEventListener("focus", update);
    };
  }, [user?.id]);
  const rows = journeys.data ?? [];
  const records = active && !rows.some((j) => j.id === active.id) ? [...rows, active] : rows;
  return {
    ...operationTime(deliveries.data ?? [], records, from, to, now ?? from),
    records,
    now: now ?? from,
  };
}
