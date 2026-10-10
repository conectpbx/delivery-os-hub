import { z } from "zod";

const gpsTimestamp = z.union([z.number().int().positive(), z.string().datetime({ offset: true })]);

export const gpsPayloadSchema = z.object({
  source: z.string().trim().min(1).max(80),
  latitude: z.number().finite().min(-90).max(90),
  longitude: z.number().finite().min(-180).max(180),
  accuracy_m: z.number().finite().min(0).max(10_000),
  speed_kmh: z.number().finite().min(0).max(500),
  trip_km: z.number().finite().min(0).max(1_000_000),
  total_km: z.number().finite().min(0).max(10_000_000),
  captured_at: gpsTimestamp,
  sent_at: gpsTimestamp,
});

export function gpsTimestampIso(value: number | string) {
  const date = new Date(typeof value === "number" && value < 10_000_000_000 ? value * 1000 : value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
