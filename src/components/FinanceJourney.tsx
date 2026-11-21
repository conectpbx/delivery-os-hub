import { memo, useEffect, useMemo, useState } from "react";
import { useHydrated } from "@tanstack/react-router";
import { Copy, Link2, Play, Smartphone, Square, Unplug } from "lucide-react";
import { toast } from "sonner";
import { JourneySyncStatus } from "./JourneySyncStatus";
import { JourneyPauseControl } from "./JourneyPauseControl";
import { OperationTimeStats } from "./OperationTimeStats";
import { GpsRouteMap } from "./GpsRouteMap";
import { EmptyState, SectionCard } from "./ui-kit";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { useJourneys } from "@/lib/data";
import { dateLabel, dateTimeLabel, minutesLabel, num } from "@/lib/format";
import { useTripTracker } from "@/lib/trip-tracker";
import {
  useCreateGpsDevice,
  useGpsDevices,
  useGpsDeviceState,
  useGpsRoutePoints,
  useGpsRouteSessions,
  useRevokeGpsDevice,
} from "@/lib/gps-integration";

export const FinanceJourney = memo(function FinanceJourney({
  from,
  to,
  lastOdometer,
  onOdometer,
}: {
  from: Date;
  to: Date;
  lastOdometer: number | null;
  onOdometer: (value: string) => void;
}) {
  const hydrated = useHydrated();
  const gpsEndpoint = hydrated ? `${window.location.origin}/api/public/gps` : "/api/public/gps";
  const [routesOpen, setRoutesOpen] = useState(false);
  const [journeyLimit, setJourneyLimit] = useState(20);
  const [deviceName, setDeviceName] = useState("PainelOverlay");
  const [newGpsToken, setNewGpsToken] = useState<string | null>(null);
  const {
    trip,
    error: tripError,
    syncError,
    retrySync,
    start,
    finish,
    reset,
    pushIntegratedGps,
    saving,
    pause,
    resume,
  } = useTripTracker();
  const journeys = useJourneys({ from, to, overlap: true });
  const fromTime = from.getTime();
  const toTime = to.getTime();
  const journeyHistory = useMemo(
    () =>
      (journeys.data ?? []).filter(
        (journey) =>
          Date.parse(journey.started_at) <= toTime &&
          Date.parse(journey.ended_at ?? journey.started_at) >= fromTime,
      ),
    [journeys.data, fromTime, toTime],
  );
  useEffect(() => setJourneyLimit(20), [fromTime, toTime]);
  const [clock, setClock] = useState<number | null>(null);
  useEffect(() => {
    const update = () => {
      if (document.visibilityState !== "hidden") setClock(Date.now());
    };
    update();
    const timer = trip.active ? setInterval(update, 15000) : null;
    document.addEventListener("visibilitychange", update);
    return () => {
      if (timer) clearInterval(timer);
      document.removeEventListener("visibilitychange", update);
    };
  }, [trip.active, trip.endedAt]);
  const journeyMinutes =
    trip.startedAt && clock
      ? Math.max(
          0,
          ((trip.endedAt ? Date.parse(trip.endedAt) : clock) - Date.parse(trip.startedAt)) / 60000,
        )
      : 0;
  const gpsDevices = useGpsDevices();
  const externalGps = useGpsDeviceState(
    trip.active,
    trip.integratedBaseline?.tokenId,
    gpsDevices.data?.filter((device) => device.is_active).map((device) => device.id),
  );

  useEffect(() => {
    if (!trip.active || !trip.startedAt || !externalGps.data) return;
    pushIntegratedGps(externalGps.data);
  }, [externalGps.data, trip.active, trip.startedAt, pushIntegratedGps]);
  const createGpsDevice = useCreateGpsDevice();
  const revokeGpsDevice = useRevokeGpsDevice();

  const estimatedOdometer =
    lastOdometer != null ? Math.round(Number(lastOdometer) + trip.distanceKm) : null;
  return (
    <>
      <JourneySyncStatus error={syncError} retry={retrySync} />
      <SectionCard
        className="mt-4"
        title="Jornada por GPS"
        description="Inicie no começo do dia e finalize no fim — a quilometragem é somada automaticamente"
      >
        <dl className="mb-4 grid gap-3 sm:grid-cols-3">
          <div>
            <dt className="text-xs text-muted-foreground">Início</dt>
            <dd className="text-sm font-medium">
              {trip.startedAt ? dateTimeLabel(trip.startedAt) : "—"}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Término</dt>
            <dd className="text-sm font-medium">
              {trip.endedAt ? dateTimeLabel(trip.endedAt) : trip.active ? "Em andamento" : "—"}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Duração da jornada</dt>
            <dd className="text-lg font-semibold tabular-nums">{minutesLabel(journeyMinutes)}</dd>
          </div>
        </dl>
        <div className="flex flex-wrap items-center gap-3">
          <div className="min-w-0">
            <p className="text-2xl font-semibold tabular-nums">{num(trip.distanceKm, 3)} km</p>
            <p className="truncate text-xs text-muted-foreground">
              {trip.active
                ? `${trip.points ? "Capturando" : "Aguardando sinal"} ${trip.source === "external" ? "via GPS integrado" : "via GPS do navegador"} desde ${dateLabel(trip.startedAt ?? new Date().toISOString())} · ${trip.points} pontos`
                : trip.endedAt
                  ? `Jornada finalizada · ${trip.points} pontos`
                  : "Nenhuma jornada em andamento"}
            </p>
          </div>
          <div className="ml-auto flex flex-wrap gap-2">
            <JourneyPauseControl
              active={trip.active}
              pauses={trip.pauses}
              pause={pause}
              resume={resume}
            />
            {trip.active || trip.pendingSave ? (
              <Button variant="destructive" onClick={finish} disabled={saving}>
                <Square className="mr-2 size-4" />{" "}
                {saving ? "Salvando…" : trip.pendingSave ? "Salvar jornada" : "Finalizar"}
              </Button>
            ) : (
              <Button
                onClick={() => {
                  const integrated = gpsDevices.data?.some((device) => device.is_active);
                  start(integrated ? "external" : "browser", externalGps.data);
                  void externalGps.refetch();
                }}
              >
                <Play className="mr-2 size-4" /> Iniciar jornada
              </Button>
            )}
            <Button
              variant="secondary"
              disabled={trip.distanceKm <= 0}
              onClick={() => {
                if (estimatedOdometer == null) {
                  toast.error("Registre um abastecimento com odômetro para usar como base");
                  return;
                }
                onOdometer(String(estimatedOdometer));
                toast.success(`Odômetro estimado: ${estimatedOdometer} km`);
              }}
            >
              Preencher odômetro
            </Button>
            {trip.startedAt && !trip.active && !trip.pendingSave ? (
              <Button variant="ghost" onClick={reset}>
                Zerar
              </Button>
            ) : null}
          </div>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          {lastOdometer != null
            ? `Base: ${num(Number(lastOdometer))} km do último abastecimento → estimativa ${num(estimatedOdometer ?? 0)} km.`
            : "Informe o odômetro em um abastecimento para servir de base ao cálculo."}
          {tripError ? ` · GPS: ${tripError}` : ""}
          {externalGps.isError && trip.active
            ? " · Não foi possível consultar o GPS integrado. Verifique a conexão."
            : ""}
          {trip.active && trip.source === "external"
            ? " · O app integrado deve continuar enviando leituras; deixe esta tela aberta para acompanhar."
            : ""}
        </p>
      </SectionCard>

      <OperationTimeStats from={from} to={to} />
      <SectionCard className="mt-4" title="Histórico de jornadas">
        {journeys.isError ? (
          <p className="text-sm text-destructive">Não foi possível carregar as jornadas.</p>
        ) : journeyHistory.length ? (
          <ul className="divide-y divide-border">
            {journeyHistory.slice(0, journeyLimit).map((j) => (
              <li key={j.id} className="flex flex-wrap justify-between gap-2 py-3 text-sm">
                <div>
                  <p>Início: {dateTimeLabel(j.started_at)}</p>
                  <p className="text-xs text-muted-foreground">
                    Término: {j.ended_at ? dateTimeLabel(j.ended_at) : "Em andamento"}
                  </p>
                </div>
                <p className="font-medium tabular-nums">
                  {minutesLabel(
                    (Date.parse(j.ended_at ?? j.started_at) - Date.parse(j.started_at)) / 60000,
                  )}{" "}
                  · {num(j.distance_km)} km
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState>Nenhuma jornada finalizada.</EmptyState>
        )}
        {journeyHistory.length > journeyLimit ? (
          <Button variant="outline" onClick={() => setJourneyLimit((limit) => limit + 20)}>
            Carregar mais jornadas
          </Button>
        ) : null}
      </SectionCard>

      <details
        className="surface-card mt-4 p-4"
        onToggle={(event) => setRoutesOpen(event.currentTarget.open)}
      >
        <summary className="cursor-pointer text-sm font-semibold">
          Rotas registradas pelo aplicativo
        </summary>
        {routesOpen ? <GpsRouteHistory /> : null}
      </details>

      <SectionCard
        className="mt-4"
        title="Aplicativo de odômetro"
        description="Conecte o PainelOverlay para receber jornada, odômetro e localização em segundo plano"
      >
        <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
          <div className="space-y-3">
            <div className="rounded-lg border border-border p-3">
              <p className="flex items-center gap-2 text-sm font-semibold">
                <Link2 className="size-4 text-primary" /> Endereço de envio
              </p>
              <div className="mt-2 flex gap-2">
                <Input value={gpsEndpoint} readOnly aria-label="Endereço da API GPS" />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  aria-label="Copiar endereço da API"
                  onClick={async () => {
                    await navigator.clipboard.writeText(gpsEndpoint);
                    toast.success("Endereço copiado");
                  }}
                >
                  <Copy className="size-4" />
                </Button>
              </div>
            </div>

            {newGpsToken ? (
              <div className="rounded-lg border border-primary/30 bg-primary/5 p-3">
                <p className="text-sm font-semibold">Token criado — copie agora</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Por segurança, ele não será exibido novamente.
                </p>
                <div className="mt-2 flex gap-2">
                  <Input value={newGpsToken} readOnly aria-label="Token do aplicativo GPS" />
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    aria-label="Copiar token"
                    onClick={async () => {
                      await navigator.clipboard.writeText(newGpsToken);
                      toast.success("Token copiado");
                    }}
                  >
                    <Copy className="size-4" />
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-2 sm:flex-row">
                <Input
                  value={deviceName}
                  maxLength={80}
                  aria-label="Nome do dispositivo"
                  placeholder="Nome do dispositivo"
                  onChange={(event) => setDeviceName(event.target.value)}
                />
                <Button
                  type="button"
                  disabled={!deviceName.trim() || createGpsDevice.isPending}
                  onClick={async () => {
                    try {
                      const created = await createGpsDevice.mutateAsync(deviceName);
                      setNewGpsToken(created.token);
                      toast.success("Conexão criada");
                    } catch {
                      toast.error("Não foi possível criar a conexão");
                    }
                  }}
                >
                  <Smartphone className="mr-2 size-4" />
                  {createGpsDevice.isPending ? "Criando..." : "Gerar token"}
                </Button>
              </div>
            )}

            {(gpsDevices.data ?? []).map((device) => (
              <div
                key={device.id}
                className="flex items-center gap-3 rounded-lg border border-border p-3"
              >
                <Smartphone className="size-4 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{device.device_name}</p>
                  <p className="text-xs text-muted-foreground">
                    {device.is_active
                      ? device.last_used_at
                        ? `Último envio: ${dateLabel(device.last_used_at)}`
                        : "Aguardando o primeiro envio"
                      : "Conexão revogada"}
                  </p>
                </div>
                {device.is_active ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={`Revogar ${device.device_name}`}
                    disabled={revokeGpsDevice.isPending}
                    onClick={async () => {
                      try {
                        await revokeGpsDevice.mutateAsync(device.id);
                        setNewGpsToken(null);
                        toast.success("Conexão revogada");
                      } catch {
                        toast.error("Não foi possível revogar a conexão");
                      }
                    }}
                  >
                    <Unplug className="size-4" />
                  </Button>
                ) : null}
              </div>
            ))}
          </div>

          <div className="rounded-lg border border-border p-4">
            <p className="text-xs text-muted-foreground">Última leitura externa</p>
            {externalGps.isError ? (
              <p className="mt-2 text-sm text-destructive">
                Falha ao consultar o GPS integrado. Verifique a conexão e sua sessão.
              </p>
            ) : null}
            {externalGps.data ? (
              <>
                <p className="mt-1 text-2xl font-semibold tabular-nums">
                  {num(externalGps.data.total_km)} km
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Jornada {num(externalGps.data.trip_km)} km
                  {externalGps.data.speed_kmh != null
                    ? ` · ${num(externalGps.data.speed_kmh)} km/h`
                    : ""}
                </p>
                <p className="mt-2 text-xs text-muted-foreground">
                  Precisão {num(externalGps.data.accuracy_m, 0)} m ·{" "}
                  {dateTimeLabel(externalGps.data.captured_at)}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Recebida em {dateTimeLabel(externalGps.data.received_at)}
                </p>
                <Button
                  type="button"
                  variant="secondary"
                  className="mt-3 w-full"
                  onClick={() => {
                    onOdometer(String(Math.round(Number(externalGps.data?.total_km ?? 0))));
                    toast.success("Odômetro preenchido pelo aplicativo");
                  }}
                >
                  Usar odômetro
                </Button>
              </>
            ) : (
              <p className="mt-2 text-sm text-muted-foreground">
                Configure a URL e o token no PainelOverlay para receber a primeira leitura.
              </p>
            )}
            <Button
              type="button"
              variant="outline"
              className="mt-3 w-full"
              disabled={externalGps.isFetching}
              onClick={() => void externalGps.refetch()}
            >
              {externalGps.isFetching ? "Consultando..." : "Atualizar leitura"}
            </Button>
          </div>
        </div>
      </SectionCard>
    </>
  );
});

const GpsRouteHistory = memo(function GpsRouteHistory() {
  const gpsRouteSessions = useGpsRouteSessions();
  const [selectedGpsRouteId, setSelectedGpsRouteId] = useState<string | null>(null);
  const selectedGpsRoute =
    gpsRouteSessions.data?.find((route) => route.id === selectedGpsRouteId) ??
    gpsRouteSessions.data?.[0] ??
    null;
  const gpsRoutePoints = useGpsRoutePoints(selectedGpsRoute?.id, !selectedGpsRoute?.ended_at);
  return (
    <SectionCard
      className="mt-4"
      title="Rotas registradas pelo aplicativo"
      description="Histórico completo dos pontos GPS enviados pelo serviço Android"
    >
      {gpsRouteSessions.isError ? (
        <p className="text-sm text-destructive">Não foi possível carregar as rotas GPS.</p>
      ) : gpsRouteSessions.data?.length ? (
        <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
          <div className="space-y-2">
            {gpsRouteSessions.data.slice(0, 20).map((route) => (
              <button
                key={route.id}
                type="button"
                onClick={() => setSelectedGpsRouteId(route.id)}
                className={
                  "w-full rounded-lg border p-3 text-left transition " +
                  (selectedGpsRoute?.id === route.id
                    ? "border-primary bg-primary/5"
                    : "border-border hover:bg-muted/40")
                }
              >
                <p className="text-sm font-medium">{dateTimeLabel(route.started_at)}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {route.ended_at ? dateTimeLabel(route.ended_at) : "Em andamento"}
                </p>
                <p className="mt-2 text-sm tabular-nums">
                  {num(Number(route.distance_km), 2)} km · {route.point_count} pontos
                </p>
              </button>
            ))}
          </div>

          <div className="min-w-0">
            {selectedGpsRoute ? (
              <>
                <div className="mb-3 grid gap-3 sm:grid-cols-3">
                  <div>
                    <p className="text-xs text-muted-foreground">Distância</p>
                    <p className="font-semibold tabular-nums">
                      {num(Number(selectedGpsRoute.distance_km), 2)} km
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Pontos</p>
                    <p className="font-semibold tabular-nums">{selectedGpsRoute.point_count}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Status</p>
                    <p className="font-semibold">
                      {selectedGpsRoute.ended_at ? "Finalizada" : "Em andamento"}
                    </p>
                  </div>
                </div>

                {gpsRoutePoints.isError ? (
                  <p className="text-sm text-destructive">
                    Não foi possível carregar os pontos desta rota.
                  </p>
                ) : gpsRoutePoints.isLoading ? (
                  <div className="flex h-80 items-center justify-center rounded-lg border border-border text-sm text-muted-foreground">
                    Carregando trajeto…
                  </div>
                ) : (
                  <GpsRouteMap points={gpsRoutePoints.data ?? []} />
                )}
              </>
            ) : (
              <EmptyState>Selecione uma rota para visualizar o trajeto.</EmptyState>
            )}
          </div>
        </div>
      ) : (
        <EmptyState>
          Nenhuma rota GPS registrada. Inicie uma jornada no aplicativo Android para começar.
        </EmptyState>
      )}
    </SectionCard>
  );
});
