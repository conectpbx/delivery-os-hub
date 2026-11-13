import { createFileRoute } from "@tanstack/react-router";
import { JourneySyncStatus } from "@/components/JourneySyncStatus";

import { useEffect } from "react";

import { Play, Square } from "lucide-react";

import { AppShell } from "@/components/AppShell";

import { JourneyPauseControl } from "@/components/JourneyPauseControl";
import { useTripTracker } from "@/lib/trip-tracker";
import { GpsTrackingStatus } from "@/components/GpsTrackingStatus";
import { useGpsDevices, useGpsDeviceState } from "@/lib/gps-integration";

import { Button } from "@/components/ui/button";

import { dateTimeLabel } from "@/lib/format";

import { DeliveryEntry } from "@/components/DeliveryEntry";
import { DeliveryHistory } from "@/components/DeliveryHistory";
export const Route = createFileRoute("/entregas")({
  head: () => ({
    meta: [
      { title: "Entregas e rotas — Delivery OS" },
      {
        name: "description",
        content:
          "Registre entregas com GPS automático, prévia da rota no mapa, múltiplos pontos e navegação.",
      },
      { property: "og:title", content: "Entregas e rotas — Delivery OS" },
      {
        property: "og:description",
        content: "Prévia da rota no mapa, múltiplas paradas e histórico completo de corridas.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Entregas,
});

function Entregas() {
  const tracker = useTripTracker();
  const { trip, pushIntegratedGps } = tracker;
  const gpsDevices = useGpsDevices();
  const externalGps = useGpsDeviceState(
    tracker.trip.active,
    tracker.trip.integratedBaseline?.tokenId,
    gpsDevices.data?.filter((device) => device.is_active).map((device) => device.id),
  );
  useEffect(() => {
    if (trip.active && externalGps.data) pushIntegratedGps(externalGps.data);
  }, [externalGps.data, trip.active, pushIntegratedGps]);

  return (
    <AppShell title="Entregas" subtitle="Inicie, acompanhe e conclua suas rotas">
      <JourneySyncStatus error={tracker.syncError} retry={tracker.retrySync} />
      <div className="surface-card mb-5 flex min-w-0 flex-wrap items-center justify-between gap-3 p-4">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold">Jornada de trabalho</h2>
          <p className="text-xs text-muted-foreground">
            {tracker.trip.active
              ? "Em andamento"
              : tracker.trip.pendingSave
                ? "Salvamento pendente"
                : "Sem jornada ativa"}
            {tracker.trip.startedAt ? ` · Início ${dateTimeLabel(tracker.trip.startedAt)}` : ""}
          </p>
        </div>
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
          {tracker.trip.active || tracker.trip.pendingSave ? (
            <Button
              variant="outline"
              className="min-h-11 gap-2"
              disabled={tracker.saving}
              onClick={() => void tracker.finish()}
            >
              <Square className="size-4" />
              {tracker.saving
                ? "Salvando…"
                : tracker.trip.pendingSave
                  ? "Salvar jornada"
                  : "Finalizar jornada"}
            </Button>
          ) : (
            <Button
              className="min-h-11 gap-2"
              onClick={() => {
                tracker.start(
                  gpsDevices.data?.some((d) => d.is_active) ? "external" : "browser",
                  externalGps.data,
                );
                void externalGps.refetch();
              }}
            >
              <Play className="size-4" />
              Iniciar jornada
            </Button>
          )}
          {trip.active && (
            <JourneyPauseControl
              active={tracker.trip.active}
              pauses={tracker.trip.pauses}
              pause={tracker.pause}
              resume={tracker.resume}
            />
          )}
        </div>
        <GpsTrackingStatus
          trip={tracker.trip}
          error={tracker.error}
          onRetry={tracker.retryBrowserGps}
        />
      </div>
      <div className="grid min-w-0 items-start gap-5 xl:grid-cols-[minmax(340px,420px)_minmax(0,1fr)] [&>*]:min-w-0">
        <DeliveryEntry trip={tracker.trip} />
        <DeliveryHistory />
      </div>
    </AppShell>
  );
}
