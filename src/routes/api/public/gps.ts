import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const payloadSchema = z.object({
  source: z.string().trim().min(1).max(80),
  latitude: z.number().finite().min(-90).max(90),
  longitude: z.number().finite().min(-180).max(180),
  accuracy_m: z.number().finite().min(0).max(10_000),
  speed_kmh: z.number().finite().min(0).max(500),
  trip_km: z.number().finite().min(0).max(1_000_000),
  total_km: z.number().finite().min(0).max(10_000_000),
  captured_at: z.union([z.number().int().positive(), z.string().datetime()]),
  sent_at: z.union([z.number().int().positive(), z.string().datetime()]),
});

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Cache-Control": "no-store",
};

function json(body: Record<string, unknown>, status: number) {
  return Response.json(body, { status, headers: corsHeaders });
}

function timestamp(value: number | string) {
  const date = new Date(typeof value === "number" ? value : value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export const Route = createFileRoute("/api/public/gps")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: corsHeaders }),
      POST: async ({ request }) => {
        const contentLength = Number(request.headers.get("content-length") ?? 0);
        if (contentLength > 16_384)
          return json({ accepted: false, error: "payload_too_large" }, 413);

        const authorization = request.headers.get("authorization") ?? "";
        const match = authorization.match(/^Bearer\s+(dos_gps_[a-f0-9]{64})$/i);
        if (!match?.[1]) return json({ accepted: false, error: "unauthorized" }, 401);

        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return json({ accepted: false, error: "invalid_json" }, 400);
        }
        const parsed = payloadSchema.safeParse(body);
        if (!parsed.success) return json({ accepted: false, error: "invalid_payload" }, 400);

        const capturedAt = timestamp(parsed.data.captured_at);
        const sentAt = timestamp(parsed.data.sent_at);
        if (!capturedAt || !sentAt)
          return json({ accepted: false, error: "invalid_timestamp" }, 400);

        const now = Date.now();
        const capturedMs = Date.parse(capturedAt);
        if (capturedMs > now + 5 * 60_000 || capturedMs < now - 30 * 24 * 60 * 60_000) {
          return json({ accepted: false, error: "timestamp_out_of_range" }, 400);
        }

        let data: unknown;
        try {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const rpcResult = await supabaseAdmin.rpc("ingest_gps_device_state", {
            _token_hash: await sha256(match[1]),
            _source: parsed.data.source,
            _latitude: parsed.data.latitude,
            _longitude: parsed.data.longitude,
            _accuracy_m: parsed.data.accuracy_m,
            _speed_kmh: parsed.data.speed_kmh,
            _trip_km: parsed.data.trip_km,
            _total_km: parsed.data.total_km,
            _captured_at: capturedAt,
            _sent_at: sentAt,
          });

          if (rpcResult.error) {
            console.error("GPS ingest failed", rpcResult.error.code);
            return json({ accepted: false, error: "temporarily_unavailable" }, 503);
          }

          data = rpcResult.data;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          console.error("GPS server configuration failed", message);

          if (
            message.includes("SUPABASE_URL") ||
            message.includes("SUPABASE_SERVICE_ROLE_KEY")
          ) {
            return json({ accepted: false, error: "server_misconfigured" }, 503);
          }

          return json({ accepted: false, error: "server_error" }, 503);
        }

        const result = data as { accepted?: boolean; reason?: string } | null;
        if (result?.reason === "unauthorized")
          return json({ accepted: false, error: "unauthorized" }, 401);
        if (result?.reason === "stale")
          return json({ accepted: false, error: "stale_reading" }, 409);
        return json({ accepted: true }, 202);
      },
    },
  },
});
