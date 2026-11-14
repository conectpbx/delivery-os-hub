import assert from "node:assert/strict";
import test from "node:test";
import {
  decimalInput,
  maintenanceValues,
  fuelReceiptValues,
  changePeriodDate,
} from "./form-values";
import { minutesLabel } from "./format";
import { presetDates } from "./period-dates";
import { PERIODS } from "./metrics";

const form = {
  service_type: "Troca de óleo",
  cost: "125,50",
  odometer: "12.000",
  notes: " oficina ",
  performed_at: "2026-11-13",
  next_due_date: "2027-01-13",
  next_due_km: "15.000",
};
test("maintenance preview and saved values use the same Brazilian decimal convention", () => {
  const values = maintenanceValues(form);
  assert.equal(values.cost, 125.5);
  assert.equal(values.odometer, 12000);
  assert.equal(values.next_due_km, 15000);
  assert.equal(values.description, "oficina");
  assert.equal(decimalInput("R$ 1.234,56", "valor"), 1234.56);
  assert.equal(decimalInput("12.50", "valor"), 12.5);
  for (const value of ["", "abc", "1,2,3", "-1", "Infinity", "1e8"])
    assert.throws(() => decimalInput(value, "valor"));
  assert.throws(() => maintenanceValues({ ...form, next_due_km: "11.000" }), /maior/);
  assert.throws(() => maintenanceValues({ ...form, next_due_date: "2026-10-01" }), /anterior/);
});
test("fuel receipt review preserves decimal commas and rejects invalid extracted/manual amounts", () => {
  const values = fuelReceiptValues({
    liters: "10,5",
    price_per_liter: "5,99",
    total: "",
    station: " Posto A ",
  });
  assert.equal(values.liters, 10.5);
  assert.equal(values.price_per_liter, 5.99);
  assert.equal(values.total, 62.9);
  assert.equal(values.station, "Posto A");
  const ocr = fuelReceiptValues({
    liters: "1.234",
    price_per_liter: "5.999",
    total: "",
    station: "",
  });
  assert.equal(ocr.liters, 1.234);
  assert.equal(ocr.price_per_liter, 5.999);
  assert.equal(ocr.total, 7.4);
  assert.throws(() =>
    fuelReceiptValues({ liters: "0", price_per_liter: "5", total: "5", station: "" }),
  );
});
test("shared date selection cannot produce inverted or impossible date ranges", () => {
  const dates = { from: "2026-11-01", to: "2026-11-13" };
  assert.deepEqual(changePeriodDate(dates, "from", "2026-12-01"), {
    from: "2026-12-01",
    to: "2026-12-01",
  });
  assert.deepEqual(changePeriodDate(dates, "to", "2026-10-01"), {
    from: "2026-10-01",
    to: "2026-10-01",
  });
  assert.equal(changePeriodDate(dates, "from", "2026-02-30"), dates);
  assert.equal(changePeriodDate(dates, "to", ""), dates);
  assert.deepEqual(changePeriodDate(dates, "from", "2024-02-29"), {
    from: "2024-02-29",
    to: dates.to,
  });
  const all = presetDates(
    PERIODS.find((period) => period.key === "all")!,
    new Date(2026, 10, 13),
  );
  assert.ok(all.from < "2020-01-01", "Tudo includes older records");
});
test("shared duration labels round once and never display 60 remainder minutes", () => {
  assert.equal(minutesLabel(59.6), "1h 0min");
  assert.equal(minutesLabel(119.6), "2h 0min");
  assert.equal(minutesLabel(-2), "0min");
  assert.equal(minutesLabel(NaN), "0min");
  assert.equal(minutesLabel(75), "1h 15min");
});
