/** Recorded kilometres are the shared basis for financial metrics; maps are a separate estimate. */
export function recordedDistanceKm(value: unknown): number {
  if ((typeof value !== "number" && typeof value !== "string") || value === "") return 0;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : 0;
}
export function completionDistanceKm(recorded: unknown, estimated?: number | null): number {
  const saved = recordedDistanceKm(recorded);
  return saved > 0 ? saved : recordedDistanceKm(estimated);
}

/** Entry modes change visible fields, never discard a reviewed distance. */
export function deliveryEntryDistance(value: string): number {
  const normalized = value.trim().replace(",", ".");
  const distance = normalized === "" ? 0 : Number(normalized);
  if (!Number.isFinite(distance) || distance < 0)
    throw new Error("Informe uma distância válida, em quilômetros.");
  return distance;
}
