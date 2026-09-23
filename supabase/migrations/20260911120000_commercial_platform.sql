-- Commercial platform: tenants, plans, subscriptions, entitlements and PWA operations.
CREATE TYPE public.subscription_status AS ENUM ('trialing', 'active', 'past_due', 'suspended', 'canceled');
CREATE TYPE public.feature_rollout_kind AS ENUM ('all', 'percentage', 'allowlist');

CREATE TABLE public.plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), slug TEXT UNIQUE NOT NULL CHECK (slug ~ '^[a-z0-9_-]+$'),
  name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', price_cents INTEGER NOT NULL DEFAULT 0 CHECK (price_cents >= 0),
  billing_interval TEXT NOT NULL DEFAULT 'month' CHECK (billing_interval IN ('month','year','free')),
  provider_price_id TEXT UNIQUE,
  trial_days SMALLINT NOT NULL DEFAULT 0 CHECK (trial_days BETWEEN 0 AND 365), active BOOLEAN NOT NULL DEFAULT true,
  limits JSONB NOT NULL DEFAULT '{}'::jsonb, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE public.plan_modules (
  plan_id UUID NOT NULL REFERENCES public.plans(id) ON DELETE CASCADE,
  module_key TEXT NOT NULL REFERENCES public.system_modules(key) ON DELETE CASCADE,
  enabled BOOLEAN NOT NULL DEFAULT true, PRIMARY KEY (plan_id, module_key)
);
CREATE TABLE public.organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), name TEXT NOT NULL, slug TEXT UNIQUE NOT NULL CHECK (slug ~ '^[a-z0-9-]+$'),
  owner_id UUID NOT NULL REFERENCES auth.users(id), active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE public.organization_members (
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  member_role TEXT NOT NULL DEFAULT 'member' CHECK (member_role IN ('owner','manager','member')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY (organization_id, user_id)
);
CREATE TABLE public.subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), organization_id UUID UNIQUE NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  plan_id UUID NOT NULL REFERENCES public.plans(id), status public.subscription_status NOT NULL DEFAULT 'trialing',
  trial_ends_at TIMESTAMPTZ, current_period_ends_at TIMESTAMPTZ, grace_ends_at TIMESTAMPTZ,
  provider TEXT, provider_customer_id TEXT, provider_subscription_id TEXT UNIQUE,
  cancel_at_period_end BOOLEAN NOT NULL DEFAULT false, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE public.module_overrides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), module_key TEXT NOT NULL REFERENCES public.system_modules(key) ON DELETE CASCADE,
  organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE, user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  enabled BOOLEAN NOT NULL, expires_at TIMESTAMPTZ, reason TEXT NOT NULL DEFAULT '', created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((organization_id IS NOT NULL)::int + (user_id IS NOT NULL)::int = 1)
);
CREATE UNIQUE INDEX module_override_org_unique ON public.module_overrides(module_key, organization_id) WHERE organization_id IS NOT NULL;
CREATE UNIQUE INDEX module_override_user_unique ON public.module_overrides(module_key, user_id) WHERE user_id IS NOT NULL;

CREATE TABLE public.feature_flags (
  key TEXT PRIMARY KEY CHECK (key ~ '^[a-z0-9_.-]+$'), name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
  enabled BOOLEAN NOT NULL DEFAULT false, rollout_kind public.feature_rollout_kind NOT NULL DEFAULT 'all',
  rollout_percentage SMALLINT NOT NULL DEFAULT 100 CHECK (rollout_percentage BETWEEN 0 AND 100),
  allowlist UUID[] NOT NULL DEFAULT '{}', payload JSONB NOT NULL DEFAULT '{}'::jsonb, updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE public.pwa_releases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), version TEXT UNIQUE NOT NULL, minimum_version TEXT NOT NULL,
  force_update BOOLEAN NOT NULL DEFAULT false, store_url TEXT, notes TEXT NOT NULL DEFAULT '', active BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), published_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX one_active_pwa_release ON public.pwa_releases(active) WHERE active;
