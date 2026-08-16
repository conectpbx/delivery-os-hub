import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { LocateFixed, Play, Square, Trash2 } from "lucide-react";
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
  const [exp, setExp] = useState({ category: CATEGORIES[0]!, description: "", amount: "" });
  const [eff, setEff] = useState("");
  const [gps, setGps] = useState(false);
  const { trip, error: tripError, start, finish, reset } = useTripTracker();

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
            <Text label="Posto" value={fuel.station} onChange={(v) => setFuel({ ...fuel, station: v })} />
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
                amount: Number(exp.amount || 0),
              });
              setExp({ category: CATEGORIES[0]!, description: "", amount: "" });
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
