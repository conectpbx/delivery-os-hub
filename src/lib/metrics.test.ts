import assert from "node:assert/strict";
import test from "node:test";
import type { Delivery, Expense, Fueling, Goal, Maintenance, Profile } from "./data";
import { buildMaintenanceAlerts } from "./alerts";
import {
  adaptiveDailyRevenueGoal,
  goalPerformanceAnalysis,
  maintenanceReservePerKm,
  nextMonthlyDueDate,
  proratedExpenseTotal,
  reportBreakdown,
  summarizeOperational,
  summarizeRecordedCosts,
  currentRevenueTarget,
} from "./metrics";

const maintenance = (values: Partial<Maintenance>): Maintenance => ({
  id: "id",
  service_type: "Troca de óleo",
  description: null,
  cost: 150,
  odometer: 10_000,
  performed_at: "2026-09-01",
  next_due_date: null,
  next_due_km: 15_000,
  status: "concluida",
  ...values,
});

test("dilui o custo pelo intervalo de quilometragem", () => {
  const result = maintenanceReservePerKm([maintenance({})]);
  assert.equal(result.costPerKm, 0.03);
  assert.equal(result.items[0]?.intervalKm, 5_000);
});

test("separa registros sem intervalo válido", () => {
  const result = maintenanceReservePerKm([maintenance({ next_due_km: null })]);
  assert.equal(result.costPerKm, 0);
  assert.equal(result.incomplete.length, 1);
});

test("dilui manutenção por dias quando não há intervalo em km", () => {
  const result = maintenanceReservePerKm([
    maintenance({ next_due_km: null, performed_at: "2026-09-01", next_due_date: "2026-10-01" }),
  ]);
  assert.equal(result.costPerKm, 0);
  assert.equal(result.costPerDay, 5);
  assert.equal(result.items[0]?.basis, "day");
});

const expense = (values: Partial<Expense>): Expense => ({
  id: "expense-id",
  category: "Seguro",
  description: null,
  amount: 300,
  occurred_at: "2026-09-10",
  ...values,
});

test("dilui seguro nos dias até o próximo vencimento mensal", () => {
  const expenses = [expense({})];
  assert.equal(proratedExpenseTotal(expenses, new Date(2026, 8, 10), new Date(2026, 8, 19)), 100);
  assert.equal(proratedExpenseTotal(expenses, new Date(2026, 8, 1), new Date(2026, 8, 30)), 210);
});

test("preserva o vencimento mensal no último dia para meses mais curtos", () => {
  const next = nextMonthlyDueDate(new Date(2026, 0, 31));
  assert.equal(next.getFullYear(), 2026);
  assert.equal(next.getMonth(), 1);
  assert.equal(next.getDate(), 28);
});

test("mantém despesas não recorrentes integralmente no dia do lançamento", () => {
  const expenses = [expense({ category: "Pedágio", amount: 25 })];
  assert.equal(proratedExpenseTotal(expenses, new Date(2026, 8, 10), new Date(2026, 8, 10)), 25);
  assert.equal(proratedExpenseTotal(expenses, new Date(2026, 8, 11), new Date(2026, 8, 20)), 0);
});

test("permite diluir qualquer categoria e mantém compatibilidade com novas categorias", () => {
  const expenses = [
    expense({
      category: "Licenciamento especial",
      allocation_method: "monthly",
      amount: 310,
    }),
  ];
  assert.equal(
    proratedExpenseTotal(expenses, new Date(2026, 8, 10), new Date(2026, 8, 10)),
    310 / 30,
  );
});

test("permite lançar seguro integralmente quando o usuário escolher", () => {
  const expenses = [expense({ allocation_method: "immediate" })];
  assert.equal(proratedExpenseTotal(expenses, new Date(2026, 8, 10), new Date(2026, 8, 10)), 300);
});

test("usa apenas o ciclo mais recente do mesmo serviço", () => {
  const result = maintenanceReservePerKm([
    maintenance({ id: "antigo", performed_at: "2026-01-01", cost: 100 }),
    maintenance({ id: "novo", performed_at: "2026-09-01", cost: 200 }),
  ]);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0]?.maintenance.id, "novo");
  assert.equal(result.costPerKm, 0.04);
});

test("gera alertas para manutenções vencidas, próximas e futuras", () => {
  const reference = new Date(2026, 8, 18, 12);
  const alerts = buildMaintenanceAlerts(
    [
      maintenance({ id: "vencida", service_type: "Troca de óleo", next_due_date: "2026-09-16" }),
      maintenance({ id: "proxima", service_type: "Freios", next_due_date: "2026-09-22" }),
      maintenance({ id: "futura", service_type: "Pneus", next_due_date: "2026-10-18" }),
      maintenance({ id: "sem-data", service_type: "Revisão geral", next_due_date: null }),
    ],
    reference,
  );

  assert.deepEqual(
    alerts.map((alert) => alert.id),
    ["manut-atrasada-vencida", "manut-proxima-proxima", "manut-agendada-futura"],
  );
});