CREATE TABLE public.system_announcements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), title TEXT NOT NULL, message TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'info' CHECK (severity IN ('info','warning','critical')),
  starts_at TIMESTAMPTZ NOT NULL DEFAULT now(), ends_at TIMESTAMPTZ, active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE public.maintenance_windows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), title TEXT NOT NULL, message TEXT NOT NULL DEFAULT '',
  starts_at TIMESTAMPTZ NOT NULL, ends_at TIMESTAMPTZ NOT NULL CHECK (ends_at > starts_at),
  block_access BOOLEAN NOT NULL DEFAULT true, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE public.billing_events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY, provider TEXT NOT NULL, provider_event_id TEXT NOT NULL,
  event_type TEXT NOT NULL, payload JSONB NOT NULL, processed_at TIMESTAMPTZ, error TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(provider, provider_event_id)
);

INSERT INTO public.plans(slug,name,description,price_cents,billing_interval,trial_days,limits) VALUES
 ('starter','Starter','Operação essencial para entregadores',0,'free',14,'{"ai_scans_day":3}'::jsonb),
 ('pro','Pro','Todos os recursos para profissionais',2990,'month',14,'{"ai_scans_day":15}'::jsonb),
 ('business','Business','Gestão de equipes e operação ampliada',7990,'month',30,'{"ai_scans_day":50,"members":20}'::jsonb);
INSERT INTO public.plan_modules(plan_id,module_key,enabled)
SELECT p.id,m.key, CASE WHEN p.slug='starter' THEN m.key IN ('dashboard','deliveries','finance','goals') ELSE true END
FROM public.plans p CROSS JOIN public.system_modules m;

