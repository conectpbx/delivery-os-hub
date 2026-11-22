import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FinanceJourney } from "@/components/FinanceJourney";
import { BonusIncome } from "@/components/BonusIncome";
import { bonusTotal, addBonusIncome } from "@/lib/app-challenges";
import { useAppChallenges } from "@/lib/data";
import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useMemo, useState, useId } from "react";
import { LocateFixed, Trash2 } from "lucide-react";
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
import { brl, dateLabel, dec, localDateValue, num } from "@/lib/format";
import {
  geolocationErrorMessage,
  getCurrentPosition,
  isGeolocationError,
  nearestFuelStation,
  reverseGeocodeAddress,
} from "@/lib/geo";
import {
  avgFuelPrice,
  costPerKm,
  filterByRange,
  maintenanceReservePerKm,
  summarizeOperational,
  summarizeRecordedCosts,
} from "@/lib/metrics";
import { PeriodFilter, PeriodSummary, usePeriodSelection } from "@/components/PeriodFilter";
import { usePersistentState } from "@/lib/persistent-state";

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
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Financeiro,
});

const CATEGORIES = ["Alimentação", "Aluguel de moto", "Seguro", "Multa", "Pedágio", "Outros"];

function Financeiro() {
  const period = usePeriodSelection(0);
  const [tab, setTab] = useState("lancamentos");
  const fuelings = useFuelings();
  const expenses = useExpenses();
  const challenges = useAppChallenges();
  const deliveries = useDeliveries({ from: period.fromDate, to: period.toDate });
  const maintenances = useMaintenances();
  const profile = useProfile();
  const saveProfile = useUpsertProfile();
  const addFuel = useInsert("fuelings", "fuelings");
  const addExpense = useInsert("expenses", "expenses");
  const delFuel = useRemove("fuelings", "fuelings");
  const delExpense = useRemove("expenses", "expenses");

  const [fuel, setFuel] = usePersistentState("financeiro.fuel", {
    liters: "",
    price_per_liter: "",
    odometer: "",
    station: "",
    occurred_at: localDateValue(),
  });
  const [exp, setExp] = usePersistentState("financeiro.expense", {
    category: CATEGORIES[0]!,
    description: "",
    amount: "",
    occurred_at: localDateValue(),
    allocation_method: "immediate" as "immediate" | "monthly",
  });
  const [eff, setEff] = useState("");
  const [gps, setGps] = useState(false);

  const {
    cpk,
    maintenanceReserve,
    perExpenses,
    perFuelings,
    cashBase,
    cash,
    operational,
    fuelTotal,
    averageFuelPrice,
    lastOdometer,
  } = useMemo(() => {
    const cpk = costPerKm(fuelings.data ?? [], profile.data);
    const maintenanceReserve = maintenanceReservePerKm(maintenances.data ?? []);
    const perDeliveries = filterByRange(
      deliveries.data ?? [],
      (d) => d.occurred_at,
      period.fromDate,
      period.toDate,
    );
    const perExpenses = filterByRange(
      expenses.data ?? [],
      (e) => e.occurred_at,
      period.fromDate,
      period.toDate,
    );
    const perMaint = filterByRange(
      maintenances.data ?? [],
      (m) => m.performed_at,
      period.fromDate,
      period.toDate,
    );
    const perFuelings = filterByRange(
      fuelings.data ?? [],
      (f) => f.occurred_at,
      period.fromDate,
      period.toDate,
    );
    const cashBase = summarizeRecordedCosts(perDeliveries, perExpenses, perMaint, perFuelings);
    const operationalBase = summarizeOperational(
      perDeliveries,
      expenses.data ?? [],
      cpk,
      maintenanceReserve.costPerKm,
      {
        from: period.fromDate,
        to: period.toDate,
        maintenanceCostPerDay: maintenanceReserve.costPerDay,
        maintenanceItems: maintenanceReserve.items,
      },
    );
    const bonusIncome = bonusTotal(challenges.data ?? [], period.fromDate, period.toDate);
    const cash = addBonusIncome(cashBase, bonusIncome);
    const operational = addBonusIncome(operationalBase, bonusIncome);
    const fuelTotal = perFuelings.reduce((a, f) => a + Number(f.total), 0);
    const lastOdometer = (fuelings.data ?? []).find((f) => f.odometer != null)?.odometer ?? null;
    return {
      cpk,
      maintenanceReserve,
      perDeliveries,
      perExpenses,
      perMaint,
      perFuelings,
      cashBase,
      operationalBase,
      bonusIncome,
      cash,
      operational,
      fuelTotal,
      averageFuelPrice: avgFuelPrice(fuelings.data ?? []),
      lastOdometer,
    };
  }, [
    fuelings.data,
    expenses.data,
    challenges.data,
    deliveries.data,
    maintenances.data,
    profile.data,
    period.fromDate,
    period.toDate,
  ]);
  const fillOdometer = useCallback(
    (odometer: string) => {
      setFuel((value) => ({ ...value, odometer }));
      setTab("lancamentos");
      requestAnimationFrame(() => document.getElementById("finance-odometer")?.focus());
    },
    [setFuel],
  );

  async function captureStation() {
    setGps(true);
    try {
      const { lat, lng } = await getCurrentPosition();
      const station = await nearestFuelStation(lat, lng);
      if (station) {
        setFuel((f) => ({ ...f, station }));
        toast.success(`Posto: ${station}`);
      } else {
        const place = await reverseGeocodeAddress(lat, lng);
        setFuel((f) => ({ ...f, station: place?.address ?? "" }));
        toast.message("Posto não identificado", { description: "Usei o endereço atual." });
      }
    } catch (err) {
      toast.error(
        isGeolocationError(err) ? geolocationErrorMessage(err) : "Não consegui identificar o posto",
      );
    } finally {
      setGps(false);
    }
  }

  return (
    <AppShell
      title="Financeiro"
      subtitle={`Abastecimento, despesas e lucro real · ${period.label}`}
      actions={<PeriodFilter selection={period} />}
    >
      <PeriodSummary selection={period} />
      <div className="mt-4 grid grid-cols-2 gap-2 sm:gap-3 xl:grid-cols-4">
        <StatCard
          label="Receita total"
          value={brl(cash.revenue)}
          hint={`${cash.count} entregas no período`}
          tone="primary"
        />
        <StatCard
          label="Lucro por caixa"
          value={brl(cash.profit)}
          hint={`Pagamentos ${brl(cash.fuelCost + cash.otherCost + cash.maintenanceCost)}`}
          tone={cash.profit >= 0 ? "success" : "destructive"}
        />
        <StatCard
          label="Gasto com combustível"
          value={brl(fuelTotal)}
          hint={`Média ${brl(averageFuelPrice)}/L`}
        />
        <StatCard
          label="Lucro operacional estimado"
          value={brl(operational.profit)}
          hint={`Custo estimado ${brl(cpk + maintenanceReserve.costPerKm)}/km · reserva ${brl(operational.maintenanceCost)}`}
          tone={operational.profit >= 0 ? "success" : "destructive"}
        />
      </div>

      <Tabs value={tab} onValueChange={setTab} className="mt-6">
        <TabsList
          aria-label="Áreas do financeiro"
          className="grid h-auto w-full grid-cols-3 gap-1 p-1 sm:max-w-lg"
        >
          <TabsTrigger value="lancamentos" className="min-h-11 px-2 text-xs sm:text-sm">
            Lançamentos
          </TabsTrigger>
          <TabsTrigger value="jornada" className="min-h-11 px-2 text-xs sm:text-sm">
            Jornada e GPS
          </TabsTrigger>
          <TabsTrigger value="veiculo" className="min-h-11 px-2 text-xs sm:text-sm">
            Veículo
          </TabsTrigger>
        </TabsList>
        <TabsContent value="lancamentos" forceMount className="data-[state=inactive]:hidden">
          <div className="mt-5 mb-3">
            <h2 className="text-base font-semibold">Registre seus gastos</h2>
            <p className="text-sm text-muted-foreground">
              Adicione um abastecimento ou uma despesa para acompanhar seu lucro.
            </p>
          </div>
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <SectionCard
              title="Novo abastecimento"
              description="Informe a quantidade e o preço por litro."
            >
              <form
                className="grid grid-cols-2 gap-3"
                onSubmit={async (e) => {
                  e.preventDefault();
                  const liters = dec(fuel.liters);
                  const price = dec(fuel.price_per_liter);
                  const odometer = fuel.odometer ? dec(fuel.odometer) : null;
                  if (liters <= 0 || price <= 0) {
                    toast.error("Informe litros e R$/litro maiores que zero");
                    return;
                  }
                  try {
                    await addFuel.mutateAsync({
                      liters,
                      price_per_liter: price,
                      total: Number((liters * price).toFixed(2)),
                      odometer,
                      station: fuel.station || null,
                      occurred_at: new Date(
                        `${fuel.occurred_at || localDateValue()}T12:00:00`,
                      ).toISOString(),
                    });
                    setFuel({
                      liters: "",
                      price_per_liter: "",
                      odometer: "",
                      station: "",
                      occurred_at: localDateValue(),
                    });
                    toast.success("Abastecimento registrado");
                  } catch (err) {
                    toast.error(
                      err instanceof Error
                        ? err.message
                        : "Não foi possível salvar o abastecimento",
                    );
                  }
                }}
              >
                <Text
                  label="Litros"
                  value={fuel.liters}
                  onChange={(v) => setFuel({ ...fuel, liters: v })}
                />
                <Text
                  label="R$/litro"
                  value={fuel.price_per_liter}
                  onChange={(v) => setFuel({ ...fuel, price_per_liter: v })}
                />
                <Text
                  inputId="finance-odometer"
                  label="Odômetro"
                  value={fuel.odometer}
                  onChange={(v) => setFuel({ ...fuel, odometer: v })}
                />
                <div className="min-w-0 space-y-2">
                  <Label htmlFor="finance-fuel-date" className="text-xs">
                    Data
                  </Label>
                  <Input
                    aria-label="Data do abastecimento"
                    id="finance-fuel-date"
                    type="date"
                    value={fuel.occurred_at ?? ""}
                    onChange={(e) => setFuel({ ...fuel, occurred_at: e.target.value })}
                  />
                </div>
                <div className="min-w-0 space-y-2">
                  <Label htmlFor="finance-station" className="text-xs">
                    Posto (opcional)
                  </Label>
                  <div className="flex gap-2">
                    <Input
                      id="finance-station"
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
                <div className="col-span-2 flex items-center justify-between rounded-lg bg-muted/50 p-3 text-sm">
                  <span className="text-muted-foreground">Total do abastecimento</span>
                  <output
                    className="font-semibold tabular-nums"
                    aria-label="Total do abastecimento"
                  >
                    {brl(dec(fuel.liters) * dec(fuel.price_per_liter))}
                  </output>
                </div>
                <Button type="submit" disabled={addFuel.isPending} className="col-span-2 min-h-11">
                  {addFuel.isPending ? "Salvando…" : "Salvar abastecimento"}
                </Button>
              </form>
              <h3 className="mt-5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Registros recentes no período
              </h3>
              <ul className="mt-2 divide-y divide-border">
                {perFuelings.slice(0, 6).map((f) => (
                  <li
                    key={f.id}
                    className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm"
                  >
                    <span className="text-muted-foreground">
                      {dateLabel(f.occurred_at)} · {num(Number(f.liters))} L ·{" "}
                      {f.station ?? "posto"}
                    </span>
                    <span className="flex items-center gap-2 font-medium tabular-nums">
                      {brl(Number(f.total))}
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Excluir abastecimento de ${dateLabel(f.occurred_at)}`}
                        onClick={() => delFuel.mutate(f.id)}
                      >
                        <Trash2 className="size-4 text-destructive" />
                      </Button>
                    </span>
                  </li>
                ))}
              </ul>
              {!perFuelings.length ? (
                <EmptyState>Nenhum abastecimento em {period.label.toLowerCase()}.</EmptyState>
              ) : null}
            </SectionCard>

            <SectionCard
              title="Nova despesa"
              description="Organize os outros gastos da sua operação."
            >
              <form
                className="grid grid-cols-2 gap-3"
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (dec(exp.amount) <= 0) {
                    toast.error("Informe um valor maior que zero");
                    return;
                  }
                  try {
                    await addExpense.mutateAsync({
                      category: exp.category,
                      description: exp.description || null,
                      amount: dec(exp.amount),
                      occurred_at: exp.occurred_at,
                      allocation_method: exp.allocation_method ?? "immediate",
                    });
                    setExp({
                      category: CATEGORIES[0]!,
                      description: "",
                      amount: "",
                      occurred_at: localDateValue(),
                      allocation_method: "immediate",
                    });
                    toast.success("Despesa registrada");
                  } catch (error) {
                    toast.error(
                      error instanceof Error ? error.message : "Não foi possível salvar a despesa",
                    );
                  }
                }}
              >
                <div className="col-span-2 space-y-2">
                  <Label htmlFor="finance-category" className="text-xs">
                    Categoria
                  </Label>
                  <select
                    id="finance-category"
                    value={exp.category}
                    onChange={(e) =>
                      setExp({
                        ...exp,
                        category: e.target.value,
                        allocation_method: e.target.value === "Seguro" ? "monthly" : "immediate",
                      })
                    }
                    className="min-h-11 w-full min-w-0 rounded-md border border-input bg-background px-3 text-base sm:text-sm"
                  >
                    {CATEGORIES.map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </select>
                </div>
                <div className="col-span-2 space-y-2">
                  <Label htmlFor="finance-allocation" className="text-xs">
                    Como considerar no lucro
                  </Label>
                  <select
                    id="finance-allocation"
                    value={exp.allocation_method ?? "immediate"}
                    onChange={(e) =>
                      setExp({
                        ...exp,
                        allocation_method: e.target.value as "immediate" | "monthly",
                      })
                    }
                    className="min-h-11 w-full min-w-0 rounded-md border border-input bg-background px-3 text-base sm:text-sm"
                  >
                    <option value="immediate">Valor integral na data</option>
                    <option value="monthly">Diluir até o próximo vencimento mensal</option>
                  </select>
                </div>
                <div className="col-span-2 space-y-2">
                  <Label htmlFor="finance-expense-date" className="text-xs">
                    Data
                  </Label>
                  <Input
                    aria-label="Data da despesa"
                    id="finance-expense-date"
                    type="date"
                    value={exp.occurred_at}
                    onChange={(e) => setExp({ ...exp, occurred_at: e.target.value })}
                  />
                </div>
                <Text
                  label="Valor (R$)"
                  value={exp.amount}
                  onChange={(v) => setExp({ ...exp, amount: v })}
                />
                <Text
                  label="Descrição"
                  value={exp.description}
                  onChange={(v) => setExp({ ...exp, description: v })}
                />
                {(exp.allocation_method ?? "immediate") === "monthly" ? (
                  <p className="col-span-2 rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
                    O valor será diluído diariamente desta data até o mesmo dia do próximo mês. Esta
                    opção funciona para qualquer categoria atual ou adicionada futuramente.
                  </p>
                ) : null}
                <Button
                  type="submit"
                  disabled={addExpense.isPending}
                  className="col-span-2 min-h-11"
                >
                  {addExpense.isPending ? "Salvando…" : "Salvar despesa"}
                </Button>
              </form>
              <h3 className="mt-5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Registros recentes no período
              </h3>
              <ul className="mt-2 divide-y divide-border">
                {perExpenses.slice(0, 6).map((x) => (
                  <li
                    key={x.id}
                    className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm"
                  >
                    <span className="text-muted-foreground">
                      {dateLabel(x.occurred_at)} · {x.category}
                      {x.allocation_method === "monthly" ? " · diluída mensalmente" : ""}
                    </span>
                    <span className="flex items-center gap-2 font-medium tabular-nums">
                      {brl(Number(x.amount))}
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Excluir despesa de ${x.category}`}
                        onClick={() => delExpense.mutate(x.id)}
                      >
                        <Trash2 className="size-4 text-destructive" />
                      </Button>
                    </span>
                  </li>
                ))}
              </ul>
              {!perExpenses.length ? (
                <EmptyState>Nenhuma despesa em {period.label.toLowerCase()}.</EmptyState>
              ) : null}
            </SectionCard>
          </div>

          <details className="surface-card mt-4 min-w-0 p-4">
            <summary className="min-h-11 cursor-pointer text-sm font-medium">
              Receita e bonificações · ver composição
            </summary>
            <BonusIncome
              from={period.fromDate}
              to={period.toDate}
              deliveryRevenue={cashBase.revenue}
            />
          </details>
        </TabsContent>
        <TabsContent value="jornada" forceMount className="data-[state=inactive]:hidden">
          <FinanceJourney
            from={period.fromDate}
            to={period.toDate}
            lastOdometer={lastOdometer}
            onOdometer={fillOdometer}
          />
        </TabsContent>
        <TabsContent value="veiculo" forceMount className="data-[state=inactive]:hidden">
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
              <div className="min-w-0 space-y-2">
                <Label htmlFor="finance-efficiency" className="text-xs">
                  Consumo médio (km/L)
                </Label>
                <Input
                  id="finance-efficiency"
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
        </TabsContent>
      </Tabs>
    </AppShell>
  );
}

function Text({
  label,
  value,
  onChange,
  inputId,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  inputId?: string;
}) {
  const generatedId = useId();
  const id = inputId ?? generatedId;
  return (
    <div className="min-w-0 space-y-2">
      <Label htmlFor={id} className="text-xs">
        {label}
      </Label>
      <Input
        id={id}
        inputMode={label === "Descrição" ? "text" : "decimal"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}
