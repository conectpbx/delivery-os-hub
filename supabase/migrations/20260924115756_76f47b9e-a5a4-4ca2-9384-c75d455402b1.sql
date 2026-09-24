CREATE TYPE public.app_role AS ENUM ('super_admin', 'admin', 'user');

CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL DEFAULT 'user',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users read own roles" ON public.user_roles FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE TABLE public.system_settings (
  id BOOLEAN PRIMARY KEY DEFAULT true CHECK (id),
  app_name TEXT NOT NULL DEFAULT 'Delivery OS' CHECK (length(app_name) BETWEEN 2 AND 60),
  support_email TEXT NOT NULL DEFAULT '' CHECK (length(support_email) <= 254),
  maintenance_mode BOOLEAN NOT NULL DEFAULT false,
  allow_registrations BOOLEAN NOT NULL DEFAULT true,
  ai_daily_limit INTEGER NOT NULL DEFAULT 15 CHECK (ai_daily_limit BETWEEN 0 AND 100),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL
);
GRANT SELECT ON public.system_settings TO authenticated;
GRANT ALL ON public.system_settings TO service_role;
ALTER TABLE public.system_settings ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.admin_audit_logs (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  target_id UUID,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.admin_audit_logs TO authenticated;
GRANT ALL ON public.admin_audit_logs TO service_role;
ALTER TABLE public.admin_audit_logs ENABLE ROW LEVEL SECURITY;
CREATE INDEX admin_audit_logs_created_idx ON public.admin_audit_logs (created_at DESC);

CREATE TABLE public.system_modules (
  key TEXT PRIMARY KEY CHECK (key ~ '^[a-z_]+$'),
  name TEXT NOT NULL CHECK (length(name) BETWEEN 2 AND 60),
  description TEXT NOT NULL DEFAULT '',
  enabled BOOLEAN NOT NULL DEFAULT true,
  position SMALLINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL
);
GRANT SELECT ON public.system_modules TO authenticated;
GRANT ALL ON public.system_modules TO service_role;
ALTER TABLE public.system_modules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users read modules" ON public.system_modules FOR SELECT TO authenticated USING (true);

CREATE OR REPLACE FUNCTION public.is_super_admin(_user_id UUID DEFAULT auth.uid()) RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = 'super_admin'
  );
$$;
REVOKE EXECUTE ON FUNCTION public.is_super_admin(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_super_admin(UUID) TO authenticated;

CREATE POLICY "Super admins read settings" ON public.system_settings FOR SELECT TO authenticated USING (public.is_super_admin());
CREATE POLICY "Super admins read audit" ON public.admin_audit_logs FOR SELECT TO authenticated USING (public.is_super_admin());

INSERT INTO public.system_settings (id) VALUES (true) ON CONFLICT (id) DO NOTHING;
INSERT INTO public.system_modules (key, name, description, position) VALUES
  ('dashboard', 'Dashboard', 'Indicadores e visão geral da operação', 10),
  ('deliveries', 'Entregas', 'Registro e acompanhamento de entregas', 20),
  ('finance', 'Financeiro', 'Abastecimentos, despesas e resultados', 30),
  ('maintenance', 'Manutenção', 'Agenda e custos de manutenção', 40),
  ('goals', 'Metas', 'Metas mensais e acompanhamento', 50),
  ('scanner', 'Scanner IA', 'Leitura inteligente de cupons', 60),
  ('reports', 'Relatórios', 'Relatórios e exportações', 70)
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.user_roles (user_id, role)
SELECT id, CASE WHEN row_number() OVER (ORDER BY created_at, id) = 1 THEN 'super_admin'::public.app_role ELSE 'user'::public.app_role END
FROM auth.users
ON CONFLICT (user_id, role) DO NOTHING;

CREATE OR REPLACE FUNCTION public.handle_new_user() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name', ''))
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'user')
  ON CONFLICT (user_id, role) DO NOTHING;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_my_system_access() RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT jsonb_build_object(
    'role', COALESCE((SELECT role::text FROM public.user_roles WHERE user_id = auth.uid() ORDER BY CASE role WHEN 'super_admin' THEN 1 WHEN 'admin' THEN 2 ELSE 3 END LIMIT 1), 'user'),
    'maintenanceMode', COALESCE((SELECT maintenance_mode FROM public.system_settings WHERE id), false),
    'modules', COALESCE((SELECT jsonb_object_agg(key, enabled) FROM public.system_modules), '{}'::jsonb)
  );
