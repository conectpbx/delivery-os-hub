import { DeliveryStopAddress } from "./DeliveryStopAddress";
import { resolveDeliveryLocation } from "@/lib/delivery-location";
import { deliveryFinishingDraft } from "@/lib/delivery-draft";
import { MapsNavigationLink } from "@/components/MapsNavigationLink";

import { memo, useEffect, useMemo, useState } from "react";

import { MapPin, Navigation, Plus, Trash2, X } from "lucide-react";
import { toast } from "sonner";

import { deliveryMinutes } from "@/lib/operation-time";

import { EmptyState, SectionCard } from "@/components/ui-kit";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import { useRemove, useUpdate, type Delivery } from "@/lib/data";

import { brl, dateTimeLabel, minutesLabel, num, paymentMethodLabel } from "@/lib/format";

import {
  geolocationErrorMessage,
  getCurrentPosition,
  isGeolocationError,
  navigationUrl,
  newStop,
  reverseGeocodeAddress,
  type Stop,
} from "@/lib/geo";
import { usePersistentState } from "@/lib/persistent-state";

import { useCalendarNow } from "@/hooks/useCalendarNow";

import { recordedStops, historyStops, routeTotals, type StoredStop } from "@/lib/delivery-records";

import { useDeliveryHistory } from "@/lib/data";
import { deliveryPeriod } from "@/lib/delivery-scope";
export const DeliveryHistory = memo(function DeliveryHistory() {
  const now = useCalendarNow();
  const [histRange, setHistRange] = useState<"hoje" | "7d" | "mes" | "tudo">("hoje");
  const range = useMemo(() => deliveryPeriod(histRange, now), [histRange, now]);
  const history = useDeliveryHistory(range);
  const data = useMemo(
    () => [
      ...new Map(
        (history.data?.pages.flatMap((page) => page.rows) ?? []).map((row) => [row.id, row]),
      ).values(),
    ],
    [history.data],
  );
  const [visible, setVisible] = useState(20);
  const fromTime = range.from?.getTime(),
    toTime = range.to?.getTime();
  useEffect(() => setVisible(20), [histRange, fromTime, toTime]);
  const updateDelivery = useUpdate<Record<string, unknown>>("deliveries", "deliveries");
  const remove = useRemove("deliveries", "deliveries");
  const [finishing, setFinishing] = usePersistentState<{
    id: string;
    stops: Stop[];
  } | null>("entregas.finishing", null, (value) => deliveryFinishingDraft.parse(value));
  const [finishGeo, setFinishGeo] = useState<string | null>(null);
  const patchFinishStop = (stopId: string, values: Partial<Stop>) =>
    setFinishing((f) =>
      f ? { ...f, stops: f.stops.map((s) => (s.id === stopId ? { ...s, ...values } : s)) } : f,
    );

  /** Grava os pontos já informados na entrega em rota (sem concluir). */
  async function persistFinishStops(id: string, raw: StoredStop[], list2: Stop[]) {
    const filled = recordedStops(
      await Promise.all(
        list2
          .filter((s) => s.address.trim() || (s.lat != null && s.lng != null))
          .map((s) => resolveDeliveryLocation(s)),
      ),
    );
    if (!filled.length) return false;
    await updateDelivery.mutateAsync({
      id,
      values: { stops: [...raw, ...filled], status: "em_rota" },
    });
    return true;
  }

  async function captureFinishGps(stopId: string) {
    setFinishGeo(stopId);
    try {
      const { lat, lng } = await getCurrentPosition();
      patchFinishStop(stopId, { lat, lng });
      try {
        const place = await reverseGeocodeAddress(lat, lng);
        patchFinishStop(stopId, {
          address: place?.address || "",
        });
        toast.success(place?.address ? "Endereço preenchido pelo GPS" : "Localização capturada");
      } catch {
        patchFinishStop(stopId, { address: "" });
        toast.message("Localização capturada (endereço indisponível)");
      }
    } catch (err) {
      toast.error(
        isGeolocationError(err)
          ? geolocationErrorMessage(err)
          : "GPS indisponível neste dispositivo",
      );
    } finally {
      setFinishGeo(null);
    }
  }

  async function deliverWithGps(delivery: Delivery) {
    if (finishGeo !== null || updateDelivery.isPending) return;
    setFinishGeo(`quick-${delivery.id}`);
    try {
      const point = await getCurrentPosition({
        enableHighAccuracy: true,
        maximumAge: 0,
        timeout: 12000,
      });
      const at = new Date().toISOString();
      const started = delivery.started_at ?? delivery.occurred_at;
      if (Date.parse(started) > Date.parse(at))
        throw new Error("Confira o horário do dispositivo antes de concluir");
      const final = await resolveDeliveryLocation({
        ...newStop("entrega"),
        address: "",
        lat: point.lat,
        lng: point.lng,
        recorded_at: at,
      });
      setFinishing({ id: delivery.id, stops: [final] });
      await updateDelivery.mutateAsync({
        id: delivery.id,
        values: {
          status: "concluida",
          started_at: started,
          ended_at: at,
          duration_min: Math.max(0, Math.round((Date.parse(at) - Date.parse(started)) / 60000)),
          dropoff_address: final.address,
          stops: recordedStops([...historyStops(delivery), final]),
        },
      });
      setFinishing(null);
      toast.success("Entrega concluída com o ponto GPS. Quilometragem informada preservada.");
    } catch (error) {
      toast.error(
        isGeolocationError(error)
          ? geolocationErrorMessage(error)
          : error instanceof Error
            ? error.message
            : "Não foi possível concluir a entrega",
      );
    } finally {
      setFinishGeo(null);
    }
  }

  return (
    <SectionCard
      title="Histórico de entregas"
      description={`${history.data?.pages[0]?.total ?? data.length} corridas no período · ${Math.min(visible, data.length)} exibidas`}
    >
      <div className="mb-3 flex flex-wrap gap-1">
        {(
          [
            ["hoje", "Hoje"],
            ["7d", "7 dias"],
            ["mes", "Mês atual"],
            ["tudo", "Tudo"],
          ] as const
        ).map(([k, label]) => (
          <Button
            key={k}
            type="button"
            size="sm"
            variant={histRange === k ? "default" : "outline"}
            onClick={() => setHistRange(k)}
          >
            {label}
          </Button>
        ))}
      </div>
      {history.isPending ? (
        <p role="status">
          {history.fetchStatus === "paused"
            ? "Aguardando conexão para carregar este período."
            : "Carregando entregas…"}
        </p>
      ) : history.isError && !data.length ? null : data.length ? (
        <ul className="divide-y divide-border">
          {data.slice(0, visible).map((d) => {
            const raw = historyStops(d);
            const status = d.status ?? "concluida";
            const pickupCount = raw.filter((stop) => stop.kind === "coleta").length;
            const deliveryCount = raw.filter((stop) => stop.kind === "entrega").length;
            const nav = navigationUrl(
              raw.length
                ? raw
                : [
                    {
                      address: d.dropoff_address ?? "",
                      lat: d.lat != null ? Number(d.lat) : null,
                      lng: d.lng != null ? Number(d.lng) : null,
                    },
                  ],
            );
            return (
              <li key={d.id} className="py-3">
                <div className="flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">
                      {d.app_name} · {brl(Number(d.earnings) + Number(d.tip))}
                      {status === "em_rota" ? (
                        <span className="ml-2 rounded bg-warning/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-warning-foreground">
                          Em rota
                        </span>
                      ) : null}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {dateTimeLabel(d.occurred_at)} · {paymentMethodLabel(d.payment_method)} ·{" "}
                      {num(Number(d.distance_km))} km · {minutesLabel(deliveryMinutes(d))} em
                      entrega · {minutesLabel(Number(d.idle_min))} parado
                    </p>
                    {status === "em_rota" && (
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <Button
                          type="button"
                          className="min-h-11"
                          disabled={
                            finishGeo !== null ||
                            updateDelivery.isPending ||
                            Boolean(finishing && finishing.id !== d.id)
                          }
                          onClick={() => void deliverWithGps(d)}
                        >
                          Entrega concluída (GPS)
                        </Button>
                        <span className="text-xs text-muted-foreground">
                          Conclui com GPS e mantém os km informados.
                        </span>
                      </div>
                    )}

                    {d.started_at ? (
                      <p className="mt-1 text-xs text-muted-foreground">
                        Início: {dateTimeLabel(d.started_at)} · Término:{" "}
                        {d.ended_at ? dateTimeLabel(d.ended_at) : "Em andamento"}
                      </p>
                    ) : null}
                  </div>
                  {nav ? (
                    <Button asChild variant="ghost" size="icon" aria-label="Abrir no Google Maps">
                      <MapsNavigationLink href={nav}>
                        <Navigation className="size-4" />
                      </MapsNavigationLink>
                    </Button>
                  ) : null}
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Excluir"
                    onClick={() => remove.mutate(d.id)}
                  >
                    <Trash2 className="size-4 text-destructive" />
                  </Button>
                </div>

                <div className="mt-3 rounded-md border border-border bg-muted/20 p-3">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <p className="text-xs font-semibold text-foreground">
                      Percurso completo · {raw.length} ponto{raw.length === 1 ? "" : "s"}
                    </p>
                    {raw.length ? (
                      <p className="text-[11px] text-muted-foreground">
                        {pickupCount} coleta{pickupCount === 1 ? "" : "s"} · {deliveryCount} entrega
                        {deliveryCount === 1 ? "" : "s"}
                      </p>
                    ) : null}
                  </div>
                  {raw.length ? (
                    <ol className="space-y-0">
                      {raw.map((stop, index) => (
                        <li
                          key={`${d.id}-${index}-${stop.recorded_at ?? stop.address}`}
                          className="relative flex gap-3 pb-3 last:pb-0"
                        >
                          {index < raw.length - 1 ? (
                            <span
                              aria-hidden="true"
                              className="absolute left-[11px] top-6 h-[calc(100%-1.25rem)] w-px bg-border"
                            />
                          ) : null}
                          <span className="relative z-10 flex size-6 shrink-0 items-center justify-center rounded-full border border-primary/30 bg-background text-[10px] font-semibold text-primary">
                            {index + 1}
                          </span>
                          <div className="min-w-0 flex-1 pt-0.5">
                            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                              <span className="text-xs font-semibold capitalize text-foreground">
                                {stop.kind === "coleta" ? "Coleta" : "Entrega"}
                              </span>
                              {stop.recorded_at ? (
                                <span className="text-[11px] text-muted-foreground">
                                  {dateTimeLabel(stop.recorded_at)}
                                </span>
                              ) : null}
                            </div>
                            <p className="break-words text-xs text-muted-foreground">
                              {<DeliveryStopAddress stop={stop} />}
                            </p>
                          </div>
                        </li>
                      ))}
                    </ol>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      Os pontos não foram informados neste registro.
                    </p>
                  )}
                </div>

                {status === "em_rota" && (
                  <div className="mt-3 flex flex-wrap gap-2" aria-label="Pontos da entrega em rota">
                    <Button
                      type="button"
                      variant="outline"
                      className="min-h-11"
                      disabled={
                        updateDelivery.isPending || Boolean(finishing && finishing.id !== d.id)
                      }
                      onClick={() =>
                        setFinishing((current) => {
                          if (current?.id !== d.id)
                            return { id: d.id, stops: [newStop("entrega"), newStop("entrega")] };
                          const stops = [...current.stops];
                          stops.splice(Math.max(0, stops.length - 1), 0, newStop("entrega"));
                          return { ...current, stops };
                        })
                      }
                    >
                      <Plus className="mr-1 size-4" />
                      Adicionar ponto adicional
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      className="min-h-11"
                      disabled={
                        updateDelivery.isPending || Boolean(finishing && finishing.id !== d.id)
                      }
                      onClick={() =>
                        setFinishing((current) =>
                          current?.id === d.id
                            ? current
                            : { id: d.id, stops: [newStop("entrega")] },
                        )
                      }
                    >
                      <MapPin className="mr-1 size-4" />
                      Editar paradas
                    </Button>
                  </div>
                )}
                {status === "em_rota" ? (
                  finishing?.id === d.id ? (
                    <div className="mt-2 space-y-2 rounded-md border border-border p-2">
                      <p className="text-xs font-medium text-muted-foreground">
                        Pontos restantes da rota
                      </p>
                      {finishing.stops.map((s, i) => (
                        <div key={s.id} className="space-y-1">
                          <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            <span className="font-medium text-foreground">
                              {raw.length + i + 1}.{" "}
                              {i === finishing.stops.length - 1
                                ? "Ponto final da entrega"
                                : "Ponto adicional"}
                            </span>
                            <select
                              value={s.kind}
                              onChange={(e) =>
                                patchFinishStop(s.id, {
                                  kind: e.target.value as Stop["kind"],
                                })
                              }
                              className="h-7 rounded border border-input bg-background px-2 text-xs"
                              aria-label={`Tipo do ponto ${i + 1}`}
                            >
                              <option value="coleta">Coleta</option>
                              <option value="entrega">Entrega</option>
                            </select>
                            {finishing.stops.length > 1 ? (
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="ml-auto size-7"
                                aria-label={`Remover ponto ${i + 1}`}
                                onClick={() =>
                                  setFinishing((f) =>
                                    f ? { ...f, stops: f.stops.filter((x) => x.id !== s.id) } : f,
                                  )
                                }
                              >
                                <X className="size-3.5" />
                              </Button>
                            ) : null}
                          </div>
                          <div className="flex min-w-0 gap-2">
                            <Input
                              aria-label={
                                i === finishing.stops.length - 1
                                  ? "Endereço final da entrega em rota"
                                  : `Endereço adicional ${i + 1}`
                              }
                              value={s.address}
                              onChange={(e) =>
                                patchFinishStop(s.id, {
                                  address: e.target.value,
                                  lat: null,
                                  lng: null,
                                })
                              }
                              placeholder={
                                s.kind === "coleta" ? "Nova coleta" : "Endereço de entrega"
                              }
                              className="min-w-0 flex-1"
                            />
                            <Button
                              type="button"
                              size="icon"
                              variant="outline"
                              aria-label={`Usar GPS no ponto ${i + 1}`}
                              disabled={finishGeo !== null}
                              onClick={() => captureFinishGps(s.id)}
                            >
                              <MapPin className="size-4" />
                            </Button>
                          </div>
                          {finishGeo === s.id ? (
                            <p className="text-xs text-muted-foreground">Buscando localização…</p>
                          ) : s.lat != null && s.lng != null ? (
                            <p className="text-xs text-muted-foreground">
                              {s.lat.toFixed(4)}, {s.lng.toFixed(4)}
                            </p>
                          ) : null}
                        </div>
                      ))}

                      <div className="flex gap-2">
                        <Button
                          type="button"
                          size="sm"
                          disabled={
                            !(
                              finishing.stops.at(-1)?.kind === "entrega" &&
                              (finishing.stops.at(-1)?.address.trim() ||
                                finishing.stops.at(-1)?.lat != null)
                            ) || updateDelivery.isPending
                          }
                          onClick={async () => {
                            const filled = recordedStops(
                              finishing.stops
                                .filter((s) => s.address.trim())
                                .map((s) => ({
                                  kind: s.kind,
                                  address: s.address.trim(),
                                  lat: s.lat,
                                  lng: s.lng,
                                })),
                            );
                            const last = filled[filled.length - 1];
                            try {
                              const allPts = [...raw, ...filled];
                              let routed: typeof allPts = allPts;
                              const extra: {
                                distance_km?: number;
                                duration_min?: number;
                              } = {};
                              const totals = await routeTotals(allPts);
                              if (totals) {
                                routed = totals.pts as typeof allPts;
                                extra.distance_km = totals.distanceKm;
                                extra.duration_min = d.started_at
                                  ? Math.round((Date.now() - Date.parse(d.started_at)) / 60000)
                                  : totals.durationMin;
                              } else {
                                toast.error(
                                  "Não foi possível calcular a distância desta entrega — verifique se os pontos têm endereço ou GPS preenchido e tente novamente.",
                                );
                              }
                              await updateDelivery.mutateAsync({
                                id: d.id,
                                values: {
                                  dropoff_address: last?.address ?? "",
                                  status: "concluida",
                                  started_at: d.started_at ?? d.occurred_at,
                                  ended_at: new Date().toISOString(),
                                  estimated_duration_min:
                                    totals?.durationMin ?? d.estimated_duration_min ?? null,
                                  stops: routed,
                                  ...extra,
                                },
                              });

                              setFinishing(null);
                              if (totals?.approximate) {
                                toast.message(
                                  `Rota concluída — distância aproximada (linha reta), o serviço de rota por ruas estava indisponível. ${num(totals.distanceKm)} km`,
                                );
                              } else {
                                toast.success("Rota concluída");
                              }
                            } catch {
                              toast.error("Erro ao salvar a rota");
                            }
                          }}
                        >
                          Entrega concluída
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          disabled={
                            !finishing.stops.some((s) => s.address.trim()) ||
                            updateDelivery.isPending
                          }
                          onClick={async () => {
                            try {
                              const saved = await persistFinishStops(d.id, raw, finishing.stops);
                              if (saved) {
                                setFinishing({ id: d.id, stops: [newStop("entrega")] });
                                toast.success("Pontos salvos — entrega segue em rota");
                              }
                            } catch {
                              toast.error("Erro ao salvar os pontos");
                            }
                          }}
                        >
                          Salvar pontos
                        </Button>

                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => setFinishing(null)}
                        >
                          Cancelar
                        </Button>
                      </div>
                    </div>
                  ) : null
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : (
        <EmptyState>Nenhuma entrega registrada neste período.</EmptyState>
      )}
      {history.isError && (
        <p role="alert" className="mt-3 text-sm text-destructive">
          Não foi possível carregar o histórico.{" "}
          <Button variant="outline" size="sm" onClick={() => void history.refetch()}>
            Tentar novamente
          </Button>
        </p>
      )}
      {(data.length > visible || history.hasNextPage) && (
        <Button
          className="mt-3 w-full min-h-11"
          variant="outline"
          disabled={history.isFetchingNextPage || history.fetchStatus === "paused"}
          onClick={async () => {
            if (visible >= data.length) {
              const result = await history.fetchNextPage();
              if (result.isError) return;
            }
            setVisible((value) => value + 20);
          }}
        >
          {history.isFetchingNextPage ? "Carregando…" : "Carregar mais 20"}
        </Button>
      )}
    </SectionCard>
  );
});
