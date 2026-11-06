import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const Input = z.object({
  imageBase64: z.string().min(20).max(8_000_000),
  mimeType: z.enum(["image/jpeg", "image/png", "image/webp"]),
});

export type ScanResult = {
  liters: number | null;
  pricePerLiter: number | null;
  total: number | null;
  station: string | null;
  date: string | null;
  raw: string;
  remaining: number;
};

/** Limite diário de leituras por usuário (controle de consumo de IA). */
export const DAILY_SCAN_LIMIT = 15;

/** Modelo econômico/gratuito do gateway — menor custo por leitura. */
const AI_MODEL = "google/gemini-3.6-flash-lite";

export const scanFuelReceipt = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => Input.parse(input))
  .handler(async ({ data, context }): Promise<ScanResult> => {
    const key = process.env["LOVABLE_API_KEY"];
    if (!key) throw new Error("IA indisponível no momento.");

    // Consome a cota ANTES de chamar a IA (atômico no banco, por usuário/dia).
    const { data: used, error: quotaError } = await context.supabase.rpc(
      "consume_ai_scan_quota",
      { _limit: DAILY_SCAN_LIMIT },
    );
    if (quotaError) throw new Error("Não foi possível validar seu limite de leituras.");
    if (typeof used !== "number" || used < 0)
      throw new Error(
        `Você atingiu o limite de ${DAILY_SCAN_LIMIT} leituras de IA hoje. Preencha manualmente ou tente amanhã.`,
      );
    const remaining = Math.max(0, DAILY_SCAN_LIMIT - used);

    let response: Response;
    try {
      response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify({
          model: AI_MODEL,
          max_tokens: 220,
          temperature: 0,
          messages: [
            {
              role: "system",
              content:
                'Você extrai dados de cupons fiscais de abastecimento brasileiros. Responda apenas com JSON válido no formato {"liters":number|null,"pricePerLiter":number|null,"total":number|null,"station":string|null,"date":"YYYY-MM-DD"|null}. Use ponto como separador decimal.',
            },
            {
              role: "user",
              content: [
                { type: "text", text: "Extraia os dados deste cupom de abastecimento." },
                {
                  type: "image_url",
                  image_url: { url: `data:${data.mimeType};base64,${data.imageBase64}` },
                },
              ],
            },
          ],
        }),
        signal: AbortSignal.timeout(30000),
      });
    } catch {
      throw new Error("A IA não respondeu a tempo. Tente novamente.");
    }

    if (response.status === 429)
      throw new Error("Limite de uso da IA atingido. Tente novamente em instantes.");
    if (response.status === 402)
      throw new Error("Créditos de IA esgotados. Adicione créditos para continuar.");
    if (!response.ok) {
      console.error(`AI gateway error [${response.status}]`);
      throw new Error("Não foi possível ler o cupom agora.");
    }

    const json = (await response.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const raw = json.choices?.[0]?.message?.content ?? "";
    const match = raw.match(/\{[\s\S]*\}/);
    let parsed: Partial<ScanResult> = {};
    if (match) {
      try {
        parsed = JSON.parse(match[0]) as Partial<ScanResult>;
      } catch {
        parsed = {};
      }
    }

    return {
      liters: numberOrNull(parsed.liters),
      pricePerLiter: numberOrNull(parsed.pricePerLiter),
      total: numberOrNull(parsed.total),
      station: typeof parsed.station === "string" ? parsed.station : null,
      date: typeof parsed.date === "string" ? parsed.date : null,
      raw,
      remaining,
    };

  });

function numberOrNull(v: unknown) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export type RideScanResult = {
  app: string | null;
  gross: number | null;
  tip: number | null;
  distanceKm: number | null;
  durationMin: number | null;
  remaining: number;
};

/** Lê o print de uma corrida (app de entrega) — usa a mesma cota diária. */
export const scanRideScreenshot = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => Input.parse(input))
  .handler(async ({ data, context }): Promise<RideScanResult> => {
    const key = process.env["LOVABLE_API_KEY"];
    if (!key) throw new Error("IA indisponível no momento.");
    const { data: used, error: quotaError } = await context.supabase.rpc(
      "consume_ai_scan_quota",
      { _limit: DAILY_SCAN_LIMIT },
    );
    if (quotaError) throw new Error("Não foi possível validar seu limite de leituras.");
    if (typeof used !== "number" || used < 0)
      throw new Error(`Você atingiu o limite de ${DAILY_SCAN_LIMIT} leituras de IA hoje.`);
    const remaining = Math.max(0, DAILY_SCAN_LIMIT - used);
    let response: Response;
    try {
      response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body: JSON.stringify({
          model: AI_MODEL,
          max_tokens: 160,
          temperature: 0,
          messages: [
            {
              role: "system",
              content:
                'Você extrai dados de prints de corridas de apps de entrega brasileiros (iFood, Rappi, Uber, 99, Lalamove etc.). Responda apenas JSON: {"app":string|null,"gross":number|null,"tip":number|null,"distanceKm":number|null,"durationMin":number|null}. gross = valor da corrida sem gorjeta. Ponto decimal.',
            },
            {
              role: "user",
              content: [
                { type: "text", text: "Extraia os dados desta corrida." },
                { type: "image_url", image_url: { url: `data:${data.mimeType};base64,${data.imageBase64}` } },
              ],
            },
          ],
        }),
        signal: AbortSignal.timeout(30000),
      });
    } catch {
      throw new Error("A IA não respondeu a tempo. Tente novamente.");
    }
    if (response.status === 429) throw new Error("Limite de uso da IA atingido. Tente em instantes.");
    if (response.status === 402) throw new Error("Créditos de IA esgotados.");
    if (!response.ok) throw new Error("Não foi possível ler o print agora.");
    const json = (await response.json()) as { choices?: { message?: { content?: string } }[] };
    const raw = json.choices?.[0]?.message?.content ?? "";
    let p: Record<string, unknown> = {};
    const m = raw.match(/\{[\s\S]*\}/);
    if (m) {
      try {
        p = JSON.parse(m[0]) as Record<string, unknown>;
      } catch {
        p = {};
      }
    }
    return {
      app: typeof p.app === "string" ? p.app : null,
      gross: numberOrNull(p.gross),
      tip: numberOrNull(p.tip),
      distanceKm: numberOrNull(p.distanceKm),
      durationMin: numberOrNull(p.durationMin),
      remaining,
    };
  });
