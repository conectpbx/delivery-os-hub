import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { createTripSync } from "../src/lib/trip-sync.ts";
const db = new PGlite();
const owner = "00000000-0000-0000-0000-000000000001";
const other = "00000000-0000-0000-0000-000000000002";
const idle = {
  active: false,
  source: "browser",
  startedAt: null,
  endedAt: null,
  distanceKm: 0,
  points: 0,
  last: null,
};
const start = (id) => ({
  ...idle,
  journeyId: id,
  active: true,
  startedAt: "2026-11-05T10:00:00Z",
  updatedAt: "2026-11-05T10:00:00Z",
});
try {
  await db.exec(`CREATE ROLE authenticated; CREATE ROLE service_role; CREATE ROLE anon;
    CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY, banned_until timestamptz);
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    GRANT USAGE ON SCHEMA auth TO authenticated;
    CREATE TABLE public.work_journeys(id uuid PRIMARY KEY, user_id uuid, ended_at timestamptz, distance_km numeric DEFAULT 0);
    INSERT INTO auth.users(id) VALUES ('${owner}'),('${other}');
    CREATE PUBLICATION supabase_realtime;`);
  await db.exec(
    await readFile(
      new URL("../drizzle/migrations/0004_active_work_journeys.sql", import.meta.url),
      "utf8",
    ),
  );
  const migration = await readFile(
    new URL("../supabase/migrations/20261106090000_active_journey_sync.sql", import.meta.url),
    "utf8",
  );
  await db.exec(migration);
  await db.exec(migration);
  assert.equal(
    (
      await db.query(
        "SELECT count(*)::integer AS count FROM pg_publication_tables WHERE pubname='supabase_realtime' AND tablename='active_work_journeys'",
      )
    ).rows[0].count,
    1,
  );
  await db.exec(`SET ROLE authenticated; SET request.jwt.claim.sub='${owner}'`);
  const write = async (state, action, user = owner) =>
    (
      await db.query("SELECT public.sync_active_work_journey($1,$2::jsonb,$3) AS state", [
        user,
        JSON.stringify(state),
        action,
      ])
    ).rows[0].state;
  const read = async () =>
    (await db.query("SELECT state FROM public.active_work_journeys")).rows[0]?.state ?? null;
  let a = { ...idle };
  let b = { ...idle };
  const errors = [];
  const first = createTripSync({
    local: () => a,
    apply: (state) => {
      a = state;
    },
    read,
    write,
    error: (error) => {
      if (error) errors.push(error);
    },
  });
  const second = createTripSync({
    local: () => b,
    apply: (state) => {
      b = state;
    },
    read,
    write,
    error: (error) => {
      if (error) errors.push(error);
    },
  });
  const firstId = crypto.randomUUID();
  a = start(firstId);
  await first.publish(a, "start");
  await second.refresh();
  assert.equal(b.active, true, "second device shows Finalizar after first device starts");
  assert.equal(b.journeyId, firstId);
  a = {
    ...a,
    updatedAt: "2026-11-05T10:10:00Z",
    pauses: [
      {
        id: crypto.randomUUID(),
        reason: "Almoço",
        started_at: "2026-11-05T10:10:00Z",
        ended_at: null,
      },
    ],
  };
  await first.publish(a, "update");
  await second.refresh();
  assert.equal(b.pauses[0].ended_at, null, "observer shows Retomar after remote pause");
  const pausedOffline = structuredClone(a);
  b = {
    ...b,
    updatedAt: "2026-11-05T10:20:00Z",
    pauses: [{ ...b.pauses[0], ended_at: "2026-11-05T10:20:00Z" }],
  };
  await second.publish(b, "update");
  await first.refresh();
  assert.equal(
    a.pauses[0].ended_at,
    "2026-11-05T10:20:00Z",
    "observer shows Pausar after remote resume",
  );
  a = pausedOffline;
  await first.publish(a, "update");
  assert.equal(
    a.pauses[0].ended_at,
    "2026-11-05T10:20:00Z",
    "reconnecting stale device accepts server resume instead of reapplying its pause",
  );
  const stale = { ...b, distanceKm: 2, updatedAt: "2099-01-01T00:00:00Z" };
  a = {
    ...a,
    active: false,
    endedAt: "2026-11-05T11:00:00Z",
    updatedAt: "2026-11-05T11:00:00Z",
    pendingSave: true,
  };
  await first.publish(a, "finish");
  assert.equal(
    (await write(stale, "update")).active,
    false,
    "late GPS/advanced clock cannot resurrect completed journey",
  );
  await second.refresh();
  assert.equal(b.active, false, "observer shows Iniciar after remote finish");
  assert.equal(
    b.pendingSave,
    false,
    "observer does not offer to save another device's pending history",
  );
  a = { ...a, pendingSave: false };
  await first.publish(a, "finish");
  assert.equal(
    (await read()).endedAt,
    "2026-11-05T11:00:00Z",
    "completion snapshot remains stored",
  );
  const newId = crypto.randomUUID();
  b = start(newId);
  await second.publish(b, "start");
  await first.refresh();
  assert.equal(a.journeyId, newId);
  assert.equal(a.active, true);
  assert.equal(
    (await write({ ...start(firstId), active: false, endedAt: "2026-11-05T12:00:00Z" }, "finish"))
      .journeyId,
    newId,
    "late old finish cannot remove a newer journey",
  );
  assert.equal(
    (await write(start(crypto.randomUUID()), "start")).journeyId,
    newId,
    "simultaneous starts converge on one active journey",
  );
  await db.exec("RESET ROLE");
  await db.query(
    "INSERT INTO public.work_journeys(id,user_id,ended_at,distance_km) VALUES ($1,$2,'2026-11-05T11:00:00Z',2)",
    [firstId, owner],
  );
  await db.exec(`SET ROLE authenticated; SET request.jwt.claim.sub='${owner}'`);
  assert.equal((await read()).active, true, "late old history cannot close a new active journey");
  await db.exec("RESET ROLE");
  await db.query(
    "INSERT INTO public.work_journeys(id,user_id,ended_at,distance_km) VALUES ($1,$2,'2026-11-05T12:00:00Z',3)",
    [newId, owner],
  );
  await db.exec(`SET ROLE authenticated; SET request.jwt.claim.sub='${owner}'`);
  await second.refresh();
  assert.equal(
    b.active,
    false,
    "completed history closes the button even if client finish transmission was interrupted",
  );
  assert.equal(
    (await write(start(firstId), "start")).journeyId,
    newId,
    "old completed sessions cannot restart after another session finished",
  );
  await assert.rejects(write(start(crypto.randomUUID()), "start", other), /active account/);
  await assert.rejects(
    db.query("UPDATE public.active_work_journeys SET state='{}'"),
    /permission denied/,
  );
  await assert.rejects(db.query("DELETE FROM public.active_work_journeys"), /permission denied/);
  await db.exec(`SET request.jwt.claim.sub='${other}'`);
  assert.equal(await read(), null, "another account cannot read the snapshot");
  assert.equal(
    (await write(start(crypto.randomUUID()), "update", other)).active,
    false,
    "progress alone cannot create a journey",
  );
  await db.exec(
    `RESET ROLE; UPDATE auth.users SET banned_until=now()+interval '1 day' WHERE id='${owner}'; SET ROLE authenticated; SET request.jwt.claim.sub='${owner}'`,
  );
  assert.equal(await read(), null, "banned session cannot read active journey");
  await assert.rejects(write(start(crypto.randomUUID()), "start"), /active account/);
  assert.deepEqual(errors, []);
  first.stop();
  second.stop();
  console.log(
    "PostgreSQL + two devices: start/pause/resume/finish propagation, offline recovery, sticky completion, stale writes, concurrent starts, Realtime publication and account isolation passed.",
  );
} finally {
  await db.close();
}
