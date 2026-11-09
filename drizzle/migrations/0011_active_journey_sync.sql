-- Keep a completion snapshot instead of deleting it: delayed devices cannot revive a finished journey.
CREATE SCHEMA IF NOT EXISTS private;
GRANT USAGE ON SCHEMA private TO authenticated, service_role;
CREATE OR REPLACE FUNCTION private.current_account_is_active() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = auth.uid()
    AND (u.banned_until IS NULL OR u.banned_until <= now()));
$$;
REVOKE ALL ON FUNCTION private.current_account_is_active() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.current_account_is_active() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.sync_active_work_journey(_user_id uuid, _state jsonb, _action text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE previous jsonb; incoming jsonb; journey_id uuid;
BEGIN
  IF _user_id IS DISTINCT FROM auth.uid() OR NOT private.current_account_is_active() THEN
    RAISE EXCEPTION 'active account required' USING ERRCODE = '42501';
  END IF;
  IF _action NOT IN ('start','update','finish') OR _action IS NULL
    OR jsonb_typeof(_state) IS DISTINCT FROM 'object' OR octet_length(_state::text) > 65536
    OR _state->>'source' NOT IN ('browser','external') OR _state->>'source' IS NULL
    OR jsonb_typeof(_state->'active') IS DISTINCT FROM 'boolean'
    OR jsonb_typeof(_state->'distanceKm') IS DISTINCT FROM 'number'
    OR NOT ((_state->>'distanceKm')::numeric BETWEEN 0 AND 1000000)
    OR jsonb_typeof(_state->'points') IS DISTINCT FROM 'number'
    OR NOT ((_state->>'points')::numeric BETWEEN 0 AND 1000000000000)
    OR _state->>'journeyId' IS NULL OR _state->>'startedAt' IS NULL
    OR _state->>'updatedAt' IS NULL THEN
    RAISE EXCEPTION 'invalid journey snapshot' USING ERRCODE = '22023';
  END IF;
  journey_id := (_state->>'journeyId')::uuid;
  PERFORM (_state->>'startedAt')::timestamptz, (_state->>'updatedAt')::timestamptz;
  IF _action = 'start' AND (_state->>'active')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'invalid start' USING ERRCODE = '22023';
  END IF;
  IF _action = 'finish' AND ((_state->>'active')::boolean OR _state->>'endedAt' IS NULL
    OR (_state->>'endedAt')::timestamptz < (_state->>'startedAt')::timestamptz) THEN
    RAISE EXCEPTION 'invalid finish' USING ERRCODE = '22023';
  END IF;
  IF _action <> 'finish' AND (NOT (_state->>'active')::boolean OR _state->>'endedAt' IS NOT NULL) THEN
    RAISE EXCEPTION 'invalid active state' USING ERRCODE = '22023';
  END IF;
  -- Serializes even the first insert, when no row exists to lock yet.
  PERFORM pg_advisory_xact_lock(hashtextextended(_user_id::text, 6012026));
  SELECT state INTO previous FROM public.active_work_journeys WHERE user_id = _user_id FOR UPDATE;
  IF previous IS NOT NULL THEN
    IF previous->>'journeyId' = journey_id::text THEN
      IF previous->>'endedAt' IS NOT NULL AND NOT (previous->>'active')::boolean THEN RETURN previous; END IF;
      IF _action <> 'finish' AND (_state->>'updatedAt')::timestamptz < (previous->>'updatedAt')::timestamptz THEN RETURN previous; END IF;
    ELSIF _action <> 'start' OR coalesce((previous->>'active')::boolean, false) THEN
      RETURN previous;
    END IF;
  ELSIF _action = 'update' THEN
    -- A stale progress update must not recreate a missing row.
    RETURN jsonb_build_object('active', false, 'source', 'browser', 'startedAt', null,
      'endedAt', null, 'distanceKm', 0, 'points', 0, 'last', null, 'synced', true);
  END IF;
  -- A device that missed several sessions must not restart a completed historic journey.
  IF _action = 'start' AND EXISTS (SELECT 1 FROM public.work_journeys WHERE id = journey_id AND user_id = _user_id) THEN
    RETURN coalesce(previous, jsonb_build_object('active', false, 'source', 'browser',
      'startedAt', null, 'endedAt', null, 'distanceKm', 0, 'points', 0, 'last', null));
  END IF;
  incoming := _state || jsonb_build_object('last', null, 'pendingSave', false, 'synced', true);
  IF previous->>'journeyId' = journey_id::text THEN
    incoming := incoming || jsonb_build_object('distanceKm', greatest((previous->>'distanceKm')::numeric, (_state->>'distanceKm')::numeric),
      'points', greatest((previous->>'points')::numeric, (_state->>'points')::numeric));
  END IF;
  INSERT INTO public.active_work_journeys(user_id, state, updated_at) VALUES (_user_id, incoming, clock_timestamp())
    ON CONFLICT(user_id) DO UPDATE SET state = excluded.state, updated_at = excluded.updated_at;
  RETURN incoming;
END;
$$;
REVOKE ALL ON FUNCTION public.sync_active_work_journey(uuid,jsonb,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sync_active_work_journey(uuid,jsonb,text) TO authenticated;
-- The guarded RPC is the only application write path, including legacy clients.
REVOKE INSERT, UPDATE, DELETE ON public.active_work_journeys FROM PUBLIC, anon, authenticated;
DROP POLICY IF EXISTS active_account_required ON public.active_work_journeys;
CREATE POLICY active_account_required ON public.active_work_journeys AS RESTRICTIVE FOR SELECT
  TO authenticated USING ((SELECT private.current_account_is_active()));
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') AND NOT EXISTS (
    SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'active_work_journeys'
  ) THEN ALTER PUBLICATION supabase_realtime ADD TABLE public.active_work_journeys; END IF;
END $$;

-- Saving completed history must also finish the snapshot, even if navigation
-- interrupted the originating device's network queue.
CREATE OR REPLACE FUNCTION private.close_saved_work_journey() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.ended_at IS NOT NULL THEN
    UPDATE public.active_work_journeys SET state = state || jsonb_build_object(
      'active', false, 'pendingSave', false, 'synced', true, 'last', null,
      'endedAt', NEW.ended_at, 'updatedAt', clock_timestamp(),
      'distanceKm', greatest((state->>'distanceKm')::numeric, NEW.distance_km)
    ), updated_at = clock_timestamp()
    WHERE user_id = NEW.user_id AND state->>'journeyId' = NEW.id::text
      AND coalesce((state->>'active')::boolean, false);
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.close_saved_work_journey() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS close_saved_work_journey ON public.work_journeys;
CREATE TRIGGER close_saved_work_journey AFTER INSERT OR UPDATE ON public.work_journeys
  FOR EACH ROW EXECUTE FUNCTION private.close_saved_work_journey();
