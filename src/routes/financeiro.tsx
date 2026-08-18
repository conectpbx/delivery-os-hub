import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { LocateFixed, Play, Plug, Square, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { EmptyState, SectionCard, StatCard } from "@/components/ui-kit";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  useDeliveries,
  useExpenses,
  useFuelings,
  useInsert,
  useMaintenances,
  useProfile,
  useRemove,
  useUpsertProfile,
} from "@/lib/data";
import { brl, dateLabel, num } from "@/lib/format";
import { nearestFuelStation, reverseGeocodeAddress } from "@/lib/geo";
import { useTripTracker } from "@/lib/trip-tracker";
import { isMixedContentBlocked, useOdometerBridge } from "@/lib/odometer-bridge";
import { avgFuelPrice, costPerKm, summarize } from "@/lib/metrics";

export const Route = createFileRoute("/financeiro")({
  head: () => ({
    meta: [
      { title: "Controle financeiro e abastecimento — Delivery OS" },
      {
        name: "description",
        content:
          "Registre abastecimentos e despesas, acompanhe custo por quilômetro e descubra seu lucro real.",
      },
      { property: "og:title", content: "Controle financeiro — Delivery OS" },
      {
        property: "og:description",
        content: "Abastecimento, despesas e custo por quilômetro do entregador.",
      },
    ],
  }),
  component: Financeiro,
});

const CATEGORIES = ["Alimentação", "Aluguel de moto", "Seguro", "Multa", "Pedágio", "Outros"];

