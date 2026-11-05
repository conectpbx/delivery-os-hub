-- Active JWTs must not keep database access after an account is blocked.
CREATE OR REPLACE FUNCTION private.current_account_is_active() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = auth.uid()
    AND (u.banned_until IS NULL OR u.banned_until <= now()));
$$;
REVOKE ALL ON FUNCTION private.current_account_is_active() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.current_account_is_active() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION private.is_super_admin(_user_id uuid DEFAULT auth.uid()) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT private.current_account_is_active() AND EXISTS (
    SELECT 1 FROM public.user_roles r JOIN auth.users u ON u.id = r.user_id
    WHERE r.user_id = _user_id AND r.role = 'super_admin'
      AND (u.banned_until IS NULL OR u.banned_until <= now()));
$$;
CREATE OR REPLACE FUNCTION public.is_super_admin(_user_id uuid DEFAULT auth.uid()) RETURNS boolean
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT private.is_super_admin(_user_id);
$$;
REVOKE ALL ON FUNCTION public.is_super_admin(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_super_admin(uuid) TO authenticated, service_role;

-- Legacy administrative helpers must enforce the same active-account rule.
CREATE OR REPLACE FUNCTION public.is_admin(_user_id uuid DEFAULT auth.uid()) RETURNS boolean
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT private.is_super_admin(_user_id);
$$;
REVOKE ALL ON FUNCTION public.is_admin(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_admin(uuid) TO authenticated, service_role;

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'profiles','deliveries','fuelings','maintenances','expenses','goals','apps',
    'work_journeys','app_challenges','gps_device_tokens','gps_device_state',
    'gps_route_points','gps_route_sessions','ai_scan_usage','user_roles',
    'organizations','organization_members','subscriptions','module_overrides','billing_events'
  ] LOOP
    -- Some installations do not have the optional GPS/journey modules yet.
    IF to_regclass('public.' || table_name) IS NOT NULL THEN
      EXECUTE format('CREATE POLICY active_account_required ON public.%I AS RESTRICTIVE
        FOR ALL TO authenticated USING ((SELECT private.current_account_is_active()))
        WITH CHECK ((SELECT private.current_account_is_active()))', table_name);
    END IF;
  END LOOP;
END;
$$;

-- Usage counters are server-owned, not editable through the table API.
-- Repair negative legacy counters so they cannot extend the daily allowance.
UPDATE public.ai_scan_usage SET count = 0 WHERE count < 0;
ALTER TABLE public.ai_scan_usage ADD CONSTRAINT ai_scan_usage_nonnegative CHECK (count >= 0);
REVOKE INSERT, UPDATE, DELETE ON public.ai_scan_usage FROM PUBLIC, anon, authenticated;
DROP POLICY IF EXISTS "Users insert own ai usage" ON public.ai_scan_usage;
DROP POLICY IF EXISTS "Users update own ai usage" ON public.ai_scan_usage;
CREATE OR REPLACE FUNCTION public.consume_ai_scan_quota(_limit integer) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  account_id uuid := auth.uid();
  today date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  effective_limit integer;
  new_count integer;
BEGIN
  IF NOT private.current_account_is_active() THEN
    RAISE EXCEPTION 'active account required' USING ERRCODE = '42501';
  END IF;
  SELECT least(ai_daily_limit, greatest(coalesce(_limit, 0), 0)) INTO effective_limit
    FROM public.system_settings WHERE id;
  IF coalesce(effective_limit, 0) <= 0 THEN RETURN -1; END IF;
  INSERT INTO public.ai_scan_usage(user_id, usage_date, count) VALUES (account_id, today, 1)
  ON CONFLICT (user_id, usage_date) DO UPDATE
    SET count = public.ai_scan_usage.count + 1, updated_at = now()
    WHERE public.ai_scan_usage.count < effective_limit
    RETURNING count INTO new_count;
  RETURN coalesce(new_count, -1);
END;
$$;
REVOKE ALL ON FUNCTION public.consume_ai_scan_quota(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.consume_ai_scan_quota(integer) TO authenticated, service_role;

-- Enforce the registration setting even in installations without the legacy role trigger.
CREATE FUNCTION private.enforce_registration_setting() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.system_settings WHERE id AND NOT allow_registrations) THEN
    RAISE EXCEPTION 'new registrations are temporarily disabled' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.enforce_registration_setting() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER enforce_registration_setting BEFORE INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION private.enforce_registration_setting();

-- Banning an account also revokes its external device bearer tokens.
CREATE FUNCTION private.revoke_blocked_account_devices() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.banned_until > now() THEN
    UPDATE public.gps_device_tokens SET is_active = false WHERE user_id = NEW.id AND is_active;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.revoke_blocked_account_devices() FROM PUBLIC, anon, authenticated;
CREATE FUNCTION private.require_active_device_owner() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.is_active AND NOT EXISTS (SELECT 1 FROM auth.users WHERE id = NEW.user_id
      AND (banned_until IS NULL OR banned_until <= now())) THEN
    RAISE EXCEPTION 'active account required' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.require_active_device_owner() FROM PUBLIC, anon, authenticated;
DO $$ BEGIN
  IF to_regclass('public.gps_device_tokens') IS NOT NULL THEN
    CREATE TRIGGER require_active_device_owner BEFORE INSERT OR UPDATE OF is_active, user_id
      ON public.gps_device_tokens FOR EACH ROW EXECUTE FUNCTION private.require_active_device_owner();
    CREATE TRIGGER revoke_blocked_account_devices AFTER UPDATE OF banned_until ON auth.users
      FOR EACH ROW EXECUTE FUNCTION private.revoke_blocked_account_devices();
    UPDATE public.gps_device_tokens t SET is_active = false FROM auth.users u
      WHERE t.user_id = u.id AND t.is_active AND u.banned_until > now();
  END IF;
END $$;


-- Qualify the outer subscription column. An unqualified organization_id inside
-- this subquery resolves to om.organization_id, making the comparison a tautology.
DO $$ BEGIN
  IF to_regclass('public.subscriptions') IS NOT NULL AND to_regclass('public.organization_members') IS NOT NULL THEN
    DROP POLICY IF EXISTS "members read subscription" ON public.subscriptions;
    CREATE POLICY "members read subscription" ON public.subscriptions FOR SELECT TO authenticated
      USING ((SELECT public.is_super_admin()) OR EXISTS (
        SELECT 1 FROM public.organization_members om
        WHERE om.organization_id = subscriptions.organization_id AND om.user_id = (SELECT auth.uid())
      ));
    CREATE INDEX IF NOT EXISTS organization_members_user_organization_idx
      ON public.organization_members(user_id, organization_id);
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.get_my_system_access() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF NOT private.current_account_is_active() THEN
    RAISE EXCEPTION 'active account required' USING ERRCODE = '42501';
  END IF;
  RETURN private.get_my_system_access();
END;
$$;
REVOKE ALL ON FUNCTION public.get_my_system_access() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_system_access() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.reconcile_app_challenges() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE challenge_id uuid;
BEGIN
  IF NOT private.current_account_is_active() THEN
    RAISE EXCEPTION 'active account required' USING ERRCODE = '42501';
  END IF;
  FOR challenge_id IN
    SELECT c.id FROM public.app_challenges c
    WHERE c.user_id = auth.uid() AND c.auto_receive AND c.received_at IS NULL AND c.starts_at <= now()
    ORDER BY c.id FOR UPDATE
  LOOP
    UPDATE public.app_challenges c SET auto_receive = true WHERE c.id = challenge_id
      AND (SELECT CASE WHEN c.metric = 'deliveries' THEN count(*)::numeric
           ELSE coalesce(sum(d.earnings + d.tip), 0) END
           FROM public.deliveries d WHERE d.user_id = c.user_id AND d.status = 'concluida'
             AND lower(btrim(d.app_name)) = lower(btrim(c.app_name))
             AND d.occurred_at BETWEEN c.starts_at AND c.ends_at AND d.occurred_at <= now()) >= c.target;
  END LOOP;
END;
$$;
REVOKE ALL ON FUNCTION public.reconcile_app_challenges() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reconcile_app_challenges() TO authenticated;
