import assert from "node:assert/strict";
import test from "node:test";
import type { Maintenance } from "./data";
import { buildMaintenanceAlerts } from "./alerts";
import { maintenanceReservePerKm } from "./metrics";

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
      maintenance({ id: "vencida", next_due_date: "2026-09-16" }),
      maintenance({ id: "proxima", next_due_date: "2026-09-22" }),
      maintenance({ id: "futura", next_due_date: "2026-10-18" }),
      maintenance({ id: "sem-data", next_due_date: null }),
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
      maintenance({ id: "oleo-antigo", service_type: "Troca de óleo", performed_at: "2026-01-10", next_due_date: "2026-06-10" }),
      maintenance({ id: "oleo-novo", service_type: "  TROCA DE OLEO ", performed_at: "2026-09-17", next_due_date: "2026-12-17" }),
    ],
    new Date(2026, 8, 18, 12),
  );

  assert.deepEqual(alerts.map((alert) => alert.id), ["manut-agendada-oleo-novo"]);
});