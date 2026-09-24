CREATE OR REPLACE FUNCTION private.get_my_system_access() RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT jsonb_build_object(
    'role', COALESCE((SELECT role::text FROM public.user_roles WHERE user_id = auth.uid() ORDER BY CASE role WHEN 'super_admin' THEN 1 WHEN 'admin' THEN 2 ELSE 3 END LIMIT 1), 'user'),
    'maintenanceMode', COALESCE((SELECT maintenance_mode FROM public.system_settings WHERE id), false),
    'modules', COALESCE((SELECT jsonb_object_agg(key, enabled) FROM public.system_modules), '{}'::jsonb)
  );
$$;

CREATE OR REPLACE FUNCTION private.admin_overview() RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, auth, pg_temp AS $$
BEGIN
  IF NOT private.is_super_admin() THEN RAISE EXCEPTION 'super admin access required' USING ERRCODE = '42501'; END IF;
  RETURN jsonb_build_object(
    'totalUsers', (SELECT count(*) FROM auth.users),
    'activeUsers30d', (SELECT count(*) FROM auth.users WHERE last_sign_in_at >= now() - interval '30 days'),
    'deliveries30d', (SELECT count(*) FROM public.deliveries WHERE occurred_at >= now() - interval '30 days'),
    'revenue30d', (SELECT COALESCE(sum(earnings + tip), 0) FROM public.deliveries WHERE occurred_at >= now() - interval '30 days'),
    'scansToday', (SELECT COALESCE(sum(count), 0) FROM public.ai_scan_usage WHERE usage_date = (now() AT TIME ZONE 'America/Sao_Paulo')::date)
  );
END;
$$;

CREATE OR REPLACE FUNCTION private.admin_list_users(_search TEXT, _limit INTEGER)
RETURNS TABLE(user_id UUID, email TEXT, full_name TEXT, role public.app_role, created_at TIMESTAMPTZ, last_sign_in_at TIMESTAMPTZ, is_blocked BOOLEAN, delivery_count BIGINT)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, auth, pg_temp AS $$
BEGIN
  IF NOT private.is_super_admin() THEN RAISE EXCEPTION 'super admin access required' USING ERRCODE = '42501'; END IF;
  RETURN QUERY SELECT u.id, u.email::text, p.full_name,
    COALESCE((SELECT ur.role FROM public.user_roles ur WHERE ur.user_id = u.id ORDER BY CASE ur.role WHEN 'super_admin' THEN 1 WHEN 'admin' THEN 2 ELSE 3 END LIMIT 1), 'user'::public.app_role),
    u.created_at, u.last_sign_in_at, COALESCE(u.banned_until > now(), false),
    (SELECT count(*) FROM public.deliveries d WHERE d.user_id = u.id)
  FROM auth.users u LEFT JOIN public.profiles p ON p.id = u.id
  WHERE _search = '' OR u.email ILIKE '%' || _search || '%' OR p.full_name ILIKE '%' || _search || '%'
  ORDER BY u.created_at DESC LIMIT LEAST(GREATEST(_limit, 1), 200);
END;
$$;

CREATE OR REPLACE FUNCTION private.admin_set_user_access(_user_id UUID, _role public.app_role, _blocked BOOLEAN) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth, pg_temp AS $$
DECLARE _old_role public.app_role;
BEGIN
  IF NOT private.is_super_admin() THEN RAISE EXCEPTION 'super admin access required' USING ERRCODE = '42501'; END IF;
  IF _user_id = auth.uid() AND (_role <> 'super_admin' OR _blocked) THEN RAISE EXCEPTION 'you cannot remove your own access'; END IF;
  SELECT role INTO _old_role FROM public.user_roles WHERE user_id = _user_id ORDER BY CASE role WHEN 'super_admin' THEN 1 WHEN 'admin' THEN 2 ELSE 3 END LIMIT 1;
  IF _old_role = 'super_admin' AND _role <> 'super_admin' AND (SELECT count(DISTINCT user_id) FROM public.user_roles WHERE role = 'super_admin') <= 1 THEN RAISE EXCEPTION 'at least one super administrator is required'; END IF;
  DELETE FROM public.user_roles WHERE user_id = _user_id;
  INSERT INTO public.user_roles (user_id, role) VALUES (_user_id, _role);
  UPDATE auth.users SET banned_until = CASE WHEN _blocked THEN now() + interval '100 years' ELSE NULL END WHERE id = _user_id;
  INSERT INTO public.admin_audit_logs(actor_id, action, target_id, details) VALUES (auth.uid(), 'user.access.updated', _user_id, jsonb_build_object('role', _role, 'blocked', _blocked));
END;
$$;