test("encerra o alerta vencido quando o mesmo serviço foi realizado novamente", () => {
  const alerts = buildMaintenanceAlerts(
    [
      maintenance({
        id: "oleo-antigo",
        service_type: "Troca de óleo",
        performed_at: "2026-01-10",
        next_due_date: "2026-06-10",
      }),
      maintenance({
        id: "oleo-novo",
        service_type: "  TROCA DE OLEO ",
        performed_at: "2026-09-17",
        next_due_date: "2026-12-17",
      }),
    ],
    new Date(2026, 8, 18, 12),
  );

  assert.deepEqual(
    alerts.map((alert) => alert.id),
    ["manut-agendada-oleo-novo"],
  );
});

const goal = (month: string, target: number): Goal => ({
  id: "goal-id",
  month,
  revenue_target: target,
  profit_target: 0,
  deliveries_target: 0,
});

const profile: Profile = {
  id: "profile-id",
  full_name: null,
  vehicle: null,
  fuel_efficiency: 12,
  daily_goal: 200,
  monthly_goal: 0,
};

const delivery = (id: string, occurredAt: string, earnings = 100): Delivery => ({
  id,
  app_name: "App",
  earnings,
  tip: 0,
  distance_km: 5,
  duration_min: 20,
  payment_method: "pix",
  idle_min: 0,
  pickup_address: null,
  dropoff_address: null,
  lat: null,
  lng: null,
  occurred_at: occurredAt,
});

test("meta inteligente usa todos os dias restantes sem histórico suficiente", () => {
  const result = adaptiveDailyRevenueGoal({
    deliveries: [],
    goals: [goal("2026-09-01", 1_100)],
    profile,
    date: new Date(2026, 8, 20, 12),
  });
  assert.equal(result.remainingDaysIncludingToday, 11);
  assert.equal(result.target, 100);
  assert.equal(result.usesWorkPattern, false);
});

test("meta inteligente distribui o restante pelos dias habituais de trabalho", () => {
  const historical = [
    "2026-07-07",
    "2026-07-08",
    "2026-07-09",
    "2026-07-10",
    "2026-07-14",
    "2026-07-15",
    "2026-07-16",
    "2026-07-17",
  ].map((date, index) => delivery(`history-${index}`, `${date}T12:00:00-03:00`));
  const result = adaptiveDailyRevenueGoal({
    deliveries: historical,
    goals: [goal("2026-09-01", 700)],
    profile,
    date: new Date(2026, 8, 21, 12),
  });
  assert.equal(result.usesWorkPattern, true);
  assert.equal(result.remainingDaysIncludingToday, 6);
  assert.equal(result.target, 700 / 6);
  assert.equal(result.isPlannedWorkday, false);
});

test("meta inteligente reinicia o progresso na virada do mês", () => {
  const result = adaptiveDailyRevenueGoal({
    deliveries: [delivery("setembro", "2026-09-30T23:30:00-03:00", 900)],
    goals: [goal("2026-10-01", 3_100)],
    profile,
    date: new Date(2026, 9, 1, 8),
  });
  assert.equal(result.revenueBeforeToday, 0);
  assert.equal(result.remainingBeforeToday, 3_100);
  assert.equal(result.remainingDaysIncludingToday, 31);
  assert.equal(result.target, 100);
});

test("análise de desempenho não carrega receita do mês anterior", () => {
  const result = goalPerformanceAnalysis(
    [
      delivery("agosto", "2026-08-15T12:00:00-03:00", 620),
      delivery("setembro", "2026-09-30T23:30:00-03:00", 3_000),
      delivery("outubro", "2026-10-01T08:00:00-03:00", 100),
    ],
    new Date(2026, 9, 1, 12),
  );
  assert.equal(result.currentRevenue, 100);
  assert.equal(result.projectedRevenue, 3_100);
  assert.equal(result.previousAverageRevenue, 1_810);
  assert.equal(result.completedMonths, 2);
});

