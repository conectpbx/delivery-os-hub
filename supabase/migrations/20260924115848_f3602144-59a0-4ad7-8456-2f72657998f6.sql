CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon;
GRANT USAGE ON SCHEMA private TO authenticated, service_role;

CREATE OR REPLACE FUNCTION private.is_super_admin(_user_id UUID DEFAULT auth.uid()) RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = 'super_admin'
  );
$$;
REVOKE EXECUTE ON FUNCTION private.is_super_admin(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.is_super_admin(UUID) TO authenticated, service_role;

DROP POLICY IF EXISTS "Super admins read settings" ON public.system_settings;
CREATE POLICY "Super admins read settings" ON public.system_settings FOR SELECT TO authenticated USING (private.is_super_admin(auth.uid()));
DROP POLICY IF EXISTS "Super admins read audit" ON public.admin_audit_logs;
CREATE POLICY "Super admins read audit" ON public.admin_audit_logs FOR SELECT TO authenticated USING (private.is_super_admin(auth.uid()));

REVOKE EXECUTE ON FUNCTION public.is_super_admin(UUID) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_my_system_access() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.admin_overview() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.admin_list_users(TEXT, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.admin_set_user_access(UUID, public.app_role, BOOLEAN) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.admin_update_settings(TEXT, TEXT, BOOLEAN, BOOLEAN, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.super_admin_update_module(TEXT, BOOLEAN) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_super_admin(UUID), public.get_my_system_access(), public.admin_overview(), public.admin_list_users(TEXT, INTEGER), public.admin_set_user_access(UUID, public.app_role, BOOLEAN), public.admin_update_settings(TEXT, TEXT, BOOLEAN, BOOLEAN, INTEGER), public.super_admin_update_module(TEXT, BOOLEAN) TO service_role;