-- Every current account receives a personal tenant and a trial subscription.
INSERT INTO public.organizations(name,slug,owner_id)
SELECT COALESCE(NULLIF(p.full_name,''), split_part(u.email,'@',1), 'Workspace'), 'personal-' || replace(u.id::text,'-',''), u.id
FROM auth.users u LEFT JOIN public.profiles p ON p.id=u.id ON CONFLICT(slug) DO NOTHING;
INSERT INTO public.organization_members(organization_id,user_id,member_role)
SELECT id,owner_id,'owner' FROM public.organizations ON CONFLICT DO NOTHING;
INSERT INTO public.subscriptions(organization_id,plan_id,status,trial_ends_at,current_period_ends_at)
SELECT o.id,p.id,'trialing',now()+make_interval(days=>p.trial_days),now()+make_interval(days=>p.trial_days)
FROM public.organizations o CROSS JOIN public.plans p WHERE p.slug='pro' ON CONFLICT(organization_id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.create_personal_organization() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE _org UUID; _plan UUID; _trial SMALLINT;
BEGIN
  INSERT INTO public.organizations(name,slug,owner_id) VALUES(COALESCE(NULLIF(NEW.raw_user_meta_data->>'full_name',''),split_part(NEW.email,'@',1),'Workspace'),'personal-'||replace(NEW.id::text,'-',''),NEW.id) RETURNING id INTO _org;
  INSERT INTO public.organization_members VALUES(_org,NEW.id,'owner',now());
  SELECT id,trial_days INTO _plan,_trial FROM public.plans WHERE slug='pro';
  INSERT INTO public.subscriptions(organization_id,plan_id,status,trial_ends_at,current_period_ends_at) VALUES(_org,_plan,'trialing',now()+make_interval(days=>_trial),now()+make_interval(days=>_trial));
  RETURN NEW;
END $$;
CREATE TRIGGER create_personal_organization_after_signup AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.create_personal_organization();

ALTER TABLE public.plans ENABLE ROW LEVEL SECURITY; ALTER TABLE public.plan_modules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY; ALTER TABLE public.organization_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY; ALTER TABLE public.module_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.feature_flags ENABLE ROW LEVEL SECURITY; ALTER TABLE public.pwa_releases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.system_announcements ENABLE ROW LEVEL SECURITY; ALTER TABLE public.maintenance_windows ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members read organization" ON public.organizations FOR SELECT TO authenticated USING (public.is_super_admin() OR EXISTS(SELECT 1 FROM public.organization_members om WHERE om.organization_id=id AND om.user_id=auth.uid()));
CREATE POLICY "members read membership" ON public.organization_members FOR SELECT TO authenticated USING (public.is_super_admin() OR user_id=auth.uid());
CREATE POLICY "members read subscription" ON public.subscriptions FOR SELECT TO authenticated USING (public.is_super_admin() OR EXISTS(SELECT 1 FROM public.organization_members om WHERE om.organization_id=organization_id AND om.user_id=auth.uid()));
CREATE POLICY "authenticated read plans" ON public.plans FOR SELECT TO authenticated USING(active OR public.is_super_admin());
CREATE POLICY "authenticated read plan modules" ON public.plan_modules FOR SELECT TO authenticated USING(true);
CREATE POLICY "authenticated read flags" ON public.feature_flags FOR SELECT TO authenticated USING(true);
CREATE POLICY "authenticated read releases" ON public.pwa_releases FOR SELECT TO authenticated USING(active OR public.is_super_admin());
CREATE POLICY "authenticated read announcements" ON public.system_announcements FOR SELECT TO authenticated USING(public.is_super_admin() OR (active AND starts_at<=now() AND (ends_at IS NULL OR ends_at>now())));
CREATE POLICY "authenticated read maintenance" ON public.maintenance_windows FOR SELECT TO authenticated USING(public.is_super_admin() OR (starts_at<=now() AND ends_at>now()));
CREATE POLICY "super admins read overrides" ON public.module_overrides FOR SELECT TO authenticated USING(public.is_super_admin());
CREATE POLICY "super admins read billing" ON public.billing_events FOR SELECT TO authenticated USING(public.is_super_admin());
GRANT SELECT ON public.plans,public.plan_modules,public.organizations,public.organization_members,public.subscriptions,public.module_overrides,public.feature_flags,public.pwa_releases,public.system_announcements,public.maintenance_windows TO authenticated;
GRANT ALL ON public.plans,public.plan_modules,public.organizations,public.organization_members,public.subscriptions,public.module_overrides,public.feature_flags,public.pwa_releases,public.system_announcements,public.maintenance_windows,public.billing_events TO service_role;
REVOKE EXECUTE ON FUNCTION public.create_personal_organization() FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.get_my_system_access() RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE _uid UUID:=auth.uid(); _org UUID; _status public.subscription_status; _mods JSONB; _flags JSONB; _release JSONB; _notice JSONB; _maintenance JSONB; _role TEXT;
BEGIN
 SELECT role::text INTO _role FROM public.user_roles WHERE user_id=_uid;
 SELECT om.organization_id,CASE
   WHEN s.status='trialing' AND s.trial_ends_at<now() THEN 'suspended'::public.subscription_status
   WHEN s.status='active' AND s.current_period_ends_at<now() AND COALESCE(s.grace_ends_at,s.current_period_ends_at)<now() THEN 'past_due'::public.subscription_status
   ELSE s.status END INTO _org,_status
 FROM public.organization_members om JOIN public.subscriptions s ON s.organization_id=om.organization_id WHERE om.user_id=_uid ORDER BY om.created_at LIMIT 1;
 SELECT COALESCE(jsonb_object_agg(sm.key, sm.enabled AND COALESCE(pm.enabled,false)), '{}'::jsonb) INTO _mods FROM public.system_modules sm LEFT JOIN public.subscriptions s ON s.organization_id=_org LEFT JOIN public.plan_modules pm ON pm.plan_id=s.plan_id AND pm.module_key=sm.key;
 SELECT COALESCE(_mods,'{}'::jsonb)||COALESCE(jsonb_object_agg(mo.module_key,mo.enabled) FILTER(WHERE mo.id IS NOT NULL),'{}'::jsonb) INTO _mods FROM public.module_overrides mo WHERE (mo.user_id=_uid OR mo.organization_id=_org) AND (mo.expires_at IS NULL OR mo.expires_at>now());
 IF _status IN ('past_due','suspended','canceled') THEN _mods:='{}'::jsonb; END IF;
 SELECT COALESCE(jsonb_object_agg(key, enabled AND (rollout_kind='all' OR (rollout_kind='percentage' AND mod(abs(hashtext(_uid::text)),100)<rollout_percentage) OR (rollout_kind='allowlist' AND _uid=ANY(allowlist)))),'{}'::jsonb) INTO _flags FROM public.feature_flags;
 SELECT to_jsonb(r) INTO _release FROM (SELECT version,"minimum_version",force_update,"store_url",notes FROM public.pwa_releases WHERE active LIMIT 1) r;
 SELECT to_jsonb(a) INTO _notice FROM (SELECT id,title,message,severity,ends_at FROM public.system_announcements WHERE active AND starts_at<=now() AND (ends_at IS NULL OR ends_at>now()) ORDER BY severity DESC,starts_at DESC LIMIT 1) a;
 SELECT to_jsonb(w) INTO _maintenance FROM (SELECT id,title,message,ends_at,block_access FROM public.maintenance_windows WHERE starts_at<=now() AND ends_at>now() ORDER BY starts_at DESC LIMIT 1) w;
 RETURN jsonb_build_object('role',COALESCE(_role,'user'),'organizationId',_org,'subscriptionStatus',COALESCE(_status::text,'suspended'),'modules',_mods,'features',_flags,'release',_release,'announcement',_notice,'maintenance',_maintenance);
END $$;

CREATE OR REPLACE FUNCTION public.commercial_admin_snapshot() RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$ BEGIN
 IF NOT public.is_super_admin() THEN RAISE EXCEPTION 'super admin access required' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object(
 'plans',(SELECT COALESCE(jsonb_agg(to_jsonb(p)||jsonb_build_object('modules',(SELECT COALESCE(jsonb_object_agg(pm.module_key,pm.enabled),'{}'::jsonb) FROM public.plan_modules pm WHERE pm.plan_id=p.id)) ORDER BY p.price_cents),'[]'::jsonb) FROM public.plans p),
 'subscriptions',(SELECT COALESCE(jsonb_agg(jsonb_build_object('id',s.id,'organizationId',o.id,'organizationName',o.name,'planId',s.plan_id,'status',s.status,'trialEndsAt',s.trial_ends_at,'periodEndsAt',s.current_period_ends_at) ORDER BY s.updated_at DESC),'[]'::jsonb) FROM public.subscriptions s JOIN public.organizations o ON o.id=s.organization_id),
 'features',(SELECT COALESCE(jsonb_agg(to_jsonb(f) ORDER BY f.key),'[]'::jsonb) FROM public.feature_flags f),
 'releases',(SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY r.created_at DESC),'[]'::jsonb) FROM public.pwa_releases r),
 'announcements',(SELECT COALESCE(jsonb_agg(to_jsonb(a) ORDER BY a.created_at DESC),'[]'::jsonb) FROM public.system_announcements a)
 ); END $$;