$$;
REVOKE EXECUTE ON FUNCTION public.get_my_system_access() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_system_access() TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_overview() RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, auth, pg_temp AS $$
BEGIN
  IF NOT public.is_super_admin() THEN RAISE EXCEPTION 'super admin access required' USING ERRCODE = '42501'; END IF;
  RETURN jsonb_build_object(
    'totalUsers', (SELECT count(*) FROM auth.users),
    'activeUsers30d', (SELECT count(*) FROM auth.users WHERE last_sign_in_at >= now() - interval '30 days'),
    'deliveries30d', (SELECT count(*) FROM public.deliveries WHERE occurred_at >= now() - interval '30 days'),
    'revenue30d', (SELECT COALESCE(sum(earnings + tip), 0) FROM public.deliveries WHERE occurred_at >= now() - interval '30 days'),
    'scansToday', (SELECT COALESCE(sum(count), 0) FROM public.ai_scan_usage WHERE usage_date = (now() AT TIME ZONE 'America/Sao_Paulo')::date)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_list_users(_search TEXT DEFAULT '', _limit INTEGER DEFAULT 100)
RETURNS TABLE(user_id UUID, email TEXT, full_name TEXT, role public.app_role, created_at TIMESTAMPTZ, last_sign_in_at TIMESTAMPTZ, is_blocked BOOLEAN, delivery_count BIGINT)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, auth, pg_temp AS $$
BEGIN
  IF NOT public.is_super_admin() THEN RAISE EXCEPTION 'super admin access required' USING ERRCODE = '42501'; END IF;
  RETURN QUERY
  SELECT u.id, u.email::text, p.full_name,
    COALESCE((SELECT ur.role FROM public.user_roles ur WHERE ur.user_id = u.id ORDER BY CASE ur.role WHEN 'super_admin' THEN 1 WHEN 'admin' THEN 2 ELSE 3 END LIMIT 1), 'user'::public.app_role),
    u.created_at, u.last_sign_in_at, COALESCE(u.banned_until > now(), false),
    (SELECT count(*) FROM public.deliveries d WHERE d.user_id = u.id)
  FROM auth.users u LEFT JOIN public.profiles p ON p.id = u.id
  WHERE _search = '' OR u.email ILIKE '%' || _search || '%' OR p.full_name ILIKE '%' || _search || '%'
  ORDER BY u.created_at DESC LIMIT LEAST(GREATEST(_limit, 1), 200);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_set_user_access(_user_id UUID, _role public.app_role, _blocked BOOLEAN) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth, pg_temp AS $$
DECLARE _old_role public.app_role;
BEGIN
  IF NOT public.is_super_admin() THEN RAISE EXCEPTION 'super admin access required' USING ERRCODE = '42501'; END IF;
  IF _user_id = auth.uid() AND (_role <> 'super_admin' OR _blocked) THEN RAISE EXCEPTION 'you cannot remove your own access'; END IF;
  SELECT role INTO _old_role FROM public.user_roles WHERE user_id = _user_id ORDER BY CASE role WHEN 'super_admin' THEN 1 WHEN 'admin' THEN 2 ELSE 3 END LIMIT 1 FOR UPDATE;
  IF _old_role = 'super_admin' AND _role <> 'super_admin' AND (SELECT count(DISTINCT user_id) FROM public.user_roles WHERE role = 'super_admin') <= 1 THEN
    RAISE EXCEPTION 'at least one super administrator is required';
  END IF;
  DELETE FROM public.user_roles WHERE user_id = _user_id;
  INSERT INTO public.user_roles (user_id, role) VALUES (_user_id, _role);
  UPDATE auth.users SET banned_until = CASE WHEN _blocked THEN now() + interval '100 years' ELSE NULL END WHERE id = _user_id;
  INSERT INTO public.admin_audit_logs(actor_id, action, target_id, details)
  VALUES (auth.uid(), 'user.access.updated', _user_id, jsonb_build_object('role', _role, 'blocked', _blocked));
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_update_settings(_app_name TEXT, _support_email TEXT, _maintenance_mode BOOLEAN, _allow_registrations BOOLEAN, _ai_daily_limit INTEGER)
RETURNS public.system_settings LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE _result public.system_settings;
BEGIN
  IF NOT public.is_super_admin() THEN RAISE EXCEPTION 'super admin access required' USING ERRCODE = '42501'; END IF;
  UPDATE public.system_settings SET app_name = trim(_app_name), support_email = trim(_support_email), maintenance_mode = _maintenance_mode,
    allow_registrations = _allow_registrations, ai_daily_limit = _ai_daily_limit, updated_at = now(), updated_by = auth.uid()
  WHERE id RETURNING * INTO _result;
  INSERT INTO public.admin_audit_logs(actor_id, action, details)
  VALUES (auth.uid(), 'settings.updated', jsonb_build_object('maintenanceMode', _maintenance_mode, 'allowRegistrations', _allow_registrations, 'aiDailyLimit', _ai_daily_limit));
  RETURN _result;
END;
$$;

CREATE OR REPLACE FUNCTION public.super_admin_update_module(_key TEXT, _enabled BOOLEAN) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT public.is_super_admin() THEN RAISE EXCEPTION 'super admin access required' USING ERRCODE = '42501'; END IF;
  UPDATE public.system_modules SET enabled = _enabled, updated_at = now(), updated_by = auth.uid() WHERE key = _key;
  IF NOT FOUND THEN RAISE EXCEPTION 'unknown module'; END IF;
  INSERT INTO public.admin_audit_logs(actor_id, action, details)
  VALUES (auth.uid(), 'module.updated', jsonb_build_object('key', _key, 'enabled', _enabled));
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_overview(), public.admin_list_users(TEXT, INTEGER), public.admin_set_user_access(UUID, public.app_role, BOOLEAN), public.admin_update_settings(TEXT, TEXT, BOOLEAN, BOOLEAN, INTEGER), public.super_admin_update_module(TEXT, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_overview(), public.admin_list_users(TEXT, INTEGER), public.admin_set_user_access(UUID, public.app_role, BOOLEAN), public.admin_update_settings(TEXT, TEXT, BOOLEAN, BOOLEAN, INTEGER), public.super_admin_update_module(TEXT, BOOLEAN) TO authenticated;