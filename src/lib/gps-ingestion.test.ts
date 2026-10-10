import assert from "node:assert/strict";
import test from "node:test";
import { createClient } from "@supabase/supabase-js";
import { publicSupabaseFetch } from "./public-supabase-fetch";
import { gpsPayloadSchema, gpsTimestampIso } from "./gps-payload";

test("SDK envia chave pública opaca em apikey sem usá-la como JWT", async () => {
  const key = "sb_publishable_local_test";
  let requests = 0;
  const fetcher: typeof fetch = async (_input, init) => {
    requests++;
    const headers = new Headers(init?.headers);
    assert.equal(headers.get("apikey"), key);
    assert.notEqual(headers.get("Authorization"), `Bearer ${key}`);
    return Response.json({ accepted: true });
  };
  const client = createClient("https://example.invalid", key, {
    global: { fetch: publicSupabaseFetch(key, fetcher) },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const result = await client.rpc("ingest_gps_device_state", { _token_hash: "test-hash" });
  assert.equal(result.error, null);
  assert.equal(result.data.accepted, true);
  assert.equal(requests, 1);
});

test("não remove Authorization de uma sessão de usuário ou chave JWT legada", async () => {
  for (const [key, authorization] of [
    ["sb_publishable_local_test", "Bearer user-session"],
    ["legacy-jwt-key", "Bearer legacy-jwt-key"],
  ] as const) {
    const fetcher: typeof fetch = async (_input, init) => {
      assert.equal(new Headers(init?.headers).get("Authorization"), authorization);
      return Response.json({});
    };
    await publicSupabaseFetch(key, fetcher)("https://example.invalid", {
      headers: { Authorization: authorization },
    });
  }
});

test("GPS aceita segundos, milissegundos e data ISO com fuso sem mudar o instante", () => {
  const iso = "2026-10-10T15:00:00.000Z";
  assert.equal(gpsTimestampIso(Date.parse(iso)), iso);
  assert.equal(gpsTimestampIso(Date.parse(iso) / 1000), iso);
  assert.equal(gpsTimestampIso("2026-10-10T12:00:00-03:00"), iso);
  const payload = {
    source: "test",
    latitude: -23.55,
    longitude: -46.63,
    accuracy_m: 10,
    speed_kmh: 20,
    trip_km: 1,
    total_km: 1000,
    captured_at: "2026-10-10T12:00:00-03:00",
    sent_at: Date.parse(iso) / 1000,
  };
  assert.equal(gpsPayloadSchema.safeParse(payload).success, true);
  assert.equal(gpsPayloadSchema.safeParse({ ...payload, latitude: 100 }).success, false);
  assert.equal(gpsPayloadSchema.safeParse({ ...payload, captured_at: "invalid" }).success, false);
});
