import { createFileRoute } from "@tanstack/react-router";
import { Suspense, lazy, useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Brain,
  GripVertical,
  MapPin,
  Navigation,
  Plus,
  Route as RouteIcon,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { BrandSpinner } from "@/components/BrandLoader";

import { EmptyState, SectionCard, StatCard } from "@/components/ui-kit";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  useApps,
  useDeliveries,
  useInsert,
  useGoals,
  useInsertApp,
  useProfile,
  useRemove,
  useUpdate,
  useUpdateApp,
} from "@/lib/data";
import type { Delivery, DeliveryStop, PaymentMethod } from "@/lib/data";

import { brl, dateTimeLabel, minutesLabel, num, paymentMethodLabel } from "@/lib/format";
import { adaptiveDailyRevenueGoal } from "@/lib/metrics";
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
import { useChainedDistance } from "@/lib/chained-distance";

const RouteMap = lazy(() => import("@/components/RouteMap"));

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

type StoredStop = DeliveryStop;

function recordedStops(stops: Omit<StoredStop, "recorded_at">[]): StoredStop[] {
  const now = Date.now();
  return stops.map((stop, index) => ({
    ...stop,
    recorded_at: new Date(now + index).toISOString(),
  }));
}

/** Mantém registros antigos visíveis mesmo quando foram salvos antes do histórico de paradas. */
function historyStops(delivery: Delivery): StoredStop[] {
  if (Array.isArray(delivery.stops) && delivery.stops.length) return delivery.stops;

  const legacy: StoredStop[] = [];
  if (delivery.pickup_address || (delivery.lat != null && delivery.lng != null)) {
    legacy.push({
      kind: "coleta",
      address: delivery.pickup_address ?? "",
      lat: delivery.lat != null ? Number(delivery.lat) : null,
      lng: delivery.lng != null ? Number(delivery.lng) : null,
      recorded_at: delivery.occurred_at,
    });
  }
  if (delivery.dropoff_address) {
    legacy.push({
      kind: "entrega",
      address: delivery.dropoff_address,
      lat: null,
      lng: null,
    });
  }
  return legacy;
}

function stopLocation(stop: StoredStop) {
  if (stop.address?.trim()) return stop.address.trim();
  if (stop.lat != null && stop.lng != null) {
    return `${Number(stop.lat).toFixed(5)}, ${Number(stop.lng).toFixed(5)}`;
  }
  return "Local não informado";
}

type DeliveryInsight = {
  title: string;
  description: string;
  action: string;
};

/** Aceita vírgula decimal (pt-BR) e separador de milhar. */
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

