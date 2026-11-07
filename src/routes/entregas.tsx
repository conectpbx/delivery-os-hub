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

import { DeliverySummary } from "@/components/DeliverySummary";
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
    <AppShell title="Entregas" subtitle="Registro de corridas, rota no mapa e navegação">
      {" "}
      <JourneySyncStatus error={tracker.syncError} retry={tracker.retrySync} />
      <div className="mb-4 flex min-w-0 flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
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
          <JourneyPauseControl
            active={tracker.trip.active}
            pauses={tracker.trip.pauses}
            pause={tracker.pause}
            resume={tracker.resume}
          />
        </div>
        <GpsTrackingStatus
          trip={tracker.trip}
          error={tracker.error}
          onRetry={tracker.retryBrowserGps}
        />
      </div>
      <DeliverySummary />
      <DeliveryEntry trip={tracker.trip} />
      <div className="mt-4">
        <DeliveryHistory />
      </div>
    </AppShell>
  );
}
