import { createFileRoute } from "@tanstack/react-router";
import { Suspense, lazy, useEffect, useState } from "react";
import { GripVertical, MapPin, Navigation, Plus, Route as RouteIcon, Trash2, X } from "lucide-react";
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
  useInsertApp,
  useRemove,
  useUpdate,
  useUpdateApp,
} from "@/lib/data";
import { brl, dateTimeLabel, minutesLabel, num } from "@/lib/format";
import { fetchRoute, geocodeAddress, navigationUrl, newStop, type RouteResult, type Stop } from "@/lib/geo";

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
    ],
  }),
  component: Entregas,
});

type StoredStop = { kind: string; address: string; lat: number | null; lng: number | null };

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
  const [stops, setStops] = useState<Stop[]>(() => [newStop("coleta"), newStop("entrega")]);
  const [route, setRoute] = useState<RouteResult | null>(null);
  const [showRoute, setShowRoute] = useState(false);
  const [routing, setRouting] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [finishing, setFinishing] = useState<{ id: string; stops: Stop[] } | null>(null);
  const [finishGeo, setFinishGeo] = useState<string | null>(null);
  const [histRange, setHistRange] = useState<"hoje" | "7d" | "30d" | "tudo">("hoje");


  const [form, setForm] = useState({
    app_name: "",
    earnings: "",
    fee_percent: "",
    fee_amount: "",
    tip: "",
    distance_km: "",
    duration_min: "",
    idle_min: "",
  });

  useEffect(() => setMounted(true), []);

  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));
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

  async function reverseGeocode(lat: number, lng: number) {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=18&addressdetails=1&accept-language=pt-BR&lat=${lat}&lon=${lng}`,
      { headers: { Accept: "application/json" } },
    );
    if (!res.ok) throw new Error("geocode");
    const json = (await res.json()) as {
      display_name?: string;
      name?: string;
      address?: Record<string, string>;
    };
    const a = json.address ?? {};
    const road = a["road"] ?? a["pedestrian"] ?? a["footway"] ?? "";
    const number = a["house_number"] ?? "";
    const district = a["suburb"] ?? a["neighbourhood"] ?? a["city_district"] ?? "";
    const city = a["city"] ?? a["town"] ?? a["village"] ?? a["municipality"] ?? "";
    const short = [[json.name, road].filter(Boolean).join(" - ") || road, number, district, city]
      .filter(Boolean)
      .join(", ");
    return short || json.display_name || "";
  }

  function captureGps(stopId: string) {
    if (!("geolocation" in navigator)) {
      toast.error("GPS indisponível neste dispositivo");
      return;
    }
    setGeoTarget(stopId);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        setAccuracy(Math.round(pos.coords.accuracy));
        patchStop(stopId, { lat, lng });
        try {
          const address = await reverseGeocode(lat, lng);
          if (address) {
            patchStop(stopId, { address });
            toast.success("Endereço preenchido pelo GPS");
          } else {
            toast.success("Localização capturada");
          }
        } catch {
          toast.message("Localização capturada (endereço indisponível)");
        } finally {
          setGeoTarget(null);
        }
      },
      (err) => {
        setGeoTarget(null);
        toast.error(
          err.code === err.PERMISSION_DENIED
            ? "Permissão de localização negada — libere o GPS nas configurações do navegador"
            : err.code === err.TIMEOUT
              ? "O GPS demorou demais para responder. Tente novamente a céu aberto."
              : "Não foi possível obter a localização",
        );
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    );
  }

  const patchFinishStop = (stopId: string, values: Partial<Stop>) =>
    setFinishing((f) =>
      f ? { ...f, stops: f.stops.map((s) => (s.id === stopId ? { ...s, ...values } : s)) } : f,
    );

  function captureFinishGps(stopId: string) {
    if (!("geolocation" in navigator)) {
      toast.error("GPS indisponível neste dispositivo");
      return;
    }
    setFinishGeo(stopId);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        patchFinishStop(stopId, { lat, lng });
        try {
          const address = await reverseGeocode(lat, lng);
          patchFinishStop(stopId, {
            address: address || `${lat.toFixed(5)}, ${lng.toFixed(5)}`,
          });
          toast.success(address ? "Endereço preenchido pelo GPS" : "Localização capturada");
        } catch {
          patchFinishStop(stopId, { address: `${lat.toFixed(5)}, ${lng.toFixed(5)}` });
          toast.message("Localização capturada (endereço indisponível)");
        } finally {
          setFinishGeo(null);
        }
      },
      (err) => {
        setFinishGeo(null);
        toast.error(
          err.code === err.PERMISSION_DENIED
            ? "Permissão de localização negada — libere o GPS nas configurações do navegador"
            : "Não foi possível obter a localização",
        );
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    );
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
      const result = await fetchRoute(resolved.map((s) => [s.lat!, s.lng!] as [number, number]));
      if (!result) {
        toast.error("Não foi possível traçar a rota agora");
        return;
      }
      setRoute(result);
      toast.success(`Rota: ${num(result.distanceKm)} km · ${minutesLabel(result.durationMin)}`);
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
        distance_km: dec(form.distance_km),
        duration_min: Math.round(dec(form.duration_min)),
        idle_min: Math.round(dec(form.idle_min)),
        pickup_address: first?.address || null,
        dropoff_address: finalized ? last?.address || null : null,
        lat: first?.lat ?? null,
        lng: first?.lng ?? null,
        status: finalized ? "concluida" : "em_rota",
        stops: filled.map((s) => ({
          kind: s.kind,
          address: s.address,
          lat: s.lat,
          lng: s.lng,
        })),
      });
      toast.success(finalized ? "Entrega registrada" : "Entrega salva em rota — defina o ponto final depois");
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
  const data = (list.data ?? []).filter((d) => {
    const t = new Date(d.occurred_at).getTime();
    return t >= todayStart.getTime() && t <= todayEnd.getTime();
  });
  const total = data.reduce((s, d) => s + Number(d.earnings) + Number(d.tip), 0);
  const km = data.reduce((s, d) => s + Number(d.distance_km), 0);
  const idle = data.reduce((s, d) => s + Number(d.idle_min), 0);
  const formNav = navigationUrl(stops);
  const filledStops = stops.filter((s) => s.address.trim() || (s.lat != null && s.lng != null));
  const lastStop = filledStops[filledStops.length - 1];
  const hasFinalPoint = filledStops.length >= 2 && !!lastStop && lastStop.kind === "entrega";

  return (
    <AppShell title="Entregas" subtitle="Registro de corridas, rota no mapa e navegação">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatCard label="Total recebido" value={brl(total)} tone="primary" />
        <StatCard label="Distância total" value={`${num(km)} km`} />
        <StatCard label="Tempo parado" value={minutesLabel(idle)} tone="warning" />
      </div>

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
                      value={s.address}
                      onChange={(e) => patchStop(s.id, { address: e.target.value, lat: null, lng: null })}
                      placeholder={s.kind === "coleta" ? "Restaurante / loja" : "Endereço do cliente"}
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

          <SectionCard title="Histórico de hoje" description={`${data.length} corridas hoje`}>
            {data.length ? (
              <ul className="divide-y divide-border">
                {data.map((d) => {
                  const raw = (d as unknown as { stops?: StoredStop[] }).stops ?? [];
                  const status = (d as unknown as { status?: string }).status ?? "concluida";
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
                            {dateTimeLabel(d.occurred_at)} · {num(Number(d.distance_km))} km ·{" "}
                            {minutesLabel(Number(d.duration_min))} rodando ·{" "}
                            {minutesLabel(Number(d.idle_min))} parado
                          </p>
                          {raw.length > 1 ? (
                            <p className="truncate text-xs text-muted-foreground">
                              {raw.map((s) => s.address).filter(Boolean).join(" → ")}
                            </p>
                          ) : d.dropoff_address ? (
                            <p className="truncate text-xs text-muted-foreground">
                              → {d.dropoff_address}
                            </p>
                          ) : null}
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
                                      s.kind === "coleta"
                                        ? "Nova coleta"
                                        : "Endereço de entrega"
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
                              onClick={() =>
                                setFinishing((f) =>
                                  f ? { ...f, stops: [...f.stops, newStop("entrega")] } : f,
                                )
                              }
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
                                  const filled = finishing.stops
                                    .filter((s) => s.address.trim())
                                    .map((s) => ({
                                      kind: s.kind,
                                      address: s.address.trim(),
                                      lat: s.lat,
                                      lng: s.lng,
                                    }));
                                  const last = filled[filled.length - 1];
                                  try {
                                    await updateDelivery.mutateAsync({
                                      id: d.id,
                                      values: {
                                        dropoff_address: last?.address ?? "",
                                        status: "concluida",
                                        stops: [...raw, ...filled],
                                      },
                                    });
                                    setFinishing(null);
                                    toast.success("Rota concluída");
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
                            onClick={() =>
                              setFinishing({ id: d.id, stops: [newStop("entrega")] })
                            }
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
