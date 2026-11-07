import {
  deliveryFormDraft,
  deliveryStopsDraft,
  deliveryModeDraft,
  deliveryBaselineDraft,
  deliveryStartedDraft,
} from "@/lib/delivery-draft";
import { DeliveryOcr } from "./DeliveryOcr";
import type { DeliveryScan } from "@/lib/delivery-scan";
import { DeliveryQuickForm } from "./DeliveryQuickForm";
import {
  deliveryActiveMinutes,
  deliveryBaseline,
  deliveryGpsSuggestion,
  deliveryMoney,
  frequentDeliveryValues,
  type DeliveryBaseline,
} from "@/lib/delivery-entry";
import { memo, useCallback, useEffect, useMemo, useRef, useState, useId } from "react";

import { GripVertical, MapPin, Plus, Route as RouteIcon, X } from "lucide-react";
import { toast } from "sonner";

import { SectionCard } from "@/components/ui-kit";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  useApps,
  useInsert,
  useInsertApp,
  useProfile,
  useUpdateApp,
  useRecentDeliveryValues,
} from "@/lib/data";
import type { PaymentMethod } from "@/lib/data";

import { brl, dateTimeLabel, minutesLabel, num } from "@/lib/format";

import {
  fetchRouteWithFallback,
  geocodeAddress,
  geolocationErrorMessage,
  getCurrentPosition,
  isGeolocationError,
  navigationUrl,
  newStop,
  reverseGeocodeAddress,
  type RouteResult,
  type Stop,
} from "@/lib/geo";
import { usePersistentState } from "@/lib/persistent-state";

import { recordedStops } from "@/lib/delivery-records";

import { DeliveryRoutePreview } from "./DeliveryRoutePreview";
import type { TripState } from "@/lib/trip-tracker";
function dec(v: string | number | null | undefined): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (!v) return 0;
  const cleaned = String(v)
    .replace(/\s/g, "")
    .replace(/[^\d,.-]/g, "")
    .replace(/\.(?=\d{3}\b)/g, "")
    .replace(",", ".");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}