CREATE OR REPLACE FUNCTION public.super_admin_update_subscription(_organization_id UUID,_plan_id UUID,_status public.subscription_status,_trial_ends_at TIMESTAMPTZ DEFAULT NULL) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$ BEGIN
 IF NOT public.is_super_admin() THEN RAISE EXCEPTION 'super admin access required'; END IF;
 UPDATE public.subscriptions SET plan_id=_plan_id,status=_status,trial_ends_at=COALESCE(_trial_ends_at,trial_ends_at),updated_at=now() WHERE organization_id=_organization_id;
 INSERT INTO public.admin_audit_logs(actor_id,action,target_id,details) VALUES(auth.uid(),'subscription.updated',_organization_id,jsonb_build_object('planId',_plan_id,'status',_status)); END $$;

CREATE OR REPLACE FUNCTION public.super_admin_set_plan_module(_plan_id UUID,_module_key TEXT,_enabled BOOLEAN) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$ BEGIN
 IF NOT public.is_super_admin() THEN RAISE EXCEPTION 'super admin access required'; END IF;
 INSERT INTO public.plan_modules VALUES(_plan_id,_module_key,_enabled) ON CONFLICT(plan_id,module_key) DO UPDATE SET enabled=EXCLUDED.enabled;
 INSERT INTO public.admin_audit_logs(actor_id,action,target_id,details) VALUES(auth.uid(),'plan.module.updated',_plan_id,jsonb_build_object('module',_module_key,'enabled',_enabled)); END $$;

