-- Evolves the control plane into an ecosystem-wide super-admin console.

CREATE TABLE public.system_modules (
  key TEXT PRIMARY KEY CHECK (key ~ '^[a-z_]+$'),
  name TEXT NOT NULL CHECK (length(name) BETWEEN 2 AND 60),
  description TEXT NOT NULL DEFAULT '',
  enabled BOOLEAN NOT NULL DEFAULT true,
  position SMALLINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

INSERT INTO public.system_modules (key, name, description, position) VALUES
  ('dashboard', 'Dashboard', 'Indicadores e visão geral da operação', 10),
  ('deliveries', 'Entregas', 'Registro e acompanhamento de entregas', 20),
  ('finance', 'Financeiro', 'Abastecimentos, despesas e resultados', 30),
  ('maintenance', 'Manutenção', 'Agenda e custos de manutenção', 40),
  ('goals', 'Metas', 'Metas mensais e acompanhamento', 50),
  ('scanner', 'Scanner IA', 'Leitura inteligente de cupons', 60),
  ('reports', 'Relatórios', 'Relatórios e exportações', 70)
ON CONFLICT (key) DO NOTHING;

-- The installation owner is the only initial super admin.
UPDATE public.user_roles SET role = 'super_admin'
WHERE user_id = (SELECT id FROM auth.users ORDER BY created_at, id LIMIT 1);

CREATE OR REPLACE FUNCTION public.is_admin(_user_id UUID DEFAULT auth.uid()) RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  -- Kept for backwards compatibility with the first control-plane migration;
  -- ecosystem administration is deliberately exclusive to super admins.
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = 'super_admin');
$$;

CREATE OR REPLACE FUNCTION public.is_super_admin(_user_id UUID DEFAULT auth.uid()) RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = 'super_admin');
$$;

CREATE OR REPLACE FUNCTION public.assign_default_role() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE _role public.app_role := 'user';
BEGIN
  PERFORM pg_advisory_xact_lock(7152026);
  IF EXISTS (SELECT 1 FROM public.user_roles WHERE role = 'super_admin')
     AND NOT (SELECT allow_registrations FROM public.system_settings WHERE id) THEN
    RAISE EXCEPTION 'new registrations are temporarily disabled';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE role = 'super_admin') THEN _role := 'super_admin'; END IF;
  INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, _role) ON CONFLICT DO NOTHING;
  RETURN NEW;
END; $$;

ALTER TABLE public.system_modules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated read modules" ON public.system_modules FOR SELECT TO authenticated USING (true);
GRANT SELECT ON public.system_modules TO authenticated;
GRANT ALL ON public.system_modules TO service_role;

CREATE OR REPLACE FUNCTION public.get_my_system_access() RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT jsonb_build_object(
    'role', COALESCE((SELECT role::text FROM public.user_roles WHERE user_id = auth.uid()), 'user'),
    'maintenanceMode', (SELECT maintenance_mode FROM public.system_settings WHERE id),
    'modules', COALESCE((SELECT jsonb_object_agg(key, enabled) FROM public.system_modules), '{}'::jsonb)
  );
$$;

CREATE OR REPLACE FUNCTION public.admin_set_user_access(_user_id UUID, _role public.app_role, _blocked BOOLEAN)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth, pg_temp AS $$
DECLARE _old_role public.app_role;
BEGIN
  IF NOT public.is_super_admin() THEN RAISE EXCEPTION 'super admin access required' USING ERRCODE = '42501'; END IF;
  IF _user_id = auth.uid() AND (_role <> 'super_admin' OR _blocked) THEN RAISE EXCEPTION 'you cannot remove your own access'; END IF;
  SELECT role INTO _old_role FROM public.user_roles WHERE user_id = _user_id FOR UPDATE;
  IF _old_role = 'super_admin' AND _role <> 'super_admin'
     AND (SELECT count(*) FROM public.user_roles WHERE role = 'super_admin') <= 1 THEN
    RAISE EXCEPTION 'at least one super administrator is required';
  END IF;
  INSERT INTO public.user_roles (user_id, role, updated_at) VALUES (_user_id, _role, now())
  ON CONFLICT (user_id) DO UPDATE SET role = EXCLUDED.role, updated_at = now();
  UPDATE auth.users SET banned_until = CASE WHEN _blocked THEN now() + interval '100 years' ELSE NULL END WHERE id = _user_id;
  INSERT INTO public.admin_audit_logs(actor_id, action, target_id, details)
  VALUES (auth.uid(), 'user.access.updated', _user_id, jsonb_build_object('role', _role, 'blocked', _blocked));
END; $$;

CREATE OR REPLACE FUNCTION public.super_admin_update_module(_key TEXT, _enabled BOOLEAN)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT public.is_super_admin() THEN RAISE EXCEPTION 'super admin access required' USING ERRCODE = '42501'; END IF;
  UPDATE public.system_modules SET enabled = _enabled, updated_at = now(), updated_by = auth.uid() WHERE key = _key;
  IF NOT FOUND THEN RAISE EXCEPTION 'unknown module'; END IF;
  INSERT INTO public.admin_audit_logs(actor_id, action, details)
  VALUES (auth.uid(), 'module.updated', jsonb_build_object('key', _key, 'enabled', _enabled));
END; $$;

REVOKE EXECUTE ON FUNCTION public.is_super_admin(UUID), public.get_my_system_access(), public.super_admin_update_module(TEXT, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_super_admin(UUID), public.get_my_system_access(), public.super_admin_update_module(TEXT, BOOLEAN) TO authenticated;
