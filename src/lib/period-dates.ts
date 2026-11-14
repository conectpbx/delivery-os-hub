import { periodRange, type Period } from "./metrics";
const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export function presetDates(p: Period, now = new Date()) {
  const { from, to } = periodRange(p, now);
  const start = from;
  return { from: iso(start), to: iso(to) };
}
