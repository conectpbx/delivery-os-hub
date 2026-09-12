import assert from "node:assert/strict";
import test from "node:test";
import type { Maintenance } from "./data";
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