CREATE OR REPLACE FUNCTION public.super_admin_set_feature(_key TEXT,_name TEXT,_enabled BOOLEAN,_kind public.feature_rollout_kind,_percentage INTEGER) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$ BEGIN
 IF NOT public.is_super_admin() THEN RAISE EXCEPTION 'super admin access required'; END IF;
 INSERT INTO public.feature_flags(key,name,enabled,rollout_kind,rollout_percentage) VALUES(_key,_name,_enabled,_kind,_percentage) ON CONFLICT(key) DO UPDATE SET name=EXCLUDED.name,enabled=EXCLUDED.enabled,rollout_kind=EXCLUDED.rollout_kind,rollout_percentage=EXCLUDED.rollout_percentage,updated_at=now();
 INSERT INTO public.admin_audit_logs(actor_id,action,details) VALUES(auth.uid(),'feature.updated',jsonb_build_object('key',_key,'enabled',_enabled,'percentage',_percentage)); END $$;

CREATE OR REPLACE FUNCTION public.process_billing_event(_provider TEXT,_event_id TEXT,_event_type TEXT,_payload JSONB) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE _customer TEXT:=_payload->>'customer'; _external_subscription TEXT:=_payload->>'id'; _price TEXT:=_payload#>>'{items,data,0,price,id}'; _plan UUID; _mapped public.subscription_status;
BEGIN
 IF auth.role()<>'service_role' THEN RAISE EXCEPTION 'service role required' USING ERRCODE='42501'; END IF;
 INSERT INTO public.billing_events(provider,provider_event_id,event_type,payload) VALUES(_provider,_event_id,_event_type,_payload) ON CONFLICT(provider,provider_event_id) DO NOTHING;
 IF NOT FOUND THEN RETURN; END IF;
 IF _event_type LIKE 'customer.subscription.%' THEN
   SELECT id INTO _plan FROM public.plans WHERE provider_price_id=_price;
   _mapped:=CASE _payload->>'status' WHEN 'trialing' THEN 'trialing'::public.subscription_status WHEN 'active' THEN 'active'::public.subscription_status WHEN 'past_due' THEN 'past_due'::public.subscription_status WHEN 'canceled' THEN 'canceled'::public.subscription_status WHEN 'unpaid' THEN 'suspended'::public.subscription_status ELSE 'suspended'::public.subscription_status END;
   UPDATE public.subscriptions SET plan_id=COALESCE(_plan,plan_id),status=_mapped,provider=_provider,provider_subscription_id=_external_subscription,
     current_period_ends_at=CASE WHEN (_payload->>'current_period_end') IS NOT NULL THEN to_timestamp((_payload->>'current_period_end')::double precision) ELSE current_period_ends_at END,updated_at=now()
   WHERE provider_customer_id=_customer OR provider_subscription_id=_external_subscription;
 END IF;
 UPDATE public.billing_events SET processed_at=now() WHERE provider=_provider AND provider_event_id=_event_id;
END $$;

