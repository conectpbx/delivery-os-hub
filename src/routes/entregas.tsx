import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { MapPin, Navigation, Plus, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { EmptyState, SectionCard, StatCard } from "@/components/ui-kit";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useApps, useDeliveries, useInsert, useInsertApp, useRemove, useUpdateApp } from "@/lib/data";
import { brl, dateTimeLabel, minutesLabel, num } from "@/lib/format";

export const Route = createFileRoute("/entregas")({
  head: () => ({
    meta: [
      { title: "Entregas e rotas — Delivery OS" },
      {
        name: "description",
        content:
          "Registre entregas com GPS automático, distância, tempo parado e abra a navegação até o destino.",
      },
      { property: "og:title", content: "Entregas e rotas — Delivery OS" },
      {
        property: "og:description",
        content: "Histórico completo de corridas com captura de localização e navegação.",
      },
    ],
  }),
  component: Entregas,
});

function Entregas() {
  const list = useDeliveries();
  const apps = useApps();
  const insert = useInsert("deliveries", "deliveries");
  const insertApp = useInsertApp();
  const updateApp = useUpdateApp();
  const remove = useRemove("deliveries", "deliveries");
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [addingApp, setAddingApp] = useState(false);
  const [newAppName, setNewAppName] = useState("");
  const [newAppFee, setNewAppFee] = useState("");
  const [form, setForm] = useState({
    app_name: "",
    earnings: "",
    fee_percent: "",
    tip: "",
    distance_km: "",
    duration_min: "",
    idle_min: "",
    pickup_address: "",
    dropoff_address: "",
  });

  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const selectedApp = (apps.data ?? []).find((a) => a.name === form.app_name);
  const gross = Number(form.earnings || 0);
  const feePct = Math.min(Math.max(Number(form.fee_percent || 0), 0), 100);
  const feeValue = (gross * feePct) / 100;
  const net = gross - feeValue;

  function selectApp(name: string) {
    const app = (apps.data ?? []).find((a) => a.name === name);
    setForm((f) => ({ ...f, app_name: name, fee_percent: String(Number(app?.fee_percent ?? 0)) }));
  }

  function captureGps() {
    if (!("geolocation" in navigator)) {
      toast.error("GPS indisponível neste dispositivo");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        toast.success("Localização capturada");
      },
      () => toast.error("Não foi possível obter a localização"),
    );
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    try {
      await insert.mutateAsync({
        app_name: form.app_name,
        gross_earnings: gross,
        fee_percent: feePct,
        earnings: Number(net.toFixed(2)),
        tip: Number(form.tip || 0),
        distance_km: Number(form.distance_km || 0),
        duration_min: Number(form.duration_min || 0),
        idle_min: Number(form.idle_min || 0),
        pickup_address: form.pickup_address || null,
        dropoff_address: form.dropoff_address || null,
        lat: coords?.lat ?? null,
        lng: coords?.lng ?? null,
      });
      toast.success("Entrega registrada");
      setForm({ ...form, earnings: "", tip: "", distance_km: "", duration_min: "", idle_min: "" });
    } catch {
      toast.error("Erro ao salvar a entrega");
    }
  }

  const data = list.data ?? [];
  const total = data.reduce((s, d) => s + Number(d.earnings) + Number(d.tip), 0);
  const km = data.reduce((s, d) => s + Number(d.distance_km), 0);
  const idle = data.reduce((s, d) => s + Number(d.idle_min), 0);

  return (
    <AppShell title="Entregas" subtitle="Registro de corridas, GPS e navegação">
      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard label="Total recebido" value={brl(total)} tone="primary" />
        <StatCard label="Distância total" value={`${num(km)} km`} />
        <StatCard label="Tempo parado" value={minutesLabel(idle)} tone="warning" />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[380px_1fr]">
        <SectionCard title="Nova entrega" description="Preencha após finalizar a corrida">
          <form onSubmit={submit} className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="app">Aplicativo</Label>
              {addingApp ? (
                <div className="space-y-2">
                  <div className="flex gap-2">
                    <Input
                      value={newAppName}
                      onChange={(e) => setNewAppName(e.target.value)}
                      placeholder="Nome do aplicativo"
                      className="flex-1"
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
                          const fee = Math.min(Math.max(Number(newAppFee || 0), 0), 100);
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
                <div className="flex gap-2">
                  <select
                    id="app"
                    value={form.app_name}
                    onChange={(e) => selectApp(e.target.value)}
                    className="h-9 flex-1 rounded-md border border-input bg-background px-3 text-sm"
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
            <div className="grid grid-cols-2 gap-3">
              <Field
                label="Valor bruto (R$)"
                value={form.earnings}
                onChange={(v) => set("earnings", v)}
              />
              <Field
                label="Taxa do app (%)"
                value={form.fee_percent}
                onChange={(v) => set("fee_percent", v)}
              />
              <Field label="Gorjeta (R$)" value={form.tip} onChange={(v) => set("tip", v)} />
              <Field label="Distância (km)" value={form.distance_km} onChange={(v) => set("distance_km", v)} />
              <Field label="Duração (min)" value={form.duration_min} onChange={(v) => set("duration_min", v)} />
              <Field label="Tempo parado (min)" value={form.idle_min} onChange={(v) => set("idle_min", v)} />
            </div>
            <div className="rounded-md border border-border bg-muted/40 p-3 text-xs">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Taxa descontada</span>
                <span>-{brl(feeValue)}</span>
              </div>
              <div className="mt-1 flex justify-between font-medium">
                <span>Ganho líquido</span>
                <span>{brl(net + Number(form.tip || 0))}</span>
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
            <div className="space-y-2">
              <Label htmlFor="pickup">Coleta</Label>
              <Input
                id="pickup"
                value={form.pickup_address}
                onChange={(e) => set("pickup_address", e.target.value)}
                placeholder="Restaurante / loja"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="drop">Entrega</Label>
              <Input
                id="drop"
                value={form.dropoff_address}
                onChange={(e) => set("dropoff_address", e.target.value)}
                placeholder="Endereço do cliente"
              />
            </div>
            <div className="flex items-center gap-2">
              <Button type="button" variant="outline" className="gap-2" onClick={captureGps}>
                <MapPin className="size-4" /> GPS automático
              </Button>
              {coords ? (
                <span className="text-xs text-muted-foreground">
                  {coords.lat.toFixed(4)}, {coords.lng.toFixed(4)}
                </span>
              ) : null}
            </div>
            <Button type="submit" className="w-full" disabled={insert.isPending}>
              Salvar entrega
            </Button>
          </form>
        </SectionCard>

        <SectionCard title="Histórico completo" description={`${data.length} corridas registradas`}>
          {data.length ? (
            <ul className="divide-y divide-border">
              {data.map((d) => (
                <li key={d.id} className="flex items-start gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">
                      {d.app_name} · {brl(Number(d.earnings) + Number(d.tip))}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {dateTimeLabel(d.occurred_at)} · {num(Number(d.distance_km))} km ·{" "}
                      {minutesLabel(Number(d.duration_min))} rodando ·{" "}
                      {minutesLabel(Number(d.idle_min))} parado
                    </p>
                    {d.dropoff_address ? (
                      <p className="truncate text-xs text-muted-foreground">→ {d.dropoff_address}</p>
                    ) : null}
                  </div>
                  {d.dropoff_address || d.lat ? (
                    <Button asChild variant="ghost" size="icon" aria-label="Navegar">
                      <a
                        target="_blank"
                        rel="noreferrer"
                        href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(
                          d.dropoff_address ?? `${d.lat},${d.lng}`,
                        )}`}
                      >
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
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState>Nenhuma entrega registrada ainda.</EmptyState>
          )}
        </SectionCard>
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