function Financeiro() {
  const fuelings = useFuelings();
  const expenses = useExpenses();
  const deliveries = useDeliveries();
  const maintenances = useMaintenances();
  const profile = useProfile();
  const saveProfile = useUpsertProfile();
  const addFuel = useInsert("fuelings", "fuelings");
  const addExpense = useInsert("expenses", "expenses");
  const delFuel = useRemove("fuelings", "fuelings");
  const delExpense = useRemove("expenses", "expenses");

  const [fuel, setFuel] = useState({ liters: "", price_per_liter: "", odometer: "", station: "" });
  const [exp, setExp] = useState({
    category: CATEGORIES[0]!,
    description: "",
    amount: "",
    occurred_at: new Date().toISOString().slice(0, 10),
  });
  const [eff, setEff] = useState("");
  const [gps, setGps] = useState(false);
  const { trip, error: tripError, start, finish, reset } = useTripTracker();
  const bridge = useOdometerBridge();

  const cpk = costPerKm(fuelings.data ?? [], profile.data);
  const s = summarize(deliveries.data ?? [], expenses.data ?? [], maintenances.data ?? [], cpk);
  const fuelTotal = (fuelings.data ?? []).reduce((a, f) => a + Number(f.total), 0);
  const lastOdometer = (fuelings.data ?? []).find((f) => f.odometer != null)?.odometer ?? null;
  const estimatedOdometer =
    lastOdometer != null ? Math.round(Number(lastOdometer) + trip.distanceKm) : null;

  async function captureStation() {
    if (!navigator.geolocation) {
      toast.error("GPS indisponível");
      return;
    }

    setGps(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const { latitude: lat, longitude: lng } = pos.coords;
          const station = await nearestFuelStation(lat, lng);
          if (station) {
            setFuel((f) => ({ ...f, station }));
            toast.success(`Posto: ${station}`);
          } else {
            const place = await reverseGeocodeAddress(lat, lng);
            setFuel((f) => ({ ...f, station: place?.address ?? "" }));
            toast.message("Posto não identificado", { description: "Usei o endereço atual." });
          }
        } catch {
          toast.error("Não consegui identificar o posto");
        } finally {
          setGps(false);
        }
      },
      (err) => {
        setGps(false);
        toast.error(err.message);
      },
      { enableHighAccuracy: true, timeout: 15000 },
    );
  }


  return (
    <AppShell title="Financeiro" subtitle="Abastecimento, despesas e lucro real">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Receita total" value={brl(s.revenue)} tone="primary" />
        <StatCard label="Lucro real" value={brl(s.profit)} tone={s.profit >= 0 ? "success" : "destructive"} />
        <StatCard label="Gasto com combustível" value={brl(fuelTotal)} hint={`Média ${brl(avgFuelPrice(fuelings.data ?? []))}/L`} />
        <StatCard label="Custo por km" value={brl(cpk)} hint={`${num(Number(profile.data?.fuel_efficiency ?? 12))} km/L`} />
      </div>

      <SectionCard
        className="mt-4"
        title="Jornada por GPS"
        description="Inicie no começo do dia e finalize no fim — a quilometragem é somada automaticamente"
      >
        <div className="flex flex-wrap items-center gap-3">
          <div className="min-w-0">
            <p className="text-2xl font-semibold tabular-nums">{num(trip.distanceKm)} km</p>
            <p className="truncate text-xs text-muted-foreground">
              {trip.active
                ? `Capturando desde ${dateLabel(trip.startedAt ?? new Date().toISOString())} · ${trip.points} pontos`
                : trip.endedAt
                  ? `Jornada finalizada · ${trip.points} pontos`
                  : "Nenhuma jornada em andamento"}
            </p>
          </div>
          <div className="ml-auto flex flex-wrap gap-2">
            {trip.active ? (
              <Button variant="destructive" onClick={finish}>
                <Square className="mr-2 size-4" /> Finalizar
              </Button>
            ) : (
              <Button onClick={start}>
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
                setFuel((f) => ({ ...f, odometer: String(estimatedOdometer) }));
                toast.success(`Odômetro estimado: ${estimatedOdometer} km`);
              }}
            >
              Preencher odômetro
            </Button>
            {trip.distanceKm > 0 && !trip.active ? (
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
        </p>

        <div className="mt-4 rounded-lg border border-border p-3">
          <div className="flex flex-wrap items-center gap-2">
            <Plug className="size-4 text-primary" />
            <p className="text-sm font-medium">App externo na rede Wi-Fi</p>
            {bridge.reading ? (
              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">
                {bridge.reading.odometerKm != null ? `${num(bridge.reading.odometerKm)} km` : "sem odômetro"}
                {bridge.reading.speedKmh != null ? ` · ${num(bridge.reading.speedKmh)} km/h` : ""}
              </span>
            ) : null}
          </div>
          <div className="mt-3 flex flex-wrap items-end gap-2">
            <div className="min-w-0 flex-1 space-y-2">
              <Label className="text-xs">URL do status (ex.: http://192.168.0.10:8080/status)</Label>
              <Input
                inputMode="url"
                placeholder="http://192.168.0.10:8080/status"
                value={bridge.config.url}
                onChange={(e) => bridge.update({ url: e.target.value })}
              />
            </div>
            <Button
              type="button"
              variant="secondary"
              onClick={async () => {
                const url = bridge.config.url.trim();
                if (!url) {
                  toast.error("Informe a URL do app");
                  return;
                }
                if (isMixedContentBlocked(url)) {
                  toast.error("Página HTTPS não consegue ler http:// da rede local", {
                    description: "Use o app em HTTP local ou habilite HTTPS/túnel no servidor do celular.",
                  });
                  return;
                }
                const r = await bridge.test(url);
                if (r) toast.success("Conectado ao app externo");
              }}
            >
              Testar
            </Button>
            <Button
              type="button"
              variant={bridge.config.enabled ? "destructive" : "default"}
              onClick={() => bridge.update({ enabled: !bridge.config.enabled })}
            >
              {bridge.config.enabled ? "Parar leitura" : "Ler a cada 5s"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={bridge.reading?.odometerKm == null}
              onClick={() => {
                const km = bridge.reading?.odometerKm;
                if (km == null) return;
                setFuel((f) => ({ ...f, odometer: String(Math.round(km)) }));
                toast.success(`Odômetro do app: ${Math.round(km)} km`);
              }}
            >
              Usar no odômetro
            </Button>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            {bridge.error
              ? `Erro: ${bridge.error}`
              : "O app do celular precisa responder JSON (ex.: {\"odometer\": 45210, \"speed\": 32}) e liberar CORS (Access-Control-Allow-Origin: *)."}
          </p>
        </div>
      </SectionCard>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">

        <SectionCard title="Novo abastecimento">
          <form
            className="grid grid-cols-2 gap-3"
            onSubmit={async (e) => {
              e.preventDefault();
              const liters = Number(fuel.liters || 0);
              const price = Number(fuel.price_per_liter || 0);
              await addFuel.mutateAsync({
                liters,
                price_per_liter: price,
                total: liters * price,
                odometer: fuel.odometer ? Number(fuel.odometer) : null,
                station: fuel.station || null,
              });
              setFuel({ liters: "", price_per_liter: "", odometer: "", station: "" });
              toast.success("Abastecimento registrado");
            }}
          >
            <Text label="Litros" value={fuel.liters} onChange={(v) => setFuel({ ...fuel, liters: v })} />
            <Text label="R$/litro" value={fuel.price_per_liter} onChange={(v) => setFuel({ ...fuel, price_per_liter: v })} />
            <Text label="Odômetro" value={fuel.odometer} onChange={(v) => setFuel({ ...fuel, odometer: v })} />
            <div className="space-y-2">
              <Label className="text-xs">Posto</Label>
              <div className="flex gap-2">
                <Input
                  className="min-w-0"
                  value={fuel.station}
                  onChange={(e) => setFuel({ ...fuel, station: e.target.value })}
                />
                <Button
                  type="button"
                  variant="secondary"
                  size="icon"
                  aria-label="Capturar posto por GPS"
                  disabled={gps}
                  onClick={() => void captureStation()}
                >
                  <LocateFixed className="size-4" />
                </Button>
              </div>
            </div>
            <Button type="submit" className="col-span-2">
              Salvar abastecimento
            </Button>
          </form>
          <ul className="mt-4 divide-y divide-border">
            {(fuelings.data ?? []).slice(0, 6).map((f) => (
              <li key={f.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                <span className="text-muted-foreground">
                  {dateLabel(f.occurred_at)} · {num(Number(f.liters))} L · {f.station ?? "posto"}
                </span>
                <span className="flex items-center gap-2 font-medium tabular-nums">
                  {brl(Number(f.total))}
                  <Button variant="ghost" size="icon" aria-label="Excluir" onClick={() => delFuel.mutate(f.id)}>
                    <Trash2 className="size-4 text-destructive" />
                  </Button>
                </span>
              </li>
            ))}
          </ul>
          {!(fuelings.data ?? []).length ? <EmptyState>Nenhum abastecimento.</EmptyState> : null}
        </SectionCard>

        <SectionCard title="Nova despesa">
          <form
            className="grid grid-cols-2 gap-3"
            onSubmit={async (e) => {
              e.preventDefault();
              await addExpense.mutateAsync({
                category: exp.category,
                description: exp.description || null,
                amount: Number(String(exp.amount).replace(",", ".") || 0),
                occurred_at: exp.occurred_at,
              });
              setExp({
                category: CATEGORIES[0]!,
                description: "",
                amount: "",
                occurred_at: new Date().toISOString().slice(0, 10),
              });
              toast.success("Despesa registrada");
            }}
          >
            <div className="col-span-2 space-y-2">
              <Label className="text-xs">Categoria</Label>
              <select
                value={exp.category}
                onChange={(e) => setExp({ ...exp, category: e.target.value })}
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                {CATEGORIES.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </div>
            <div className="col-span-2 space-y-2">
              <Label className="text-xs">Data</Label>
              <Input
                type="date"
                value={exp.occurred_at}
                onChange={(e) => setExp({ ...exp, occurred_at: e.target.value })}
              />
            </div>
            <Text label="Valor (R$)" value={exp.amount} onChange={(v) => setExp({ ...exp, amount: v })} />
            <Text label="Descrição" value={exp.description} onChange={(v) => setExp({ ...exp, description: v })} />
            <Button type="submit" className="col-span-2">
              Salvar despesa
            </Button>
          </form>
          <ul className="mt-4 divide-y divide-border">
            {(expenses.data ?? []).slice(0, 6).map((x) => (
              <li key={x.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                <span className="text-muted-foreground">
                  {dateLabel(x.occurred_at)} · {x.category}
                </span>
                <span className="flex items-center gap-2 font-medium tabular-nums">
                  {brl(Number(x.amount))}
                  <Button variant="ghost" size="icon" aria-label="Excluir" onClick={() => delExpense.mutate(x.id)}>
                    <Trash2 className="size-4 text-destructive" />
                  </Button>
                </span>
              </li>
            ))}
          </ul>
          {!(expenses.data ?? []).length ? <EmptyState>Nenhuma despesa.</EmptyState> : null}
        </SectionCard>
      </div>

      <SectionCard
        className="mt-4"
        title="Consumo do veículo"
        description="Usado para calcular o custo por quilômetro"
      >
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={async (e) => {
            e.preventDefault();
            await saveProfile.mutateAsync({ fuel_efficiency: Number(eff || 12) });
            toast.success("Consumo atualizado");
          }}
        >
          <div className="space-y-2">
            <Label className="text-xs">Consumo médio (km/L)</Label>
            <Input
              inputMode="decimal"
              value={eff}
              placeholder={String(profile.data?.fuel_efficiency ?? 12)}
              onChange={(e) => setEff(e.target.value)}
            />
          </div>
          <Button type="submit" variant="secondary">
            Atualizar
          </Button>
        </form>
      </SectionCard>
    </AppShell>
  );
}

function Text({
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
      <Input value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}
