import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const { PGlite } = await import(process.env.PGLITE_MODULE_PATH || "@electric-sql/pglite");
const db = new PGlite();
try {
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE SCHEMA auth; CREATE SCHEMA extensions;
    CREATE TABLE auth.users(id uuid PRIMARY KEY, banned_until timestamptz);
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    INSERT INTO auth.users VALUES ('00000000-0000-0000-0000-000000000001',NULL),('00000000-0000-0000-0000-000000000002',NULL);`);
  for (const file of [
    "20261006015401_d198d6fa-2eb1-4fd0-93fc-b0d6aa7b1f82.sql",
    "20261018103000_gps_route_points.sql",
    "20261018114500_gps_route_sessions.sql",
    "20261105091000_gps_route_security.sql",
  ])
    await db.exec(
      await readFile(new URL(`../supabase/migrations/${file}`, import.meta.url), "utf8"),
    );
  for (const [index, user] of [
    [1, 1],
    [2, 1],
    [3, 2],
  ])
    await db.query(
      `
    INSERT INTO public.gps_device_tokens(user_id, device_name, token_hash)
    VALUES ($1, 'Device', $2)`,
      [`00000000-0000-0000-0000-00000000000${user}`, String(index).repeat(64)],
    );
  const route = "10000000-0000-0000-0000-000000000001";
  const at = (seconds) => new Date(Date.now() - 60000 + seconds * 1000).toISOString();
  const point = async (overrides = {}) => {
    const p = {
      id: crypto.randomUUID(),
      route,
      token: "1".repeat(64),
      at: at(0),
      trip: 1,
      total: 100,
      lat: -23,
      ...overrides,
    };
    return (
      await db.query(
        `SELECT public.ingest_gps_device_point($1,$2,$3,'device',$4,-46,5,20,$5,$6,$7,$7) AS result`,
        [p.id, p.route, p.token, p.lat, p.trip, p.total, p.at],
      )
    ).rows[0].result;
  };
  const end = async (overrides = {}) => {
    const p = { route, token: "1".repeat(64), at: at(30), total: 102, distance: 2, ...overrides };
    return (
      await db.query(`SELECT public.finish_gps_route_session($1,$2,$3,$4,$5) AS result`, [
        p.route,
        p.token,
        p.at,
        p.total,
        p.distance,
      ])
    ).rows[0].result;
  };
  const current = async () =>
    (await db.query("SELECT * FROM public.gps_route_sessions WHERE id=$1", [route])).rows[0];
  await db.exec("SET ROLE anon");
  assert.equal((await point()).accepted, true);
  assert.equal(
    (await point({ token: "2".repeat(64) })).reason,
    "unauthorized",
    "same-account device cannot inject another device route",
  );
  assert.equal(
    (await point({ token: "3".repeat(64) })).reason,
    "unauthorized",
    "other account route cannot be touched",
  );
  assert.equal(
    (await point({ lat: 99 })).reason,
    "invalid_payload",
    "direct RPC validates coordinates",
  );
  assert.equal((await point({ at: "2099-01-01T00:00:00Z" })).reason, "invalid_payload");
  const id = crypto.randomUUID();
  assert.equal((await point({ id, at: at(20), trip: 2, total: 102 })).accepted, true);
  assert.equal((await point({ id, at: at(25), trip: 9, total: 109 })).reason, "duplicate");
  assert.equal(
    (await point({ at: at(10), trip: 1.5, total: 101.5 })).accepted,
    true,
    "delayed point is retained",
  );
  await db.exec("RESET ROLE");
  assert.equal(
    (await current()).distance_km,
    2,
    "delayed and repeated readings cannot regress/overwrite route totals",
  );
  assert.equal((await current()).point_count, 3, "duplicate point does not increment count");
  assert.equal(
    (
      await db.query(
        "SELECT trip_km FROM public.gps_device_state WHERE token_id=(SELECT id FROM public.gps_device_tokens WHERE token_hash=$1)",
        ["1".repeat(64)],
      )
    ).rows[0].trip_km,
    2,
  );
  await db.exec("SET ROLE anon");
  assert.equal((await end({ token: "2".repeat(64) })).reason, "unauthorized");
  assert.equal((await end({ at: at(-1) })).reason, "invalid_payload");
  assert.equal(
    (await end({ at: at(15) })).reason,
    "invalid_payload",
    "finish cannot precede an already recorded point",
  );
  const endedAt = at(30);
  assert.equal((await end({ at: endedAt })).accepted, true);
  assert.equal(
    (await end({ at: endedAt })).accepted,
    true,
    "identical finish retries are idempotent",
  );
  assert.equal(
    (await end({ at: endedAt, distance: 0 })).accepted,
    false,
    "finish retries cannot rewrite distance",
  );
  assert.equal((await point({ at: at(40) })).reason, "route_closed");
  assert.equal(
    (await point({ at: at(5), trip: 0.5 })).accepted,
    true,
    "historical backfill before finish remains allowed",
  );
  await db.exec("RESET ROLE");
  assert.equal((await current()).distance_km, 2, "backfill cannot change a finished route");
  await db.exec(
    "UPDATE auth.users SET banned_until=now()+interval '1 day' WHERE id='00000000-0000-0000-0000-000000000001'; SET ROLE anon",
  );
  assert.equal(
    (await point({ route: null })).reason,
    "unauthorized",
    "active token of a banned account is rejected",
  );
  console.log(
    "PostgreSQL GPS: token/route ownership, direct validation, duplicates, chronology, finalization and account bans passed.",
  );
} finally {
  await db.close();
}
