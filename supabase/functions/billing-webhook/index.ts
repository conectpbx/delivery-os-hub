// Stripe-compatible billing webhook. Required secrets: SUPABASE_URL,
// SUPABASE_SERVICE_ROLE_KEY and BILLING_WEBHOOK_SECRET.
const encoder = new TextEncoder();

function hex(bytes: ArrayBuffer) {
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function validSignature(payload: string, signature: string, secret: string) {
  const parts = Object.fromEntries(signature.split(",").map((part) => part.split("=", 2)));
  const timestamp = Number(parts["t"]);
  if (!timestamp || Math.abs(Date.now() / 1000 - timestamp) > 300 || !parts["v1"]) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = await crypto.subtle.sign("HMAC", key, encoder.encode(`${timestamp}.${payload}`));
  const expected = hex(digest);
  if (expected.length !== parts["v1"].length) return false;
  let mismatch = 0;
  for (let index = 0; index < expected.length; index += 1)
    mismatch |= expected.charCodeAt(index) ^ parts["v1"].charCodeAt(index);
  return mismatch === 0;
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return new Response("method not allowed", { status: 405 });
  const secret = Deno.env.get("BILLING_WEBHOOK_SECRET") ?? "";
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const payload = await request.text();
  const signature = request.headers.get("stripe-signature") ?? "";
  if (!secret || !(await validSignature(payload, signature, secret)))
    return new Response("invalid signature", { status: 401 });
  const event = JSON.parse(payload) as {
    id: string;
    type: string;
    data: { object: Record<string, unknown> };
  };
  const response = await fetch(`${url}/rest/v1/rpc/process_billing_event`, {
    method: "POST",
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      _provider: "stripe",
      _event_id: event.id,
      _event_type: event.type,
      _payload: event.data.object,
    }),
  });
  if (!response.ok) return new Response("processing failed", { status: 500 });
  return Response.json({ received: true });
});
