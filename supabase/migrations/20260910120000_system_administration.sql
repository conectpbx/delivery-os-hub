-- Administrative control plane. All privileged operations are exposed through
-- narrowly scoped RPCs so the service-role key is never shipped to the PWA.
CREATE TYPE public.app_role AS ENUM ('admin', 'user');

CREATE TABLE public.user_roles (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL DEFAULT 'user',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.system_settings (
  id BOOLEAN PRIMARY KEY DEFAULT true CHECK (id),
  app_name TEXT NOT NULL DEFAULT 'Delivery OS' CHECK (length(app_name) BETWEEN 2 AND 60),
  support_email TEXT NOT NULL DEFAULT '' CHECK (length(support_email) <= 254),
  maintenance_mode BOOLEAN NOT NULL DEFAULT false,
  allow_registrations BOOLEAN NOT NULL DEFAULT true,
  ai_daily_limit INTEGER NOT NULL DEFAULT 5 CHECK (ai_daily_limit BETWEEN 0 AND 100),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE TABLE public.admin_audit_logs (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  target_id UUID,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX admin_audit_logs_created_idx ON public.admin_audit_logs (created_at DESC);
INSERT INTO public.system_settings (id) VALUES (true);

-- Existing installations get a deterministic initial owner. New installations
-- safely promote only the very first account (the advisory lock prevents races).
INSERT INTO public.user_roles (user_id, role)
SELECT id, CASE WHEN row_number() OVER (ORDER BY created_at, id) = 1 THEN 'admin'::public.app_role ELSE 'user'::public.app_role END
FROM auth.users
ON CONFLICT (user_id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.assign_default_role() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE _role public.app_role := 'user';
BEGIN
  PERFORM pg_advisory_xact_lock(7152026);
  IF EXISTS (SELECT 1 FROM public.user_roles WHERE role = 'admin')
     AND NOT (SELECT allow_registrations FROM public.system_settings WHERE id) THEN
    RAISE EXCEPTION 'new registrations are temporarily disabled';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE role = 'admin') THEN _role := 'admin'; END IF;
  INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, _role) ON CONFLICT DO NOTHING;
  RETURN NEW;
END; $$;
CREATE TRIGGER assign_user_role_after_signup AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.assign_default_role();

CREATE OR REPLACE FUNCTION public.is_admin(_user_id UUID DEFAULT auth.uid()) RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = 'admin');
$$;

ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.system_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_audit_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "read own role" ON public.user_roles FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "admins read settings" ON public.system_settings FOR SELECT TO authenticated USING (public.is_admin());
CREATE POLICY "admins read audit" ON public.admin_audit_logs FOR SELECT TO authenticated USING (public.is_admin());

GRANT SELECT ON public.user_roles, public.system_settings, public.admin_audit_logs TO authenticated;
GRANT ALL ON public.user_roles, public.system_settings, public.admin_audit_logs TO service_role;
REVOKE EXECUTE ON FUNCTION public.assign_default_role() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.is_admin(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_admin(UUID) TO authenticated;

-- Enforce the centrally configured quota even if an outdated client submits a
-- larger value to the legacy RPC argument.
CREATE OR REPLACE FUNCTION public.consume_ai_scan_quota(_limit INTEGER)
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  _uid UUID := auth.uid();
  _today DATE := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  _effective_limit INTEGER;
  _new INTEGER;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  SELECT LEAST(ai_daily_limit, GREATEST(_limit, 0)) INTO _effective_limit FROM public.system_settings WHERE id;
  INSERT INTO public.ai_scan_usage (user_id, usage_date, count) VALUES (_uid, _today, 1)
  ON CONFLICT (user_id, usage_date) DO UPDATE SET count = public.ai_scan_usage.count + 1, updated_at = now()
  WHERE public.ai_scan_usage.count < _effective_limit RETURNING count INTO _new;
  RETURN COALESCE(_new, -1);
END; $$;

CREATE OR REPLACE FUNCTION public.admin_overview()
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, auth, pg_temp AS $$
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'admin access required' USING ERRCODE = '42501'; END IF;
  RETURN jsonb_build_object(
    'totalUsers', (SELECT count(*) FROM auth.users),
    'activeUsers30d', (SELECT count(*) FROM auth.users WHERE last_sign_in_at >= now() - interval '30 days'),
    'deliveries30d', (SELECT count(*) FROM public.deliveries WHERE occurred_at >= now() - interval '30 days'),
    'revenue30d', (SELECT COALESCE(sum(earnings + tip), 0) FROM public.deliveries WHERE occurred_at >= now() - interval '30 days'),
    'scansToday', (SELECT COALESCE(sum(count), 0) FROM public.ai_scan_usage WHERE usage_date = (now() AT TIME ZONE 'America/Sao_Paulo')::date)
  );
END; $$;

CREATE OR REPLACE FUNCTION public.admin_list_users(_search TEXT DEFAULT '', _limit INTEGER DEFAULT 100)
RETURNS TABLE(user_id UUID, email TEXT, full_name TEXT, role public.app_role, created_at TIMESTAMPTZ, last_sign_in_at TIMESTAMPTZ, is_blocked BOOLEAN, delivery_count BIGINT)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, auth, pg_temp AS $$
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'admin access required' USING ERRCODE = '42501'; END IF;
  RETURN QUERY SELECT u.id, u.email::text, p.full_name, COALESCE(r.role, 'user'::public.app_role), u.created_at, u.last_sign_in_at,
    COALESCE(u.banned_until > now(), false), (SELECT count(*) FROM public.deliveries d WHERE d.user_id = u.id)
  FROM auth.users u LEFT JOIN public.profiles p ON p.id = u.id LEFT JOIN public.user_roles r ON r.user_id = u.id
  WHERE _search = '' OR u.email ILIKE '%' || _search || '%' OR p.full_name ILIKE '%' || _search || '%'
  ORDER BY u.created_at DESC LIMIT LEAST(GREATEST(_limit, 1), 200);
END; $$;

CREATE OR REPLACE FUNCTION public.admin_set_user_access(_user_id UUID, _role public.app_role, _blocked BOOLEAN)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth, pg_temp AS $$
DECLARE _old_role public.app_role;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'admin access required' USING ERRCODE = '42501'; END IF;
  IF _user_id = auth.uid() AND (_role <> 'admin' OR _blocked) THEN RAISE EXCEPTION 'you cannot remove your own access'; END IF;
  SELECT role INTO _old_role FROM public.user_roles WHERE user_id = _user_id FOR UPDATE;
  IF _old_role = 'admin' AND _role <> 'admin' AND (SELECT count(*) FROM public.user_roles WHERE role = 'admin') <= 1 THEN
    RAISE EXCEPTION 'at least one administrator is required';
  END IF;
  INSERT INTO public.user_roles (user_id, role, updated_at) VALUES (_user_id, _role, now())
  ON CONFLICT (user_id) DO UPDATE SET role = EXCLUDED.role, updated_at = now();
  UPDATE auth.users SET banned_until = CASE WHEN _blocked THEN now() + interval '100 years' ELSE NULL END WHERE id = _user_id;
  INSERT INTO public.admin_audit_logs(actor_id, action, target_id, details)
  VALUES (auth.uid(), 'user.access.updated', _user_id, jsonb_build_object('role', _role, 'blocked', _blocked));
END; $$;

CREATE OR REPLACE FUNCTION public.admin_update_settings(_app_name TEXT, _support_email TEXT, _maintenance_mode BOOLEAN, _allow_registrations BOOLEAN, _ai_daily_limit INTEGER)
RETURNS public.system_settings LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE _result public.system_settings;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'admin access required' USING ERRCODE = '42501'; END IF;
  UPDATE public.system_settings SET app_name = trim(_app_name), support_email = trim(_support_email), maintenance_mode = _maintenance_mode,
    allow_registrations = _allow_registrations, ai_daily_limit = _ai_daily_limit, updated_at = now(), updated_by = auth.uid()
  WHERE id RETURNING * INTO _result;
  INSERT INTO public.admin_audit_logs(actor_id, action, details) VALUES (auth.uid(), 'settings.updated', jsonb_build_object('maintenanceMode', _maintenance_mode, 'allowRegistrations', _allow_registrations, 'aiDailyLimit', _ai_daily_limit));
  RETURN _result;
END; $$;

REVOKE EXECUTE ON FUNCTION public.admin_overview(), public.admin_list_users(TEXT, INTEGER), public.admin_set_user_access(UUID, public.app_role, BOOLEAN), public.admin_update_settings(TEXT, TEXT, BOOLEAN, BOOLEAN, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_overview(), public.admin_list_users(TEXT, INTEGER), public.admin_set_user_access(UUID, public.app_role, BOOLEAN), public.admin_update_settings(TEXT, TEXT, BOOLEAN, BOOLEAN, INTEGER) TO authenticated;
