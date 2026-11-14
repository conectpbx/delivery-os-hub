import { dec } from "./format";

export function decimalInput(
  value: string,
  label: string,
  positive = false,
  dotDecimal = false,
): number {
  const text = value
    .trim()
    .replace(/^R\$\s*/, "")
    .replace(/\s/g, "");
  if (!/^-?(?:\d+(?:\.\d{3})*(?:,\d+)?|\d+(?:\.\d+)?)$/.test(text))
    throw new Error(`Confira ${label}: informe um número válido.`);
  const number = dotDecimal && !text.includes(",") ? Number(text) : dec(text);
  if (!Number.isFinite(number) || number < 0 || number >= 1e9 || (positive && number === 0))
    throw new Error(
      `Confira ${label}: informe um valor ${positive ? "maior que zero" : "igual ou maior que zero"}.`,
    );
  return number;
}
export function civilDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(y!, m! - 1, d!);
  return date.getFullYear() === y && date.getMonth() === m! - 1 && date.getDate() === d;
}
export function maintenanceValues(form: {
  service_type: string;
  cost: string;
  odometer: string;
  notes: string;
  performed_at: string;
  next_due_date: string;
  next_due_km: string;
}) {
  const cost = decimalInput(form.cost, "o custo");
  const odometer = form.odometer.trim() ? decimalInput(form.odometer, "o odômetro") : null;
  const next = form.next_due_km.trim()
    ? decimalInput(form.next_due_km, "a próxima quilometragem")
    : null;
  if (next !== null && odometer !== null && next <= odometer)
    throw new Error("A próxima quilometragem deve ser maior que o odômetro atual.");
  if (!civilDate(form.performed_at) || (form.next_due_date && !civilDate(form.next_due_date)))
    throw new Error("Confira as datas do serviço.");
  if (form.next_due_date && form.next_due_date < form.performed_at)
    throw new Error("A próxima data não pode ser anterior ao serviço.");
  return {
    service_type: form.service_type,
    cost,
    odometer,
    description: form.notes.trim() || null,
    performed_at: form.performed_at,
    next_due_date: form.next_due_date || null,
    next_due_km: next,
  };
}
export function fuelReceiptValues(form: {
  liters: string;
  price_per_liter: string;
  total: string;
  station: string;
}) {
  const liters = decimalInput(form.liters, "os litros", true, true);
  const price = decimalInput(form.price_per_liter, "o preço por litro", true, true);
  const total = decimalInput(
    form.total.trim() || String(Math.round(liters * price * 100) / 100),
    "o total",
    true,
  );
  return { liters, price_per_liter: price, total, station: form.station.trim() || null };
}
export function changePeriodDate(
  dates: { from: string; to: string },
  field: "from" | "to",
  value: string,
) {
  if (!civilDate(value)) return dates;
  return field === "from"
    ? { from: value, to: value > dates.to ? value : dates.to }
    : { from: value < dates.from ? value : dates.from, to: value };
}
