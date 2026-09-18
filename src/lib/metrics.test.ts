import assert from "node:assert/strict";
import test from "node:test";
import type { Expense, Maintenance } from "./data";
import { buildMaintenanceAlerts } from "./alerts";
import { maintenanceReservePerKm, nextMonthlyDueDate, proratedExpenseTotal } from "./metrics";

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
  assert.equal(proratedExpenseTotal(expenses, new Date(2026, 8, 10), new Date(2026, 8, 10)), 10);
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