function Entregas() {
  const list = useDeliveries();
  const apps = useApps();
  const goals = useGoals();
  const profile = useProfile();
  const insert = useInsert("deliveries", "deliveries");
  const insertApp = useInsertApp();
  const updateApp = useUpdateApp();
  const updateDelivery = useUpdate<Record<string, unknown>>("deliveries", "deliveries");
  const remove = useRemove("deliveries", "deliveries");
  const [geoTarget, setGeoTarget] = useState<string | null>(null);
  const [accuracy, setAccuracy] = useState<number | null>(null);
  const [addingApp, setAddingApp] = useState(false);
  const [newAppName, setNewAppName] = useState("");
  const [newAppFee, setNewAppFee] = useState("");
  const [stops, setStops] = usePersistentState<Stop[]>("entregas.stops", [
    newStop("coleta"),
    newStop("entrega"),
  ]);
  const [route, setRoute] = useState<RouteResult | null>(null);
  const [showRoute, setShowRoute] = useState(false);
  const [routing, setRouting] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [finishing, setFinishing] = usePersistentState<{
    id: string;
    stops: Stop[];
  } | null>("entregas.finishing", null);
  const [finishGeo, setFinishGeo] = useState<string | null>(null);
  const [histRange, setHistRange] = useState<"hoje" | "7d" | "30d" | "tudo">("hoje");

  const [form, setForm] = usePersistentState("entregas.form", {
    app_name: "",
    earnings: "",
    fee_percent: "",
    fee_amount: "",
    tip: "",
    payment_method: "credito" as PaymentMethod,
    distance_km: "",
    duration_min: "",
    idle_min: "",
  });

  useEffect(() => setMounted(true), []);

  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) =>
    setForm((f) => ({ ...f, [k]: v }));
  const patchStop = (id: string, values: Partial<Stop>) =>
    setStops((s) => s.map((st) => (st.id === id ? { ...st, ...values } : st)));

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
      patchStop(stopId, { lat, lng });

      try {
        const place = await reverseGeocodeAddress(lat, lng);
        if (place?.address) {
          patchStop(stopId, { address: place.address });
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

  const patchFinishStop = (stopId: string, values: Partial<Stop>) =>
    setFinishing((f) =>
      f ? { ...f, stops: f.stops.map((s) => (s.id === stopId ? { ...s, ...values } : s)) } : f,
    );

  /** Grava os pontos já informados na entrega em rota (sem concluir). */
  async function persistFinishStops(id: string, raw: StoredStop[], list2: Stop[]) {
    const filled = recordedStops(
      list2
        .filter((s) => s.address.trim() || (s.lat != null && s.lng != null))
        .map((s) => ({ kind: s.kind, address: s.address.trim(), lat: s.lat, lng: s.lng })),
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
          address: place?.address || `${lat.toFixed(5)}, ${lng.toFixed(5)}`,
        });
        toast.success(place?.address ? "Endereço preenchido pelo GPS" : "Localização capturada");
      } catch {
        patchFinishStop(stopId, { address: `${lat.toFixed(5)}, ${lng.toFixed(5)}` });
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

  /** Resolve endereços e devolve distância/tempo totais encadeados (ponto a ponto). */
  async function routeTotals(
    pts: { address: string; lat: number | null; lng: number | null }[],
  ): Promise<{
    distanceKm: number;
    durationMin: number;
    pts: typeof pts;
    approximate: boolean;
  } | null> {
    const resolved: typeof pts = [];
    for (const s of pts) {
      if (s.lat != null && s.lng != null) {
        resolved.push(s);
        continue;
      }
      if (!s.address.trim()) continue;
      const hit = await geocodeAddress(s.address);
      resolved.push(hit ? { ...s, ...hit } : s);
    }
    const coords = resolved
      .filter((s) => s.lat != null && s.lng != null)
      .map((s) => [s.lat!, s.lng!] as [number, number]);
    if (coords.length < 2) return null;
    const r = await fetchRouteWithFallback(coords);
    if (!r) return null;
    return {
      distanceKm: r.distanceKm,
      durationMin: r.durationMin,
      pts: resolved,
      approximate: !!r.approximate,
    };
  }

  async function previewRoute() {
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
        patchStop(s.id, hit);
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
      setRoute(result);
      // Preenche a distância/tempo automaticamente — não depende mais de tocar em "Aplicar".
      setForm((f) => ({
        ...f,
        distance_km: String(result.distanceKm),
        duration_min: String(result.durationMin),
      }));
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
      setRouting(false);
    }
  }

  function applyRoute() {
    if (!route) return;
    setForm((f) => ({
      ...f,
      distance_km: String(route.distanceKm),
      duration_min: String(route.durationMin),
    }));
    toast.success("Distância e tempo aplicados");
  }

  // Recalcula a rota sozinho sempre que dois ou mais pontos têm coordenadas —
  // não é mais preciso tocar em "Ver rota" manualmente a cada parada.
  const coordsKey = stops
    .filter((s) => s.lat != null && s.lng != null)
    .map((s) => `${s.lat},${s.lng}`)
    .join("|");

  useEffect(() => {
    const withCoords = stops.filter((s) => s.lat != null && s.lng != null);
    if (withCoords.length < 2) return;
    const timer = setTimeout(() => {
      void previewRoute();
    }, 500);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coordsKey]);

  function applyLeg(index: number) {
    const leg = route?.legs[index];
    if (!leg) return;
    setForm((f) => ({
      ...f,
      distance_km: String(leg.distanceKm),
      duration_min: String(leg.durationMin),
    }));
    toast.success(`Trecho ${index + 1} aplicado no formulário`);
  }

  async function save(finalized: boolean) {
    const filled = stops.filter((s) => s.address.trim() || (s.lat != null && s.lng != null));
    const first = filled[0];
    const last = finalized ? filled[filled.length - 1] : null;
    if (!form.app_name) {
      toast.error("Selecione o aplicativo da corrida");
      return;
    }
    if (gross <= 0) {
      toast.error("Informe o valor bruto da corrida");
      return;
    }
    try {
      await insert.mutateAsync({
        app_name: form.app_name,
        gross_earnings: gross,
        fee_percent: feePct,
        earnings: Number(net.toFixed(2)),
        tip: dec(form.tip),
        payment_method: form.payment_method ?? "credito",
        distance_km: dec(form.distance_km),
        duration_min: Math.round(dec(form.duration_min)),
        idle_min: Math.round(dec(form.idle_min)),
        pickup_address: first?.address || null,
        dropoff_address: finalized ? last?.address || null : null,
        lat: first?.lat ?? null,
        lng: first?.lng ?? null,
        status: finalized ? "concluida" : "em_rota",
        stops: recordedStops(
          filled.map((s) => ({
            kind: s.kind,
            address: s.address,
            lat: s.lat,
            lng: s.lng,
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
        payment_method: "credito",
        distance_km: "",
        duration_min: "",
        idle_min: "",
      }));
      setStops([newStop("coleta"), newStop("entrega")]);
      setRoute(null);
      setShowRoute(false);
    } catch {
      toast.error("Erro ao salvar a entrega");
    }
  }

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date();
  todayEnd.setHours(23, 59, 59, 999);
  const rangeStart =
    histRange === "hoje"
      ? todayStart.getTime()
      : histRange === "7d"
        ? todayEnd.getTime() - 7 * 86400000
        : histRange === "30d"
          ? todayEnd.getTime() - 30 * 86400000
          : 0;
  const all = list.data ?? [];
  const today = all.filter((d) => {
    const t = new Date(d.occurred_at).getTime();
    return t >= todayStart.getTime() && t <= todayEnd.getTime();
  });
  const data = all.filter((d) => new Date(d.occurred_at).getTime() >= rangeStart);

  const total = today.reduce((s, d) => s + Number(d.earnings) + Number(d.tip), 0);
  const deliveryKmSum = today.reduce((s, d) => s + Number(d.distance_km), 0);
  const idle = today.reduce((s, d) => s + Number(d.idle_min), 0);
  const dailyGoal = adaptiveDailyRevenueGoal({
    deliveries: all,
    goals: goals.data ?? [],
    profile: profile.data,
  }).target;
  const goalRemaining = Math.max(0, dailyGoal - total);
  const deliveryIntel = buildDeliveryInsights({
    all,
    today,
    goalRemaining,
    dailyGoal,
  });

  const emRota = today.filter(
    (d) => (d as unknown as { status?: string }).status === "em_rota",
  ).length;

  // "Distância total" = trajeto encadeado do dia: primeira coleta confirmada/salva
  // até o último ponto informado, incluindo coletas, destinos finais e adicionais.
  const { chainKm, km } = useChainedDistance(today);

  const formNav = navigationUrl(stops);
  const filledStops = stops.filter((s) => s.address.trim() || (s.lat != null && s.lng != null));
  const lastStop = filledStops[filledStops.length - 1];
  const hasFinalPoint = filledStops.length >= 2 && !!lastStop && lastStop.kind === "entrega";

  return (
    <AppShell title="Entregas" subtitle="Registro de corridas, rota no mapa e navegação">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatCard label="Total recebido" value={brl(total)} tone="primary" />
        <StatCard
          label="Pontos encadeados"
          value={`${num(km)} km`}
          hint={
            (chainKm != null ? "Pontos do dia encadeados" : "Soma das entregas do dia") +
            (today.length
              ? ` · ${num(deliveryKmSum)} km registrados em ${today.length} entrega${today.length === 1 ? "" : "s"}`
              : "") +
            (emRota ? ` · ${emRota} em andamento` : "")
          }
          tone="primary"
        />

        <StatCard label="Tempo parado" value={minutesLabel(idle)} tone="warning" />
      </div>

      {deliveryIntel ? (
        <SectionCard
          title="Inteligência de entregas"
          description="Sugestões automáticas após a primeira entrega do dia"
          className="mt-4"
        >
          {today.length ? (
            <div className="grid gap-3 md:grid-cols-3">
              {deliveryIntel.map((insight) => (
                <div
                  key={insight.title}
                  className="rounded-md border border-border bg-muted/30 p-3"
                >
                  <div className="mb-2 flex items-center gap-2 text-sm font-medium">
                    <Brain className="size-4 text-primary" />
                    {insight.title}
                  </div>
                  <p className="text-xs text-muted-foreground">{insight.description}</p>
                  <p className="mt-2 text-xs font-medium text-foreground">{insight.action}</p>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState>
              Conclua a primeira entrega do dia para ativar recomendações baseadas no histórico.
            </EmptyState>
          )}
        </SectionCard>
      ) : null}

      <div className="mt-4 grid min-w-0 gap-4 lg:grid-cols-[380px_minmax(0,1fr)] [&>*]:min-w-0">
        <SectionCard title="Nova entrega" description="Preencha após finalizar a corrida">
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
              <Field label="Gorjeta (R$)" value={form.tip} onChange={(v) => set("tip", v)} />
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
                onChange={(v) => set("distance_km", v)}
              />
              <Field
                label="Duração (min)"
                value={form.duration_min}
                onChange={(v) => set("duration_min", v)}
              />
              <p className="col-span-2 text-xs text-muted-foreground">
                Distância e duração são preenchidas automaticamente ao capturar os pontos pelo GPS.
              </p>
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
              {showRoute ? (
                <>
                  {stops.map((s, i) => (
                    <div key={s.id} className="space-y-1 rounded-md border border-border p-2">
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <GripVertical className="size-3.5" />
                        <span className="font-medium text-foreground">{i + 1}.</span>
                        <select
                          value={s.kind}
                          onChange={(e) =>
                            patchStop(s.id, { kind: e.target.value as Stop["kind"] })
                          }
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
                      variant="outline"
                      size="sm"
                      className="min-w-0 flex-1"
                      onClick={() => setStops((s) => [...s, newStop("entrega")])}
                    >
                      <Plus className="mr-1 size-4" /> Adicionar ponto
                    </Button>
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

            <Button type="submit" className="w-full" disabled={insert.isPending}>
              {insert.isPending ? "Salvando…" : "Confirmar entrega"}
            </Button>
            <p className="text-center text-xs text-muted-foreground">
              {hasFinalPoint
                ? "Será registrada como concluída."
                : "Sem ponto final: fica “Em rota” e você define o destino depois."}
            </p>
          </form>
        </SectionCard>

        <div className="space-y-4">
          <SectionCard
            title="Prévia da rota"
            description="Confirme o trajeto antes de salvar a entrega"
          >
            {mounted && (route?.points.length || stops.some((s) => s.lat != null)) ? (
              <div className="space-y-3">
                <Suspense
                  fallback={
                    <div className="flex h-64 w-full items-center justify-center rounded-md border border-border bg-muted/40">
                      <BrandSpinner />
                    </div>
                  }
                >
                  <RouteMap
                    coords={route?.coords ?? []}
                    points={
                      route?.points ??
                      stops
                        .filter((s) => s.lat != null && s.lng != null)
                        .map((s) => [s.lat!, s.lng!] as [number, number])
                    }
                    className="h-64 w-full overflow-hidden rounded-md border border-border"
                  />
                </Suspense>
                {route ? (
                  <div className="flex flex-wrap items-center gap-3 text-sm">
                    <span className="font-medium">{num(route.distanceKm)} km</span>
                    <span className="text-muted-foreground">
                      ~{minutesLabel(route.durationMin)} de trajeto
                    </span>
                    <Button type="button" size="sm" variant="secondary" onClick={applyRoute}>
                      Aplicar no formulário
                    </Button>
                    {formNav ? (
                      <Button asChild size="sm" variant="outline">
                        <a href={formNav} target="_blank" rel="noreferrer">
                          <Navigation className="mr-1 size-4" /> Navegar
                        </a>
                      </Button>
                    ) : null}
                  </div>
                ) : null}
                {route && route.legs.length > 1 ? (
                  <div className="space-y-2 rounded-md border border-border bg-muted/30 p-3">
                    <p className="text-xs font-medium">
                      Trechos encadeados ({route.legs.length}) — cada ponto final vira a origem do
                      próximo
                    </p>
                    <ul className="space-y-1">
                      {route.legs.map((leg, i) => {
                        const from = filledStops[i];
                        const to = filledStops[i + 1];
                        return (
                          <li
                            key={i}
                            className="flex min-w-0 flex-wrap items-center gap-2 text-xs text-muted-foreground"
                          >
                            <span className="min-w-0 flex-1 truncate">
                              {i + 1}. {from?.address || "Ponto"} → {to?.address || "Ponto"}
                            </span>
                            <span className="font-medium text-foreground">
                              {num(leg.distanceKm)} km · {minutesLabel(leg.durationMin)}
                            </span>
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              onClick={() => applyLeg(i)}
                            >
                              Aplicar
                            </Button>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ) : null}
                {!route ? (
                  <p className="text-xs text-muted-foreground">
                    Toque em “Ver rota” para traçar o trajeto entre os pontos.
                  </p>
                ) : null}
              </div>
            ) : (
              <EmptyState>
                Informe coleta e entrega e toque em “Ver rota” para visualizar o trajeto.
              </EmptyState>
            )}
          </SectionCard>

          <SectionCard
            title="Histórico completo"
            description={`${data.length} corridas no período`}
          >
            <div className="mb-3 flex flex-wrap gap-1">
              {(
                [
                  ["hoje", "Hoje"],
                  ["7d", "7 dias"],
                  ["30d", "30 dias"],
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
            {data.length ? (
              <ul className="divide-y divide-border">
                {data.map((d) => {
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
                            {dateTimeLabel(d.occurred_at)} · {paymentMethodLabel(d.payment_method)}{" "}
                            · {num(Number(d.distance_km))} km ·{" "}
                            {minutesLabel(Number(d.duration_min))} rodando ·{" "}
                            {minutesLabel(Number(d.idle_min))} parado
                          </p>
                        </div>
                        {nav ? (
                          <Button asChild variant="ghost" size="icon" aria-label="Navegar">
                            <a target="_blank" rel="noreferrer" href={nav}>
                              <Navigation className="size-4" />
                            </a>
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
                              {pickupCount} coleta{pickupCount === 1 ? "" : "s"} · {deliveryCount}{" "}
                              entrega{deliveryCount === 1 ? "" : "s"}
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
                                    {stopLocation(stop)}
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
                                    {raw.length + i + 1}.
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
                                          f
                                            ? { ...f, stops: f.stops.filter((x) => x.id !== s.id) }
                                            : f,
                                        )
                                      }
                                    >
                                      <X className="size-3.5" />
                                    </Button>
                                  ) : null}
                                </div>
                                <div className="flex min-w-0 gap-2">
                                  <Input
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
                                  <p className="text-xs text-muted-foreground">
                                    Buscando localização…
                                  </p>
                                ) : s.lat != null && s.lng != null ? (
                                  <p className="text-xs text-muted-foreground">
                                    {s.lat.toFixed(4)}, {s.lng.toFixed(4)}
                                  </p>
                                ) : null}
                              </div>
                            ))}
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              className="w-full"
                              disabled={updateDelivery.isPending}
                              onClick={async () => {
                                try {
                                  const saved = await persistFinishStops(
                                    d.id,
                                    raw,
                                    finishing.stops,
                                  );
                                  setFinishing((f) =>
                                    f
                                      ? {
                                          ...f,
                                          stops: saved
                                            ? [newStop("entrega")]
                                            : [...f.stops, newStop("entrega")],
                                        }
                                      : f,
                                  );
                                  if (saved) toast.success("Ponto anterior salvo na rota");
                                } catch {
                                  toast.error("Erro ao salvar o ponto anterior");
                                }
                              }}
                            >
                              <Plus className="mr-1 size-4" /> Adicionar ponto
                            </Button>

                            <div className="flex gap-2">
                              <Button
                                type="button"
                                size="sm"
                                disabled={
                                  !finishing.stops.some((s) => s.address.trim()) ||
                                  updateDelivery.isPending
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
                                      extra.duration_min = totals.durationMin;
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
                                Concluir
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
                                    const saved = await persistFinishStops(
                                      d.id,
                                      raw,
                                      finishing.stops,
                                    );
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
                        ) : (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="mt-2"
                            onClick={() => setFinishing({ id: d.id, stops: [newStop("entrega")] })}
                          >
                            <MapPin className="mr-1 size-4" /> Definir ponto final
                          </Button>
                        )
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <EmptyState>Nenhuma entrega registrada hoje.</EmptyState>
            )}
          </SectionCard>
        </div>
      </div>
    </AppShell>
  );
}

function buildDeliveryInsights({
  all,
  today,
  goalRemaining,
  dailyGoal,
}: {
  all: Delivery[];
  today: Delivery[];
  goalRemaining: number;
  dailyGoal: number;
}): DeliveryInsight[] | null {
  if (!today.length) return [];

  const completedHistory = all.filter(
    (d) => ((d as unknown as { status?: string }).status ?? "concluida") === "concluida",
  );
  const currentHour = new Date().getHours();
  const currentWeekday = new Date().getDay();
  const revenueToday = today.reduce((sum, d) => sum + Number(d.earnings) + Number(d.tip), 0);
  const avgTicket = average(
    completedHistory
      .filter((d) => Number(d.earnings) + Number(d.tip) > 0)
      .map((d) => Number(d.earnings) + Number(d.tip)),
  );
  const bestApp = rankByApp(completedHistory)[0];
  const bestHour = rankByHour(completedHistory, currentWeekday).find((h) => h.hour >= currentHour);
  const recent = completedHistory.filter(
    (d) => new Date(d.occurred_at).getTime() >= Date.now() - 30 * 86400000,
  );
  const minPerKm = percentile(
    recent
      .filter((d) => Number(d.distance_km) > 0)
      .map((d) => (Number(d.earnings) + Number(d.tip)) / Number(d.distance_km)),
    0.6,
  );
  const suggestedRuns = avgTicket > 0 ? Math.ceil(goalRemaining / avgTicket) : 0;

  const insights: DeliveryInsight[] = [];

  if (dailyGoal > 0) {
    insights.push({
      title: goalRemaining > 0 ? "Meta em foco" : "Meta batida",
      description:
        goalRemaining > 0
          ? `Você já fez ${brl(revenueToday)}. Faltam ${brl(goalRemaining)} para a meta de hoje.`
          : `Você já superou a meta diária de ${brl(dailyGoal)}.`,
      action:
        goalRemaining > 0 && suggestedRuns > 0
          ? `Busque cerca de ${suggestedRuns} entrega${suggestedRuns === 1 ? "" : "s"} no ticket médio de ${brl(avgTicket)}.`
          : "Priorize corridas com maior R$/km para proteger o lucro.",
    });
  }

  if (bestApp) {
    insights.push({
      title: "App mais forte",
      description: `${bestApp.app} lidera seu histórico com ${brl(bestApp.avgRevenue)} por entrega e ${brl(bestApp.perKm)}/km.`,
      action: `Quando houver escolha, dê prioridade a ${bestApp.app} enquanto a demanda estiver boa.`,
    });
  }

  insights.push({
    title: bestHour ? "Próxima janela boa" : "Filtro de aceite",
    description: bestHour
      ? `Hoje, a partir de ${String(bestHour.hour).padStart(2, "0")}h, seu histórico rende em média ${brl(bestHour.avgRevenue)} por entrega.`
      : "Ainda não há padrão de horário suficiente para hoje.",
    action:
      minPerKm > 0
        ? `Evite ofertas abaixo de ${brl(minPerKm)}/km, salvo se ajudarem a voltar para uma área quente.`
        : "Registre distância e tempo nas próximas corridas para calibrar o filtro automaticamente.",
  });

  return insights.slice(0, 3);
}

function average(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function percentile(values: number[], p: number) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * p)))] ?? 0;
}

function rankByApp(deliveries: Delivery[]) {
  const map = new Map<string, { app: string; revenue: number; km: number; count: number }>();
  for (const d of deliveries) {
    const cur = map.get(d.app_name) ?? { app: d.app_name, revenue: 0, km: 0, count: 0 };
    cur.revenue += Number(d.earnings) + Number(d.tip);
    cur.km += Number(d.distance_km);
    cur.count += 1;
    map.set(d.app_name, cur);
  }
  return [...map.values()]
    .filter((item) => item.count >= 2)
    .map((item) => ({
      ...item,
      avgRevenue: item.revenue / item.count,
      perKm: item.km > 0 ? item.revenue / item.km : 0,
    }))
    .sort((a, b) => b.perKm - a.perKm || b.avgRevenue - a.avgRevenue);
}

function rankByHour(deliveries: Delivery[], weekday: number) {
  const map = new Map<number, { hour: number; revenue: number; count: number }>();
  for (const d of deliveries) {
    const date = new Date(d.occurred_at);
    if (date.getDay() !== weekday) continue;
    const hour = date.getHours();
    const cur = map.get(hour) ?? { hour, revenue: 0, count: 0 };
    cur.revenue += Number(d.earnings) + Number(d.tip);
    cur.count += 1;
    map.set(hour, cur);
  }
  return [...map.values()]
    .filter((item) => item.count >= 2)
    .map((item) => ({ ...item, avgRevenue: item.revenue / item.count }))
    .sort((a, b) => b.avgRevenue - a.avgRevenue);
}

function Field({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="space-y-2">
      <Label className="text-xs">{label}</Label>
      <Input
        inputMode="decimal"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="0"
      />
    </div>
  );
}