CREATE OR REPLACE FUNCTION public.super_admin_publish_release(_version TEXT,_minimum_version TEXT,_force BOOLEAN,_notes TEXT) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$ BEGIN
 IF NOT public.is_super_admin() THEN RAISE EXCEPTION 'super admin access required'; END IF;
 UPDATE public.pwa_releases SET active=false WHERE active;
 INSERT INTO public.pwa_releases(version,minimum_version,force_update,notes,active,published_at) VALUES(_version,_minimum_version,_force,_notes,true,now())
 ON CONFLICT(version) DO UPDATE SET minimum_version=EXCLUDED.minimum_version,force_update=EXCLUDED.force_update,notes=EXCLUDED.notes,active=true,published_at=now();
 INSERT INTO public.admin_audit_logs(actor_id,action,details) VALUES(auth.uid(),'pwa.release.published',jsonb_build_object('version',_version,'minimum',_minimum_version,'force',_force)); END $$;

CREATE OR REPLACE FUNCTION public.super_admin_publish_announcement(_title TEXT,_message TEXT,_severity TEXT,_ends_at TIMESTAMPTZ DEFAULT NULL) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$ BEGIN
 IF NOT public.is_super_admin() THEN RAISE EXCEPTION 'super admin access required'; END IF;
 INSERT INTO public.system_announcements(title,message,severity,ends_at) VALUES(_title,_message,_severity,_ends_at);
 INSERT INTO public.admin_audit_logs(actor_id,action,details) VALUES(auth.uid(),'announcement.published',jsonb_build_object('title',_title,'severity',_severity)); END $$;

CREATE OR REPLACE FUNCTION public.super_admin_schedule_maintenance(_title TEXT,_message TEXT,_starts_at TIMESTAMPTZ,_ends_at TIMESTAMPTZ,_block BOOLEAN) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$ BEGIN
 IF NOT public.is_super_admin() THEN RAISE EXCEPTION 'super admin access required'; END IF;
 INSERT INTO public.maintenance_windows(title,message,starts_at,ends_at,block_access) VALUES(_title,_message,_starts_at,_ends_at,_block);
 INSERT INTO public.admin_audit_logs(actor_id,action,details) VALUES(auth.uid(),'maintenance.scheduled',jsonb_build_object('title',_title,'startsAt',_starts_at,'endsAt',_ends_at)); END $$;

REVOKE EXECUTE ON FUNCTION public.commercial_admin_snapshot(),public.super_admin_update_subscription(UUID,UUID,public.subscription_status,TIMESTAMPTZ),public.super_admin_set_plan_module(UUID,TEXT,BOOLEAN),public.super_admin_set_feature(TEXT,TEXT,BOOLEAN,public.feature_rollout_kind,INTEGER) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.commercial_admin_snapshot(),public.super_admin_update_subscription(UUID,UUID,public.subscription_status,TIMESTAMPTZ),public.super_admin_set_plan_module(UUID,TEXT,BOOLEAN),public.super_admin_set_feature(TEXT,TEXT,BOOLEAN,public.feature_rollout_kind,INTEGER) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.process_billing_event(TEXT,TEXT,TEXT,JSONB) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.process_billing_event(TEXT,TEXT,TEXT,JSONB) TO service_role;
REVOKE EXECUTE ON FUNCTION public.super_admin_publish_release(TEXT,TEXT,BOOLEAN,TEXT),public.super_admin_publish_announcement(TEXT,TEXT,TEXT,TIMESTAMPTZ),public.super_admin_schedule_maintenance(TEXT,TEXT,TIMESTAMPTZ,TIMESTAMPTZ,BOOLEAN) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.super_admin_publish_release(TEXT,TEXT,BOOLEAN,TEXT),public.super_admin_publish_announcement(TEXT,TEXT,TEXT,TIMESTAMPTZ),public.super_admin_schedule_maintenance(TEXT,TEXT,TIMESTAMPTZ,TIMESTAMPTZ,BOOLEAN) TO authenticated;
