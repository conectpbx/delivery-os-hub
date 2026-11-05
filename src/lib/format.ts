const currencyFormatter = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const numberFormatters = new Map<number, Intl.NumberFormat>();
const shortDateFormatter = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit" });
const dateTimeFormatter = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});
const monthFormatter = new Intl.DateTimeFormat("pt-BR", { month: "short", year: "numeric" });

export const brl = (v: number) => currencyFormatter.format(Number.isFinite(v) ? v : 0);
export const num = (v: number, digits = 1) => {
  let formatter = numberFormatters.get(digits);
  if (!formatter) {
    formatter = new Intl.NumberFormat("pt-BR", {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    });
    numberFormatters.set(digits, formatter);
  }
  return formatter.format(Number.isFinite(v) ? v : 0);
};

/** Data civil local, sem passar por UTC (evita exibir o dia anterior no Brasil). */
export const localDateValue = (date = new Date()) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

export function parseDateValue(value: string) {
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})(?:$|T00:00:00(?:\.000)?Z$)/.exec(value);
  if (dateOnly) {
    const [, year, month, day] = dateOnly;
    return new Date(Number(year), Number(month) - 1, Number(day));
  }
  return new Date(value);
}

export const dateLabel = (iso: string) => {
  const date = parseDateValue(iso);
  return Number.isNaN(date.getTime()) ? "Invalid Date" : shortDateFormatter.format(date);
};
export const dateTimeLabel = (iso: string) => {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "Invalid Date" : dateTimeFormatter.format(date);
};

export const monthKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;

export const monthLabel = (key: string) => {
  const [y, m] = key.split("-").map(Number);
  return monthFormatter.format(new Date(y!, (m ?? 1) - 1, 1));
};

export const minutesLabel = (min: number) => {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return h > 0 ? `${h}h ${m}min` : `${m}min`;
};

export const paymentMethodLabel = (method: string | null | undefined) => {
  if (method === "pix") return "Pix";
  if (method === "dinheiro") return "Dinheiro";
  return "Crédito";
};

/** Neutralize spreadsheet formulas in user text; keep actual numeric cells numeric. */
export function csvCell(cell: string | number): string {
  let value = String(cell ?? "");
  if (typeof cell === "string" && /^[\s\uFEFF]*[=+@-]/u.test(value)) value = "'" + value;
  return /[";\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function downloadCsv(filename: string, rows: (string | number)[][]) {
  const csv = rows.map((row) => row.map(csvCell).join(";")).join("\n");
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** Converte texto com vírgula decimal (pt-BR) ou ponto decimal em número. */
export function dec(v: string | number | null | undefined): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (!v) return 0;
  let s = String(v)
    .trim()
    .replace(/[^\d.,-]/g, "");
  if (s.includes(",")) {
    // vírgula é o separador decimal → pontos são milhar
    s = s.replace(/\./g, "").replace(",", ".");
  } else {
    // sem vírgula: ponto só é milhar se houver grupos de 3 dígitos (ex.: 1.234.567)
    const isThousands = /^-?\d{1,3}(\.\d{3})+$/.test(s);
    if (isThousands) s = s.replace(/\./g, "");
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}