CREATE OR REPLACE FUNCTION private.admin_update_settings(_app_name TEXT, _support_email TEXT, _maintenance_mode BOOLEAN, _allow_registrations BOOLEAN, _ai_daily_limit INTEGER) RETURNS public.system_settings
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE _result public.system_settings;
BEGIN
  IF NOT private.is_super_admin() THEN RAISE EXCEPTION 'super admin access required' USING ERRCODE = '42501'; END IF;
  UPDATE public.system_settings SET app_name = trim(_app_name), support_email = trim(_support_email), maintenance_mode = _maintenance_mode, allow_registrations = _allow_registrations, ai_daily_limit = _ai_daily_limit, updated_at = now(), updated_by = auth.uid() WHERE id RETURNING * INTO _result;
  INSERT INTO public.admin_audit_logs(actor_id, action, details) VALUES (auth.uid(), 'settings.updated', jsonb_build_object('maintenanceMode', _maintenance_mode, 'allowRegistrations', _allow_registrations, 'aiDailyLimit', _ai_daily_limit));
  RETURN _result;
END;
$$;

CREATE OR REPLACE FUNCTION private.super_admin_update_module(_key TEXT, _enabled BOOLEAN) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT private.is_super_admin() THEN RAISE EXCEPTION 'super admin access required' USING ERRCODE = '42501'; END IF;
  UPDATE public.system_modules SET enabled = _enabled, updated_at = now(), updated_by = auth.uid() WHERE key = _key;
  IF NOT FOUND THEN RAISE EXCEPTION 'unknown module'; END IF;
  INSERT INTO public.admin_audit_logs(actor_id, action, details) VALUES (auth.uid(), 'module.updated', jsonb_build_object('key', _key, 'enabled', _enabled));
END;
$$;

REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA private FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.is_super_admin(UUID), private.get_my_system_access(), private.admin_overview(), private.admin_list_users(TEXT, INTEGER), private.admin_set_user_access(UUID, public.app_role, BOOLEAN), private.admin_update_settings(TEXT, TEXT, BOOLEAN, BOOLEAN, INTEGER), private.super_admin_update_module(TEXT, BOOLEAN) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.is_super_admin(_user_id UUID DEFAULT auth.uid()) RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public, private, pg_temp AS $$ SELECT private.is_super_admin(_user_id) $$;
CREATE OR REPLACE FUNCTION public.get_my_system_access() RETURNS JSONB LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public, private, pg_temp AS $$ SELECT private.get_my_system_access() $$;
CREATE OR REPLACE FUNCTION public.admin_overview() RETURNS JSONB LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public, private, pg_temp AS $$ SELECT private.admin_overview() $$;
CREATE OR REPLACE FUNCTION public.admin_list_users(_search TEXT DEFAULT '', _limit INTEGER DEFAULT 100) RETURNS TABLE(user_id UUID, email TEXT, full_name TEXT, role public.app_role, created_at TIMESTAMPTZ, last_sign_in_at TIMESTAMPTZ, is_blocked BOOLEAN, delivery_count BIGINT) LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public, private, pg_temp AS $$ SELECT * FROM private.admin_list_users(_search, _limit) $$;
CREATE OR REPLACE FUNCTION public.admin_set_user_access(_user_id UUID, _role public.app_role, _blocked BOOLEAN) RETURNS VOID LANGUAGE sql SECURITY INVOKER SET search_path = public, private, pg_temp AS $$ SELECT private.admin_set_user_access(_user_id, _role, _blocked) $$;
CREATE OR REPLACE FUNCTION public.admin_update_settings(_app_name TEXT, _support_email TEXT, _maintenance_mode BOOLEAN, _allow_registrations BOOLEAN, _ai_daily_limit INTEGER) RETURNS public.system_settings LANGUAGE sql SECURITY INVOKER SET search_path = public, private, pg_temp AS $$ SELECT private.admin_update_settings(_app_name, _support_email, _maintenance_mode, _allow_registrations, _ai_daily_limit) $$;
CREATE OR REPLACE FUNCTION public.super_admin_update_module(_key TEXT, _enabled BOOLEAN) RETURNS VOID LANGUAGE sql SECURITY INVOKER SET search_path = public, private, pg_temp AS $$ SELECT private.super_admin_update_module(_key, _enabled) $$;

REVOKE EXECUTE ON FUNCTION public.is_super_admin(UUID), public.get_my_system_access(), public.admin_overview(), public.admin_list_users(TEXT, INTEGER), public.admin_set_user_access(UUID, public.app_role, BOOLEAN), public.admin_update_settings(TEXT, TEXT, BOOLEAN, BOOLEAN, INTEGER), public.super_admin_update_module(TEXT, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_super_admin(UUID), public.get_my_system_access(), public.admin_overview(), public.admin_list_users(TEXT, INTEGER), public.admin_set_user_access(UUID, public.app_role, BOOLEAN), public.admin_update_settings(TEXT, TEXT, BOOLEAN, BOOLEAN, INTEGER), public.super_admin_update_module(TEXT, BOOLEAN) TO authenticated, service_role;