export const DeliveryEntry = memo(function DeliveryEntry({ trip }: { trip: TripState }) {
  const apps = useApps();
  const recent = useRecentDeliveryValues();
  const [mode, setMode] = usePersistentState<"quick" | "full">(
    "entregas.entry-mode",
    "quick",
    (value) => deliveryModeDraft.parse(value),
  );
  const [baseline, setBaseline] = usePersistentState<DeliveryBaseline | null>(
    "entregas.gps-baseline",
    null,
    (value) => deliveryBaselineDraft.parse(value),
  );
  const submitting = useRef(false);
  const routeVersion = useRef(0);
  const currentStopsKey = useRef("");
  const appliedStopsKey = useRef("");
  const manualMetrics = useRef(0);

  const profile = useProfile();
  const insert = useInsert("deliveries", "deliveries");
  const insertApp = useInsertApp();
  const updateApp = useUpdateApp();
  const [geoTarget, setGeoTarget] = useState<string | null>(null);
  const [accuracy, setAccuracy] = useState<number | null>(null);
  const [addingApp, setAddingApp] = useState(false);
  const [newAppName, setNewAppName] = useState("");
  const [newAppFee, setNewAppFee] = useState("");
  const [stops, setStops] = usePersistentState<Stop[]>(
    "entregas.stops",
    [newStop("coleta"), newStop("entrega")],
    (value) => deliveryStopsDraft.parse(value),
  );
  const [route, setRoute] = useState<RouteResult | null>(null);
  const [showRoute, setShowRoute] = useState(false);
  const [routing, setRouting] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [deliveryStartedAt, setDeliveryStartedAt] = usePersistentState<string | null>(
    "entregas.started-at",
    null,
    (value) => deliveryStartedDraft.parse(value),
  );

  const [form, setForm] = usePersistentState(
    "entregas.form",
    {
      app_name: "",
      earnings: "",
      fee_percent: "",
      fee_amount: "",
      tip: "",
      payment_method: "credito" as PaymentMethod,
      distance_km: "",
      duration_min: "",
      idle_min: "",
    },
    (value) => deliveryFormDraft.parse(value),
  );

  useEffect(() => setMounted(true), []);
  const refetchRecent = recent.refetch;
  useEffect(() => {
    if (trip.active && trip.journeyId) void refetchRecent();
  }, [trip.active, trip.journeyId, refetchRecent]);
  const initialBaseline =
    trip.active &&
    trip.journeyId &&
    trip.startedAt &&
    recent.isSuccess &&
    !recent.isFetching &&
    recent.dataUpdatedAt >= Date.parse(trip.startedAt) &&
    !(recent.data ?? []).some(
      (row) => Date.parse(row.ended_at ?? row.occurred_at) >= Date.parse(trip.startedAt!),
    )
      ? { journeyId: trip.journeyId, distanceKm: 0, at: trip.startedAt }
      : null;
  const effectiveBaseline = baseline?.journeyId === trip.journeyId ? baseline : initialBaseline;
  const suggestion = deliveryGpsSuggestion(trip, effectiveBaseline);
  const frequent = useMemo(
    () => frequentDeliveryValues(recent.data ?? [], form.app_name),
    [recent.data, form.app_name],
  );
  function beginMeasurement() {
    const at = new Date().toISOString();
    setDeliveryStartedAt(at);
    setBaseline(deliveryBaseline(trip, at));
  }
  function applyGpsSuggestion() {
    const next = deliveryGpsSuggestion(trip, effectiveBaseline);
    if (!next) return;
    manualMetrics.current++;
    setForm((value) => ({
      ...value,
      distance_km: String(next.distanceKm),
      duration_min: String(next.durationMin),
    }));
  }

  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) =>
    setForm((f) => ({ ...f, [k]: v }));
  const patchStop = (id: string, values: Partial<Stop>) =>
    setStops((s) =>
      s.map((st) =>
        st.id === id
          ? {
              ...st,
              ...values,
              ...("address" in values && !("recorded_at" in values)
                ? { recorded_at: undefined }
                : {}),
            }
          : st,
      ),
    );

  const selectedApp = (apps.data ?? []).find((a) => a.name === form.app_name);
  const gross = dec(form.earnings);
  const feePct = Math.min(Math.max(dec(form.fee_percent), 0), 100);
  const feeValue = (gross * feePct) / 100;
  const net = gross - feeValue;

  const round2 = (v: number) => Math.round(v * 100) / 100;

  function setFeeAmount(v: string) {
    const amount = Math.min(Math.max(dec(v), 0), gross || Number.POSITIVE_INFINITY);
    const pct = gross > 0 ? round2((amount / gross) * 100) : 0;
    setForm((f) => ({ ...f, fee_amount: v, fee_percent: gross > 0 ? String(pct) : f.fee_percent }));
  }

  function setFeePercent(v: string) {
    const pct = Math.min(Math.max(dec(v), 0), 100);
    setForm((f) => ({ ...f, fee_percent: v, fee_amount: String(round2((gross * pct) / 100)) }));
  }

  function setGross(v: string) {
    const g = dec(v);
    setForm((f) => ({
      ...f,
      earnings: v,
      fee_amount: String(round2((g * Math.min(Math.max(dec(f.fee_percent), 0), 100)) / 100)),
    }));
  }

  function selectApp(name: string) {
    const app = (apps.data ?? []).find((a) => a.name === name);
    const pct = Number(app?.fee_percent ?? 0);
    setForm((f) => ({
      ...f,
      app_name: name,
      fee_percent: String(pct),
      fee_amount: String(round2((dec(f.earnings) * pct) / 100)),
    }));
  }

  async function captureGps(stopId: string) {
    setGeoTarget(stopId);
    try {
      const { lat, lng, accuracy: gpsAccuracy } = await getCurrentPosition();
      setAccuracy(gpsAccuracy);
      const capturedAt = new Date().toISOString();
      patchStop(stopId, { lat, lng, recorded_at: capturedAt });

      try {
        const place = await reverseGeocodeAddress(lat, lng);
        if (place?.address) {
          patchStop(stopId, { address: place.address, recorded_at: capturedAt });
          toast.success("Endereço preenchido pelo GPS");
        } else {
          toast.success("Localização capturada");
        }
      } catch {
        toast.message("Localização capturada (endereço indisponível)");
      }
    } catch (err) {
      toast.error(
        isGeolocationError(err)
          ? geolocationErrorMessage(err)
          : "GPS indisponível neste dispositivo",
      );
    } finally {
      setGeoTarget(null);
    }
  }

  async function previewRoute(automatic = false) {
    const version = ++routeVersion.current;
    const metricsVersion = manualMetrics.current;
    const originalKey = currentStopsKey.current;
    const filled = stops.filter((s) => s.address.trim() || (s.lat != null && s.lng != null));
    if (filled.length < 2) {
      toast.error("Informe pelo menos dois pontos para calcular a rota");
      return;
    }
    setRouting(true);
    try {
      const resolved: Stop[] = [];
      for (const s of filled) {
        if (s.lat != null && s.lng != null) {
          resolved.push(s);
          continue;
        }
        const hit = await geocodeAddress(s.address);
        if (!hit) {
          toast.error(`Não localizei o endereço: ${s.address}`);
          setRouting(false);
          return;
        }
        resolved.push({ ...s, ...hit });
      }
      const result = await fetchRouteWithFallback(
        resolved.map((s) => [s.lat!, s.lng!] as [number, number]),
      );
      if (!result) {
        toast.error(
          "Não foi possível calcular a distância agora — verifique sua conexão e tente de novo.",
        );
        return;
      }
      if (version !== routeVersion.current || originalKey !== currentStopsKey.current) return;
      const updatedStops = stops.map(
        (stop) => resolved.find((value) => value.id === stop.id) ?? stop,
      );
      appliedStopsKey.current = JSON.stringify(
        updatedStops.map(({ id, address, lat, lng }) => [id, address, lat, lng]),
      );
      setStops(updatedStops);
      setRoute(result);
      // Preenche a distância/tempo automaticamente — não depende mais de tocar em "Aplicar".
      if (!automatic || manualMetrics.current === metricsVersion)
        setForm((f) => ({
          ...f,
          distance_km: String(result.distanceKm),
          duration_min: String(result.durationMin),
        }));
      if (automatic) return;
      if (result.approximate) {
        toast.message(
          `Distância aproximada (linha reta): ${num(result.distanceKm)} km · rota por ruas indisponível agora`,
        );
      } else {
        toast.success(`Rota: ${num(result.distanceKm)} km · ${minutesLabel(result.durationMin)}`);
      }
    } catch {
      toast.error("Erro ao calcular a rota");
    } finally {
      if (version === routeVersion.current) setRouting(false);
    }
  }

  const applyRoute = useCallback(() => {
    if (!route) return;
    setForm((f) => ({
      ...f,
      distance_km: String(route.distanceKm),
      duration_min: String(route.durationMin),
    }));
    manualMetrics.current++;
    toast.success("Distância e tempo aplicados");
  }, [route, setForm]);

  // Recalcula a rota sozinho sempre que dois ou mais pontos têm coordenadas —
  // não é mais preciso tocar em "Ver rota" manualmente a cada parada.
  const stopsKey = JSON.stringify(
    stops.map(({ id, address, lat, lng }) => [id, address, lat, lng]),
  );
  currentStopsKey.current = stopsKey;
  useEffect(() => {
    routeVersion.current++;
    setRouting(false);
    if (appliedStopsKey.current === stopsKey) return;
    setRoute(null);
    if (mode !== "full" || stops.filter((stop) => stop.lat != null && stop.lng != null).length < 2)
      return;
    const timer = setTimeout(() => {
      void previewRoute(true);
    }, 600);
    return () => clearTimeout(timer);
    // Coordinates/addresses control requests; value typing does not trigger them.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stopsKey, mode]);
  useEffect(
    () => () => {
      routeVersion.current++;
    },
    [],
  );

  const applyLeg = useCallback(
    (index: number) => {
      const leg = route?.legs[index];
      if (!leg) return;
      setForm((f) => ({
        ...f,
        distance_km: String(leg.distanceKm),
        duration_min: String(leg.durationMin),
      }));
      manualMetrics.current++;
      toast.success(`Trecho ${index + 1} aplicado no formulário`);
    },
    [route, setForm],
  );

  async function save(finalized: boolean, overrideStops?: Stop[]) {
    if (submitting.current) return;
    const selectedStops = overrideStops ?? stops;
    const filled = selectedStops.filter(
      (s) => s.address.trim() || (s.lat != null && s.lng != null),
    );
    const first = filled.find((stop) => stop.kind === "coleta");
    const last = finalized ? [...filled].reverse().find((stop) => stop.kind === "entrega") : null;
    if (!form.app_name) {
      toast.error("Selecione o aplicativo da corrida");
      return;
    }
    if (gross <= 0) {
      toast.error("Informe o valor bruto da corrida");
      return;
    }
    submitting.current = true;
    try {
      const money = deliveryMoney(gross, feePct, dec(form.tip));
      if (dec(form.distance_km) < 0 || dec(form.duration_min) < 0 || dec(form.idle_min) < 0)
        throw new Error("Confira distância e tempos: não podem ser negativos");
      await insert.mutateAsync({
        app_name: form.app_name,
        ...money,
        occurred_at: new Date().toISOString(),
        payment_method: form.payment_method ?? "credito",
        distance_km: dec(form.distance_km),
        duration_min:
          finalized && deliveryStartedAt
            ? deliveryActiveMinutes(deliveryStartedAt, new Date().toISOString(), trip.pauses ?? [])
            : Math.round(dec(form.duration_min)),
        idle_min: Math.round(dec(form.idle_min)),
        pickup_address: first?.address || null,
        dropoff_address: finalized ? last?.address || null : null,
        lat: first?.lat ?? null,
        lng: first?.lng ?? null,
        status: finalized ? "concluida" : "em_rota",
        started_at: deliveryStartedAt ?? (finalized ? null : new Date().toISOString()),
        ended_at: finalized && deliveryStartedAt ? new Date().toISOString() : null,
        estimated_duration_min: route?.durationMin ?? null,
        stops: recordedStops(
          filled.map((s) => ({
            kind: s.kind,
            address: s.address,
            lat: s.lat,
            lng: s.lng,
            ...(s.recorded_at ? { recorded_at: s.recorded_at } : {}),
          })),
        ),
      });
      toast.success(
        finalized ? "Entrega registrada" : "Entrega salva em rota — defina o ponto final depois",
      );
      setForm((f) => ({
        ...f,
        earnings: "",
        fee_amount: "",
        tip: "",
        distance_km: "",
        duration_min: "",
        idle_min: "",
      }));
      setStops([newStop("coleta"), newStop("entrega")]);
      setDeliveryStartedAt(null);
      setBaseline(deliveryBaseline(trip));
      setRoute(null);
      setShowRoute(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Erro ao salvar a entrega");
    } finally {
      submitting.current = false;
    }
  }

  async function quickStop(kind: "coleta" | "entrega", finalize: boolean) {
    setGeoTarget("quick");
    try {
      const point = await getCurrentPosition({
        enableHighAccuracy: true,
        maximumAge: 0,
        timeout: 12000,
      });
      const captured = {
        ...newStop(kind),
        address: `${point.lat.toFixed(5)}, ${point.lng.toFixed(5)}`,
        lat: point.lat,
        lng: point.lng,
        recorded_at: new Date().toISOString(),
      };
      const nextStops = [
        ...stops.filter((stop) => stop.address.trim() || stop.lat != null),
        captured,
      ];
      setStops(nextStops);
      setAccuracy(point.accuracy);
      if (!deliveryStartedAt && !finalize) beginMeasurement();
      if (finalize) await save(true, nextStops);
      else toast.success("Chegada registrada pelo GPS");
    } catch (error) {
      toast.error(
        isGeolocationError(error)
          ? geolocationErrorMessage(error)
          : "Não foi possível capturar o GPS",
      );
    } finally {
      setGeoTarget(null);
    }
  }

  function applyOcr(result: DeliveryScan) {
    const known = (apps.data ?? []).find(
      (app) =>
        app.name.trim().toLocaleLowerCase("pt-BR") ===
        result.appName?.trim().toLocaleLowerCase("pt-BR"),
    );
    setForm((old) => {
      const gross = result.gross ?? dec(old.earnings);
      const fee = result.feePercent ?? Number(known?.fee_percent ?? dec(old.fee_percent));
      return {
        ...old,
        app_name: known?.name ?? result.appName ?? old.app_name,
        earnings: result.gross == null ? old.earnings : String(result.gross),
        tip: result.tip == null ? old.tip : String(result.tip),
        distance_km: result.distanceKm == null ? old.distance_km : String(result.distanceKm),
        duration_min: result.durationMin == null ? old.duration_min : String(result.durationMin),
        fee_percent: String(fee),
        fee_amount: String(Math.round(gross * fee) / 100),
      };
    });
    if (result.pickupAddress || result.dropoffAddress)
      setStops((old) => {
        const next = [...old];
        for (const [kind, address] of [
          ["coleta", result.pickupAddress],
          ["entrega", result.dropoffAddress],
        ] as const) {
          if (!address) continue;
          const index = next.findIndex((stop) => stop.kind === kind);
          const value = {
            ...(next[index] ?? newStop(kind)),
            address,
            lat: null,
            lng: null,
            recorded_at: undefined,
          };
          if (index < 0) next.push(value);
          else next[index] = value;
        }
        return next;
      });
    setMode("full");
    setShowRoute(Boolean(result.pickupAddress || result.dropoffAddress));
    toast.success("Dados preenchidos. Confira antes de confirmar a entrega.");
  }

  const filledStops = useMemo(
    () => stops.filter((s) => s.address.trim() || (s.lat != null && s.lng != null)),
    [stops],
  );
  const formNav = useMemo(() => navigationUrl(stops), [stops]);
  const lastStop = filledStops[filledStops.length - 1];
  const hasFinalPoint = filledStops.length >= 2 && !!lastStop && lastStop.kind === "entrega";
  const mapPoints = useMemo(
    () =>
      route?.points ??
      stops
        .filter((s) => s.lat != null && s.lng != null)
        .map((s) => [s.lat!, s.lng!] as [number, number]),
    [route, stops],
  );

  return (
    <div className="mt-4 grid min-w-0 gap-4 lg:grid-cols-[380px_minmax(0,1fr)] [&>*]:min-w-0">
      {" "}
      <SectionCard
        title="Nova entrega"
        description="Registro rápido ou completo, com os padrões do seu aplicativo"
      >
        <div className="mb-4 flex gap-2" role="group" aria-label="Modo de registro">
          <Button
            type="button"
            variant={mode === "quick" ? "default" : "outline"}
            className="min-h-11 flex-1"
            aria-pressed={mode === "quick"}
            onClick={() => setMode("quick")}
          >
            Rápido
          </Button>
          <Button
            type="button"
            variant={mode === "full" ? "default" : "outline"}
            className="min-h-11 flex-1"
            aria-pressed={mode === "full"}
            onClick={() => setMode("full")}
          >
            Completo
          </Button>
        </div>
        <DeliveryOcr apply={applyOcr} />
        <div className="space-y-2 rounded-md border border-border p-3">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <Label className="text-xs">Rota</Label>
              <p className="truncate text-xs text-muted-foreground">
                {filledStops.length
                  ? filledStops.map((s) => s.address || "ponto GPS").join(" → ")
                  : "Nenhum ponto informado"}
              </p>
            </div>
            <Button
              type="button"
              variant={showRoute ? "secondary" : "outline"}
              size="sm"
              onClick={() => setShowRoute((v) => !v)}
            >
              <RouteIcon className="mr-1 size-4" />
              {showRoute ? "Ocultar" : filledStops.length ? "Editar rota" : "Inserir rota"}
            </Button>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              className="min-h-11"
              onClick={() => {
                setStops((current) => {
                  const next = [...current];
                  let final = -1;
                  for (let index = next.length - 1; index >= 0; index--) {
                    if (next[index]?.kind === "entrega") {
                      final = index;
                      break;
                    }
                  }
                  next.splice(final < 0 ? next.length : final, 0, newStop("entrega"));
                  return next;
                });
                setShowRoute(true);
              }}
            >
              <Plus className="mr-1 size-4" />
              Adicionar ponto adicional
            </Button>
            <Button
              type="button"
              variant="outline"
              className="min-h-11"
              onClick={() => {
                setStops((current) =>
                  current.at(-1)?.kind === "entrega" ? current : [...current, newStop("entrega")],
                );
                setShowRoute(true);
              }}
            >
              Definir ponto final
            </Button>
          </div>
          {showRoute ? (
            <>
              {stops.map((s, i) => (
                <div key={s.id} className="space-y-1 rounded-md border border-border p-2">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <GripVertical className="size-3.5" />
                    <span className="font-medium text-foreground">
                      {i + 1}.{" "}
                      {i === stops.length - 1 && s.kind === "entrega"
                        ? "Ponto final da entrega"
                        : i === 0 && s.kind === "coleta"
                          ? "Coleta"
                          : "Ponto adicional"}
                    </span>
                    <select
                      value={s.kind}
                      onChange={(e) => patchStop(s.id, { kind: e.target.value as Stop["kind"] })}
                      className="h-7 rounded border border-input bg-background px-2 text-xs"
                      aria-label={`Tipo do ponto ${i + 1}`}
                    >
                      <option value="coleta">Coleta</option>
                      <option value="entrega">Entrega</option>
                    </select>
                    {stops.length > 2 ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="ml-auto size-7"
                        aria-label={`Remover ponto ${i + 1}`}
                        onClick={() => setStops((list2) => list2.filter((x) => x.id !== s.id))}
                      >
                        <X className="size-3.5" />
                      </Button>
                    ) : null}
                  </div>
                  <div className="flex min-w-0 gap-2">
                    <Input
                      aria-label={
                        i === stops.length - 1 && s.kind === "entrega"
                          ? "Endereço do ponto final"
                          : `Endereço do ponto ${i + 1}`
                      }
                      value={s.address}
                      onChange={(e) =>
                        patchStop(s.id, { address: e.target.value, lat: null, lng: null })
                      }
                      placeholder={
                        s.kind === "coleta" ? "Restaurante / loja" : "Endereço do cliente"
                      }
                      className="min-w-0 flex-1"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      aria-label={`Usar GPS no ponto ${i + 1}`}
                      onClick={() => captureGps(s.id)}
                      disabled={geoTarget !== null}
                    >
                      <MapPin className="size-4" />
                    </Button>
                  </div>
                  {geoTarget === s.id ? (
                    <p className="text-xs text-muted-foreground">Buscando localização…</p>
                  ) : s.lat != null && s.lng != null ? (
                    <p className="text-xs text-muted-foreground">
                      {s.lat.toFixed(4)}, {s.lng.toFixed(4)}
                      {accuracy ? ` · precisão ~${accuracy} m` : ""}
                    </p>
                  ) : null}
                </div>
              ))}
              <div className="flex min-w-0 gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  className="min-w-0 flex-1"
                  onClick={() => void previewRoute()}
                  disabled={routing}
                >
                  <RouteIcon className="mr-1 size-4" />
                  {routing ? "Calculando…" : "Ver rota"}
                </Button>
              </div>
            </>
          ) : null}
        </div>
        {mode === "quick" ? (
          <DeliveryQuickForm
            apps={apps.data ?? []}
            app={form.app_name}
            value={form.earnings}
            net={net + dec(form.tip)}
            fee={feePct}
            tip={dec(form.tip)}
            payment={form.payment_method}
            frequent={frequent}
            busy={insert.isPending || geoTarget !== null}
            select={selectApp}
            change={setGross}
            save={() => void save(true)}
          />
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void save(hasFinalPoint);
            }}
            className="space-y-3"
          >
            <div className="space-y-2">
              <Label htmlFor="app">Aplicativo</Label>
              {addingApp ? (
                <div className="space-y-2">
                  <div className="flex min-w-0 gap-2">
                    <Input
                      value={newAppName}
                      onChange={(e) => setNewAppName(e.target.value)}
                      placeholder="Nome do aplicativo"
                      className="min-w-0 flex-1"
                      autoFocus
                    />
                    <Button
                      type="button"
                      size="icon"
                      variant="outline"
                      aria-label="Cancelar"
                      onClick={() => {
                        setAddingApp(false);
                        setNewAppName("");
                        setNewAppFee("");
                      }}
                    >
                      <X className="size-4" />
                    </Button>
                    <Button
                      type="button"
                      size="icon"
                      aria-label="Salvar aplicativo"
                      disabled={!newAppName.trim() || insertApp.isPending}
                      onClick={async () => {
                        const name = newAppName.trim();
                        if (!name) return;
                        try {
                          const fee = Math.min(Math.max(dec(newAppFee), 0), 100);
                          await insertApp.mutateAsync({ name, fee_percent: fee });
                          setForm((f) => ({ ...f, app_name: name, fee_percent: String(fee) }));
                          setAddingApp(false);
                          setNewAppName("");
                          setNewAppFee("");
                          toast.success("Aplicativo cadastrado");
                        } catch {
                          toast.error("Erro ao cadastrar aplicativo");
                        }
                      }}
                    >
                      <Plus className="size-4" />
                    </Button>
                  </div>
                  <Input
                    inputMode="decimal"
                    value={newAppFee}
                    onChange={(e) => setNewAppFee(e.target.value)}
                    placeholder="Taxa do app (%) — ex: 15"
                  />
                </div>
              ) : (
                <div className="flex min-w-0 gap-2">
                  <select
                    id="app"
                    value={form.app_name}
                    onChange={(e) => selectApp(e.target.value)}
                    className="h-9 w-0 min-w-0 flex-1 rounded-md border border-input bg-background px-3 text-sm"
                  >
                    {form.app_name &&
                      !(apps.data ?? []).some((app) => app.name === form.app_name) && (
                        <option value={form.app_name}>{form.app_name} (não cadastrado)</option>
                      )}
                    <option value="" disabled>
                      Selecione...
                    </option>
                    {(apps.data ?? []).map((a) => (
                      <option key={a.id} value={a.name}>
                        {a.name}
                        {Number(a.fee_percent) > 0 ? ` · taxa ${num(Number(a.fee_percent))}%` : ""}
                      </option>
                    ))}
                  </select>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    aria-label="Cadastrar novo aplicativo"
                    onClick={() => setAddingApp(true)}
                  >
                    <Plus className="size-4" />
                  </Button>
                </div>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3 [&>*]:min-w-0">
              <Field label="Valor bruto (R$)" value={form.earnings} onChange={setGross} />
              <Field label="Taxa do app (R$)" value={form.fee_amount} onChange={setFeeAmount} />
              <Field label="Taxa do app (%)" value={form.fee_percent} onChange={setFeePercent} />
              <Field
                label="Gratificação do cliente (R$)"
                value={form.tip}
                onChange={(v) => set("tip", v)}
              />
              <div className="col-span-2 space-y-2">
                <Label htmlFor="payment-method">Forma de recebimento</Label>
                <select
                  id="payment-method"
                  value={form.payment_method ?? "credito"}
                  onChange={(e) => set("payment_method", e.target.value as PaymentMethod)}
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="credito">Crédito</option>
                  <option value="pix">Pix</option>
                  <option value="dinheiro">Dinheiro</option>
                </select>
              </div>
              <Field
                label="Distância (km)"
                value={form.distance_km}
                onChange={(v) => {
                  manualMetrics.current++;
                  set("distance_km", v);
                }}
              />
              <Field
                label="Duração informada/estimada (min)"
                value={form.duration_min}
                onChange={(v) => {
                  manualMetrics.current++;
                  set("duration_min", v);
                }}
              />
              <div className="col-span-2 flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={!!deliveryStartedAt}
                  onClick={beginMeasurement}
                >
                  Iniciar entrega
                </Button>
                {deliveryStartedAt ? (
                  <>
                    <span className="text-xs text-muted-foreground">
                      Início: {dateTimeLabel(deliveryStartedAt)}
                    </span>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      aria-label="Cancelar captura do tempo da entrega"
                      onClick={() => setDeliveryStartedAt(null)}
                    >
                      <X className="size-4" />
                    </Button>
                  </>
                ) : null}
              </div>
              <Field
                label="Tempo parado (min)"
                value={form.idle_min}
                onChange={(v) => set("idle_min", v)}
              />
            </div>
            <div className="rounded-md border border-border bg-muted/40 p-3 text-xs">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Taxa descontada ({num(feePct)}%)</span>
                <span>-{brl(feeValue)}</span>
              </div>
              <div className="mt-1 flex justify-between font-medium">
                <span>Ganho líquido</span>
                <span>{brl(net + dec(form.tip))}</span>
              </div>
              {selectedApp && Number(selectedApp.fee_percent) !== feePct ? (
                <Button
                  type="button"
                  variant="link"
                  size="sm"
                  className="mt-1 h-auto p-0 text-xs"
                  onClick={async () => {
                    try {
                      await updateApp.mutateAsync({
                        id: selectedApp.id,
                        values: { fee_percent: feePct },
                      });
                      toast.success(`Taxa padrão de ${selectedApp.name} atualizada`);
                    } catch {
                      toast.error("Erro ao salvar a taxa");
                    }
                  }}
                >
                  Salvar {num(feePct)}% como taxa padrão de {selectedApp.name}
                </Button>
              ) : null}
            </div>

            <Button type="submit" className="w-full" disabled={insert.isPending}>
              {insert.isPending ? "Salvando…" : "Confirmar entrega"}
            </Button>
            <p className="text-center text-xs text-muted-foreground">
              {hasFinalPoint
                ? "Será registrada como concluída."
                : "Sem ponto final: fica “Em rota” e você define o destino depois."}
            </p>
          </form>
        )}
        <div className="mt-4 space-y-2 border-t pt-3">
          <p className="text-xs text-muted-foreground">
            GPS opcional:{" "}
            {suggestion
              ? `${num(suggestion.distanceKm, 2)} km · ${suggestion.durationMin} min desde a marcação, excluindo pausas`
              : "Inicie uma medição com a jornada ativa para sugerir km e tempo sem misturar entregas."}
          </p>
          <p className="text-xs text-muted-foreground">
            No registro: {form.distance_km || "0"} km · {form.duration_min || "0"} min ·{" "}
            {form.idle_min || "0"} min parados
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              className="min-h-11"
              onClick={beginMeasurement}
              disabled={!!deliveryStartedAt}
            >
              Medir esta entrega
            </Button>
            <Button
              type="button"
              variant="outline"
              className="min-h-11"
              disabled={!suggestion}
              onClick={applyGpsSuggestion}
            >
              Usar sugestão GPS
            </Button>
            <Button
              type="button"
              variant="outline"
              className="min-h-11"
              disabled={geoTarget !== null || insert.isPending}
              onClick={() => void quickStop("coleta", false)}
            >
              Cheguei no restaurante
            </Button>
            <Button
              type="button"
              className="min-h-11"
              disabled={geoTarget !== null || insert.isPending || !form.app_name || gross <= 0}
              onClick={() => void quickStop("entrega", true)}
            >
              Entregue — salvar com GPS
            </Button>
          </div>
        </div>
      </SectionCard>
      {mode === "full" && (
        <DeliveryRoutePreview
          mounted={mounted}
          route={route}
          stops={stops}
          points={mapPoints}
          vehicle={profile.data?.vehicle}
          filledStops={filledStops}
          formNav={formNav}
          applyRoute={applyRoute}
          applyLeg={applyLeg}
        />
      )}
    </div>
  );
});
function Field({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const id = useId();
  return (
    <div className="space-y-2">
      <Label htmlFor={id} className="text-xs">
        {label}
      </Label>
      <Input
        id={id}
        inputMode="decimal"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="0"
      />
    </div>
  );
}
