import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const { PGlite } = await import(process.env.PGLITE_MODULE_PATH || "@electric-sql/pglite");
const db = new PGlite();
try {
  // A consolidated fixture avoids replaying historical migrations that redefine the same tables.
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE SCHEMA auth; CREATE SCHEMA private;
    GRANT USAGE ON SCHEMA public, private, auth TO authenticated, service_role;
    CREATE TABLE auth.users(id uuid PRIMARY KEY, banned_until timestamptz);
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
      $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated;
    CREATE TABLE public.system_settings(id boolean PRIMARY KEY, ai_daily_limit integer, allow_registrations boolean);
    INSERT INTO public.system_settings VALUES (true, 2, true);
    CREATE TABLE public.user_roles(user_id uuid, role text);
    CREATE TABLE public.deliveries(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid,
      app_name text NOT NULL DEFAULT 'iFood', status text NOT NULL DEFAULT 'concluida',
      earnings numeric NOT NULL DEFAULT 20, tip numeric NOT NULL DEFAULT 0, occurred_at timestamptz NOT NULL DEFAULT now());
    CREATE FUNCTION public.is_super_admin(_user_id uuid DEFAULT auth.uid()) RETURNS boolean
      LANGUAGE sql STABLE SECURITY DEFINER AS $$ SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id=_user_id AND role='super_admin') $$;
    CREATE FUNCTION private.get_my_system_access() RETURNS jsonb LANGUAGE sql AS $$ SELECT '{}'::jsonb $$;
    CREATE TABLE public.organizations(id uuid PRIMARY KEY);
    CREATE TABLE public.organization_members(organization_id uuid, user_id uuid);
    CREATE TABLE public.subscriptions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid);
    ALTER TABLE public.organization_members ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
    CREATE POLICY own_membership ON public.organization_members TO authenticated USING (user_id=auth.uid());
    CREATE POLICY "members read subscription" ON public.subscriptions FOR SELECT TO authenticated USING (
      public.is_super_admin() OR EXISTS (SELECT 1 FROM public.organization_members om
      WHERE om.organization_id=organization_id AND om.user_id=auth.uid()));
    GRANT SELECT ON public.organization_members, public.subscriptions TO authenticated;
    INSERT INTO public.organizations VALUES ('10000000-0000-0000-0000-000000000001'),('10000000-0000-0000-0000-000000000002');
    INSERT INTO public.organization_members VALUES
      ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002'),
      ('10000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000003');
    INSERT INTO public.subscriptions(organization_id) SELECT id FROM public.organizations;
    CREATE TABLE public.gps_device_tokens(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, is_active boolean DEFAULT true);
    ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.deliveries ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.gps_device_tokens ENABLE ROW LEVEL SECURITY;
    CREATE POLICY own_roles ON public.user_roles TO authenticated USING (user_id=auth.uid());
    CREATE POLICY own_deliveries ON public.deliveries TO authenticated USING (user_id=auth.uid()) WITH CHECK (user_id=auth.uid());
    CREATE POLICY own_devices ON public.gps_device_tokens TO authenticated USING (user_id=auth.uid()) WITH CHECK (user_id=auth.uid());
    GRANT SELECT ON public.user_roles TO authenticated;
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.deliveries TO authenticated;
    INSERT INTO auth.users VALUES
      ('00000000-0000-0000-0000-000000000001', NULL),
      ('00000000-0000-0000-0000-000000000002', NULL),
      ('00000000-0000-0000-0000-000000000003', now()+interval '1 day');
    INSERT INTO public.user_roles VALUES ('00000000-0000-0000-0000-000000000001','super_admin');
    INSERT INTO public.deliveries(user_id) VALUES ('00000000-0000-0000-0000-000000000001'),('00000000-0000-0000-0000-000000000002');
    INSERT INTO public.gps_device_tokens(user_id) VALUES
      ('00000000-0000-0000-0000-000000000001'),('00000000-0000-0000-0000-000000000003');
  `);
  await db.exec(
    await readFile(
      new URL(
        "../supabase/migrations/20260903000736_d4360a00-e0ba-424d-84af-cc08f87d5581.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  await db.exec(
    "INSERT INTO public.ai_scan_usage(user_id,count) VALUES ('00000000-0000-0000-0000-000000000003',-999)",
  );
  const oldScope = await db.exec(
    "SET ROLE authenticated; SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000002'; SELECT count(*)::integer AS count FROM public.subscriptions; RESET ROLE;",
  );
  assert.equal(oldScope[2].rows[0].count, 2, "reproduces pre-existing tenant policy leak");
  for (const file of [
    "20261101090000_app_challenges.sql",
    "20261104090000_automatic_app_challenges.sql",
  ]) {
    await db.exec(
      await readFile(new URL(`../supabase/migrations/${file}`, import.meta.url), "utf8"),
    );
  }
  await db.exec(
    await readFile(
      new URL("../supabase/migrations/20261105090000_security_hardening.sql", import.meta.url),
      "utf8",
    ),
  );
  const scalar = async (sql) => Object.values((await db.query(sql)).rows[0])[0];
  assert.equal(
    (
      await db.query(
        "SELECT count FROM public.ai_scan_usage WHERE user_id='00000000-0000-0000-0000-000000000003'",
      )
    ).rows[0].count,
    0,
    "negative legacy usage cannot extend the allowance",
  );
  assert.equal(
    await scalar(
      "SELECT is_active FROM public.gps_device_tokens WHERE user_id='00000000-0000-0000-0000-000000000003'",
    ),
    false,
    "previously banned device revoked by migration",
  );
  await db.exec(
    "SET ROLE authenticated; SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000001'",
  );
  assert.equal(await scalar("SELECT private.is_super_admin()"), true);
  assert.equal(
    await scalar("SELECT count(*)::integer FROM public.deliveries"),
    1,
    "own account only",
  );
  assert.equal(
    await scalar("SELECT public.consume_ai_scan_quota(0)"),
    -1,
    "zero quota denies first insert",
  );
  assert.equal(await scalar("SELECT count(*)::integer FROM public.ai_scan_usage"), 0);
  assert.equal(await scalar("SELECT public.consume_ai_scan_quota(99999)"), 1);
  assert.equal(await scalar("SELECT public.consume_ai_scan_quota(99999)"), 2);
  assert.equal(
    await scalar("SELECT public.consume_ai_scan_quota(99999)"),
    -1,
    "client cannot increase configured cap",
  );
  assert.equal(await scalar("SELECT public.consume_ai_scan_quota(NULL)"), -1);
  for (const sql of [
    "UPDATE public.ai_scan_usage SET count=0",
    "DELETE FROM public.ai_scan_usage",
    "INSERT INTO public.ai_scan_usage(user_id,count) VALUES (auth.uid(),0)",
  ])
    await assert.rejects(db.exec(sql), /permission denied/);
  await db.exec(
    "RESET ROLE; UPDATE auth.users SET banned_until=now()+interval '1 day' WHERE id='00000000-0000-0000-0000-000000000001'",
  );
  assert.equal(
    await scalar(
      "SELECT is_active FROM public.gps_device_tokens WHERE user_id='00000000-0000-0000-0000-000000000001'",
    ),
    false,
    "new ban revokes devices",
  );
  await assert.rejects(
    db.exec(
      "UPDATE public.gps_device_tokens SET is_active=true WHERE user_id='00000000-0000-0000-0000-000000000001'",
    ),
    /active account/,
  );
  await db.exec("SET ROLE authenticated");
  assert.equal(
    await scalar("SELECT private.is_super_admin()"),
    false,
    "banned super admin loses privileges",
  );
  assert.equal(await scalar("SELECT public.is_admin()"), false);
  await assert.rejects(db.exec("SELECT public.get_my_system_access()"), /active account/);
  await assert.rejects(db.exec("SELECT public.reconcile_app_challenges()"), /active account/);
  assert.equal(
    await scalar("SELECT count(*)::integer FROM public.deliveries"),
    0,
    "existing JWT cannot read after ban",
  );
  await assert.rejects(
    db.exec("INSERT INTO public.deliveries(user_id) VALUES (auth.uid())"),
    /row-level security/,
  );
  await assert.rejects(db.exec("SELECT public.consume_ai_scan_quota(100)"), /active account/);
  await db.exec("SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000002'");
  assert.equal(
    await scalar("SELECT count(*)::integer FROM public.ai_scan_usage"),
    0,
    "other account usage is private",
  );
  assert.equal(
    await scalar("SELECT count(*)::integer FROM public.deliveries"),
    1,
    "other active account remains usable",
  );
  assert.equal(
    await scalar("SELECT count(*)::integer FROM public.subscriptions"),
    1,
    "members can only read their own organization subscription",
  );
  await db.exec("SELECT public.reconcile_app_challenges()");
  await db.exec("RESET ROLE; UPDATE public.system_settings SET allow_registrations=false");
  await assert.rejects(
    db.exec("INSERT INTO auth.users(id) VALUES ('00000000-0000-0000-0000-000000000004')"),
    /registrations/,
  );
  await db.exec(
    "UPDATE public.system_settings SET allow_registrations=true; INSERT INTO auth.users(id) VALUES ('00000000-0000-0000-0000-000000000004')",
  );
  await db.exec("SET ROLE anon");
  await assert.rejects(db.exec("SELECT public.consume_ai_scan_quota(15)"), /permission denied/);
  console.log(
    "PostgreSQL security: quota ownership/caps, zero limit, RLS, live account bans, admin privileges, GPS revocation and registration gate passed.",
  );
} finally {
  await db.close();
}
