// Run with PGLITE_MODULE_PATH pointing to a separately installed @electric-sql/pglite.
// This isolated PostgreSQL database never connects to the application's Supabase.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const { PGlite } = await import(process.env.PGLITE_MODULE_PATH || "@electric-sql/pglite");

const db = new PGlite();
try {
  await db.exec(`
    CREATE ROLE authenticated;
    CREATE ROLE service_role;
    CREATE SCHEMA auth;
    CREATE TABLE auth.users(id uuid PRIMARY KEY);
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
      $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    GRANT USAGE ON SCHEMA public, auth TO authenticated;
    GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated;
    CREATE TABLE public.deliveries (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL,
      app_name text NOT NULL, status text NOT NULL DEFAULT 'concluida',
      earnings numeric NOT NULL DEFAULT 0, tip numeric NOT NULL DEFAULT 0,
      occurred_at timestamptz NOT NULL DEFAULT now()
    );
    ALTER TABLE public.deliveries ENABLE ROW LEVEL SECURITY;
    CREATE POLICY own_deliveries ON public.deliveries TO authenticated
      USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.deliveries TO authenticated;
    INSERT INTO auth.users VALUES
      ('00000000-0000-0000-0000-000000000001'),
      ('00000000-0000-0000-0000-000000000002');
  `);
  for (const file of [
    "20261101090000_app_challenges.sql",
    "20261104090000_automatic_app_challenges.sql",
  ]) {
    if (file === "20261104090000_automatic_app_challenges.sql") {
      await db.exec(`
        INSERT INTO auth.users VALUES ('00000000-0000-0000-0000-000000000003');
        INSERT INTO public.deliveries (user_id, app_name)
          VALUES ('00000000-0000-0000-0000-000000000003', 'Backfill');
        INSERT INTO public.app_challenges
          (user_id,app_name,title,starts_at,ends_at,metric,target,reward)
          VALUES ('00000000-0000-0000-0000-000000000003','Backfill','Existing',
            now()-interval '1 day',now()+interval '1 day','deliveries',1,50);
      `);
    }
    await db.exec(
      await readFile(new URL(`../supabase/migrations/${file}`, import.meta.url), "utf8"),
    );
  }
  assert.ok(
    (await db.query("SELECT received_at FROM public.app_challenges WHERE app_name='Backfill'"))
      .rows[0].received_at,
    "migration credits existing eligible challenges",
  );
  await db.exec(`SET ROLE authenticated;
    SET request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001'`);
  const user = "00000000-0000-0000-0000-000000000001";
  const other = "00000000-0000-0000-0000-000000000002";
  async function challenge(overrides = {}) {
    const v = { app: "iFood", metric: "deliveries", target: 2, auto: true, ...overrides };
    return (
      await db.query(
        `INSERT INTO public.app_challenges
      (user_id, app_name, title, starts_at, ends_at, metric, target, reward, auto_receive)
      VALUES ($1, $2, 'Teste', now() - interval '2 days', now() + interval '1 day', $3, $4, 50, $5)
      RETURNING *`,
        [user, v.app, v.metric, v.target, v.auto],
      )
    ).rows[0];
  }
  async function delivery(overrides = {}) {
    const v = {
      app: " ifood ",
      status: "concluida",
      earnings: 20,
      tip: 5,
      at: new Date().toISOString(),
      ...overrides,
    };
    return (
      await db.query(
        `INSERT INTO public.deliveries
      (user_id, app_name, status, earnings, tip, occurred_at) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
        [user, v.app, v.status, v.earnings, v.tip, v.at],
      )
    ).rows[0].id;
  }
  const row = async (id) =>
    (await db.query("SELECT * FROM public.app_challenges WHERE id=$1", [id])).rows[0];
  const count = await challenge();
  const revenue = await challenge({ metric: "revenue", target: 50 });
  const manual = await challenge({ auto: false });
  await delivery({ app: "Uber" });
  await delivery({ at: "2020-01-01T00:00:00Z" });
  await delivery({ at: "2099-01-01T00:00:00Z" });
  const route = await delivery({ status: "em_rota" });
  await delivery();
  assert.equal((await row(count.id)).received_at, null, "ignore wrong app, dates and open routes");
  await assert.rejects(
    db.query("UPDATE public.app_challenges SET received_at=now() WHERE id=$1", [manual.id]),
    /meta concluída/,
  );
  await db.query("UPDATE public.deliveries SET status='concluida' WHERE id=$1", [route]);
  const credited = await row(count.id);
  assert.ok(credited.received_at, "delivery completion credits quantity goal");
  assert.ok((await row(revenue.id)).received_at, "revenue includes tips");
  assert.equal((await row(manual.id)).received_at, null, "manual choice is preserved");
  await delivery();
  await db.query("SELECT public.reconcile_app_challenges()");
  assert.equal(
    (await row(count.id)).received_at.getTime(),
    credited.received_at.getTime(),
    "retries never duplicate/backdate credit",
  );
  for (const sql of [
    "UPDATE public.app_challenges SET reward=500 WHERE id=$1",
    "UPDATE public.app_challenges SET target=1, received_at=NULL WHERE id=$1",
    "DELETE FROM public.app_challenges WHERE id=$1",
    "UPDATE public.app_challenges SET user_id='00000000-0000-0000-0000-000000000002' WHERE id=$1",
  ])
    await assert.rejects(db.query(sql, [count.id]), /Estorne|identidade/);
  await db.query("UPDATE public.app_challenges SET received_at=NULL WHERE id=$1", [count.id]);
  assert.equal(
    (await row(count.id)).auto_receive,
    false,
    "reversal pauses automation even via direct API",
  );
  await delivery();
  await db.query("SELECT public.reconcile_app_challenges()");
  assert.equal(
    (await row(count.id)).received_at,
    null,
    "reversal survives subsequent delivery and reconciliation",
  );
  await db.query("UPDATE public.app_challenges SET auto_receive=true WHERE id=$1", [count.id]);
  assert.ok((await row(count.id)).received_at, "explicit reactivation can credit again");
  const retro = await challenge({ target: 1 });
  assert.ok(retro.received_at, "new challenge evaluates existing deliveries");
  await db.query("UPDATE public.app_challenges SET received_at=now() WHERE id=$1", [manual.id]);
  assert.ok((await row(manual.id)).received_at, "eligible manual confirmation remains available");
  await db.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [other]);
  assert.equal(
    (await db.query("SELECT * FROM public.app_challenges")).rows.length,
    0,
    "RLS hides another account",
  );
  assert.equal(
    (
      await db.query("UPDATE public.app_challenges SET reward=1 WHERE id=$1 RETURNING id", [
        count.id,
      ])
    ).rows.length,
    0,
  );
  await db.query("SELECT public.reconcile_app_challenges()");
  await assert.rejects(
    db.query(
      `INSERT INTO public.app_challenges
    (user_id,app_name,title,starts_at,ends_at,metric,target,reward)
    VALUES ($1,'iFood','Spoof',now(),now(),'deliveries',1,50)`,
      [user],
    ),
    /row-level security/,
  );
  await db.exec("RESET ROLE; SET request.jwt.claim.sub = ''");
  await assert.rejects(db.query("SELECT public.reconcile_app_challenges()"), /Autenticação/);
  assert.equal(
    (
      await db.query(`SELECT has_function_privilege('authenticated',
    'public.credit_delivery_challenges()', 'EXECUTE') AS allowed`)
    ).rows[0].allowed,
    false,
  );
  console.log(
    "PostgreSQL: automatic/manual credits, eligibility, retries, reversal, immutability and account isolation passed.",
  );
} finally {
  await db.close();
}
