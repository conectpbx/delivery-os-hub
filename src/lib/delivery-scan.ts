import { z } from "zod";
const text = (max: number) => z.string().trim().min(1).max(max).nullable().optional();
const amount = z.number().finite().min(0).lt(1e9).nullable().optional();
export const deliveryScanSchema = z.object({
  appName: text(100),
  gross: amount,
  feeAmount: amount,
  feePercent: z.number().finite().min(0).max(100).nullable().optional(),
  pickupAddress: text(500),
  dropoffAddress: text(500),
});
export type DeliveryScan = z.infer<typeof deliveryScanSchema>;
export type DeliveryScanResult = DeliveryScan & { remaining: number };
export function parseDeliveryScan(raw: string): DeliveryScan {
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match)
    throw new Error(
      "Não foi possível identificar os dados. Tente outra imagem ou preencha manualmente.",
    );
  let value: unknown;
  try {
    value = JSON.parse(match[0]);
  } catch {
    throw new Error(
      "Não foi possível interpretar a leitura. Tente outra imagem ou preencha manualmente.",
    );
  }
  const parsed = deliveryScanSchema.safeParse(value);
  if (!parsed.success)
    throw new Error(
      "A leitura retornou dados inválidos. Confira a imagem ou preencha manualmente.",
    );
  return parsed.data;
}
export function reviewedDeliveryFee(
  gross: number,
  feeAmount: number | null,
  feePercent: number | null,
) {
  if (feeAmount !== null) {
    if (!Number.isFinite(feeAmount) || feeAmount < 0 || feeAmount > gross || gross <= 0)
      throw new Error("A taxa deve estar entre zero e o valor bruto");
    return Math.round((feeAmount / gross) * 10000) / 100;
  }
  if (feePercent !== null && (!Number.isFinite(feePercent) || feePercent < 0 || feePercent > 100))
    throw new Error("Confira a taxa percentual");
  return feePercent;
}
