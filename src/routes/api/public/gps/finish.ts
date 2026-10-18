import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { publicSupabaseFetch } from "@/lib/public-supabase-fetch";

const finishSchema = z.object({
  route_id: z.string().uuid(),
  ended_at: z.union([z.number().int().positive(), z.string().datetime({ offset: true })]),
  end_total_km: z.number().finite().min(0).max(10_000_000),
  distance_km: z.number().finite().min(0).max(1_000_000),
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

async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function timestamp(value: number | string) {
  const date = new Date(typeof value === "number" && value < 10_000_000_000 ? value * 1000 : value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export const Route = createFileRoute("/api/public/gps/finish")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: corsHeaders }),
      POST: async ({ request }) => {
        const authorization = request.headers.get("authorization") ?? "";
        const match = authorization.match(/^Bearer\s+(dos_gps_[a-f0-9]{64})$/i);
        if (!match?.[1]) return json({ accepted: false, error: "unauthorized" }, 401);

        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return json({ accepted: false, error: "invalid_json" }, 400);
        }

        const parsed = finishSchema.safeParse(body);
        if (!parsed.success) return json({ accepted: false, error: "invalid_payload" }, 400);

        const endedAt = timestamp(parsed.data.ended_at);
        if (!endedAt) return json({ accepted: false, error: "invalid_timestamp" }, 400);

        try {
          const { createClient } = await import("@supabase/supabase-js");
          const url = process.env["SUPABASE_URL"] || import.meta.env["VITE_SUPABASE_URL"];
          const key =
            process.env["SUPABASE_PUBLISHABLE_KEY"] ||
            import.meta.env["VITE_SUPABASE_PUBLISHABLE_KEY"];

          if (!url || !key) return json({ accepted: false, error: "server_misconfigured" }, 503);

          const client = createClient(url, key, {
            global: { fetch: publicSupabaseFetch(key) },
            auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
          });

          const { data, error } = await client.rpc("finish_gps_route_session", {
            _route_id: parsed.data.route_id,
            _token_hash: await sha256(match[1]),
            _ended_at: endedAt,
            _end_total_km: parsed.data.end_total_km,
            _distance_km: parsed.data.distance_km,
          });

          if (error) {
            console.error("GPS route finish failed", error.code);
            return json({ accepted: false, error: "temporarily_unavailable" }, 503);
          }

          const result = data as { accepted?: boolean; reason?: string } | null;
          if (result?.reason === "unauthorized")
            return json({ accepted: false, error: "unauthorized" }, 401);

          return json({ accepted: result?.accepted === true }, result?.accepted === true ? 202 : 404);
        } catch (error) {
          console.error("GPS route finish server error", error);
          return json({ accepted: false, error: "server_error" }, 503);
        }
      },
    },
  },
});
