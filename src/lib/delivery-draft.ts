import { z } from "zod";

const text = z.string().catch("");
export const deliveryFormDraft = z.object({
  app_name: text,
  earnings: text,
  fee_percent: text,
  fee_amount: text,
  tip: text,
  payment_method: z.enum(["credito", "pix", "dinheiro"]).catch("credito"),
  distance_km: text,
  duration_min: text,
  idle_min: text,
});
const coordinate = z.number().finite().nullable();
export const deliveryStopsDraft = z.array(
  z.object({
    id: z.string(),
    kind: z.enum(["coleta", "entrega"]),
    address: text,
    lat: coordinate,
    lng: coordinate,
    recorded_at: z.string().optional(),
  }),
);
export const deliveryModeDraft = z.enum(["quick", "full"]);
export const deliveryBaselineDraft = z
  .object({
    journeyId: z.string(),
    distanceKm: z.number().finite().nonnegative(),
    at: z.string().datetime(),
  })
  .nullable();
export const deliveryStartedDraft = z.string().datetime().nullable();
export const deliveryFinishingDraft = z
  .object({ id: z.string(), stops: deliveryStopsDraft })
  .nullable();