test("detalhamento diário reúne operação e custos pagos no mesmo dia", () => {
  const deliveries = [
    { ...delivery("uma", "2026-09-14T10:00:00-03:00", 100), distance_km: 20, duration_min: 90 },
    { ...delivery("duas", "2026-09-14T18:00:00-03:00", 50), distance_km: 10, duration_min: 30 },
  ];
  const fuelings: Fueling[] = [
    {
      id: "fuel",
      liters: 5,
      price_per_liter: 6,
      total: 30,
      odometer: null,
      station: null,
      occurred_at: "2026-09-14T19:00:00-03:00",
    },
  ];

  const [row] = reportBreakdown(
    deliveries,
    [expense({ category: "Pedágio", occurred_at: "2026-09-14", amount: 10 })],
    fuelings,
    [],
    "day",
  );

  assert.equal(row?.count, 2);
  assert.equal(row?.distance, 30);
  assert.equal(row?.workedMin, 120);
  assert.equal(row?.revenue, 150);
  assert.equal(row?.totalCost, 40);
  assert.equal(row?.profit, 110);
  assert.equal(row?.costPerKm, 40 / 30);
  assert.equal(row?.profitPerHour, 55);
});

test("detalhamento semanal começa na segunda e mantém semanas separadas", () => {
  const rows = reportBreakdown(
    [
      delivery("domingo", "2026-09-20T12:00:00-03:00", 80),
      delivery("segunda", "2026-09-21T12:00:00-03:00", 100),
    ],
    [],
    [],
    [],
    "week",
  );

  assert.equal(rows.length, 2);
  assert.equal(rows[0]?.key, "2026-09-21");
  assert.equal(rows[1]?.key, "2026-09-14");
});

test("abastecimento registrado de R$ 30 não é substituído pela estimativa de R$ 50", () => {
  const deliveries = [
    { ...delivery("entrega", "2026-09-14T10:00:00-03:00", 100), distance_km: 100 },
  ];
  const fuelings: Fueling[] = [
    {
      id: "abastecimento",
      liters: 5,
      price_per_liter: 6,
      total: 30,
      odometer: null,
      station: null,
      occurred_at: "2026-09-14T19:00:00-03:00",
    },
  ];
  const recorded = summarizeRecordedCosts(deliveries, [], [], fuelings);
  const estimated = summarizeOperational(deliveries, [], 0.5, 0);
  const [report] = reportBreakdown(deliveries, [], fuelings, [], "day");

  assert.equal(recorded.fuelCost, 30);
  assert.equal(recorded.profit, 70);
  assert.equal(estimated.fuelCost, 50);
  assert.equal(report?.fuelCost, recorded.fuelCost);
  assert.equal(report?.totalCost, 30);
});

test("custos registrados incluem abastecimentos mesmo sem entregas", () => {
  const recorded = summarizeRecordedCosts(
    [],
    [],
    [],
    [
      {
        id: "abastecimento",
        liters: 5,
        price_per_liter: 6,
        total: 30,
        odometer: null,
        station: null,
        occurred_at: "2026-09-14T19:00:00-03:00",
      },
    ],
  );

  assert.equal(recorded.fuelCost, 30);
  assert.equal(recorded.profit, -30);
});

test("preserva última meta de R$ 3000 na virada do mês em vez do padrão de R$ 5000", () => {
  const goals = [goal("2026-09-01", 3000), goal("2026-11-01", 9000)];
  assert.equal(
    currentRevenueTarget(goals, { ...profile, monthly_goal: 5000 }, new Date(2026, 9, 8)),
    3000,
  );
  assert.equal(
    currentRevenueTarget([...goals, goal("2026-10-01", 3500)], profile, new Date(2026, 9, 8)),
    3500,
  );
});

test("meta zero cadastrada não é substituída pelo padrão do perfil", () => {
  assert.equal(
    currentRevenueTarget(
      [goal("2026-10-01", 0)],
      { ...profile, monthly_goal: 5000 },
      new Date(2026, 9, 8),
    ),
    0,
  );
});

test("sugestão usa ritmo atual somente após oito dias ativos", () => {
  const deliveries = Array.from({ length: 8 }, (_, i) =>
    delivery(`d${i}`, `2026-10-${String(i + 1).padStart(2, "0")}T10:00:00`, 100),
  );
  const result = goalPerformanceAnalysis(deliveries, new Date(2026, 9, 8, 12));
  assert.equal(result.suggestedRevenueTarget, 3100);
  assert.equal(result.suggestionBasis, "current");
  assert.equal(
    goalPerformanceAnalysis(deliveries.slice(0, 7), new Date(2026, 9, 8, 12))
      .suggestedRevenueTarget,
    0,
  );
});

test("sugestão combina meses concluídos com ritmo atual sem aumentar 10% automaticamente", () => {
  const deliveries = Array.from({ length: 8 }, (_, i) =>
    delivery(`d${i}`, `2026-10-${String(i + 1).padStart(2, "0")}T10:00:00`, 100),
  );
  const result = goalPerformanceAnalysis(
    [delivery("past", "2026-09-15T12:00:00", 3000), ...deliveries],
    new Date(2026, 9, 8, 12),
  );
  assert.equal(result.suggestionBasis, "combined");
  assert.equal(result.suggestedRevenueTarget, 3100);
});
