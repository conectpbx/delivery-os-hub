CREATE TABLE IF NOT EXISTS public.gps_route_sessions (
  id UUID PRIMARY KEY,
  token_id UUID NOT NULL REFERENCES public.gps_device_tokens(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  started_at TIMESTAMPTZ NOT NULL,
  ended_at TIMESTAMPTZ,
  start_total_km DOUBLE PRECISION,
  end_total_km DOUBLE PRECISION,
  distance_km DOUBLE PRECISION NOT NULL DEFAULT 0,
  point_count BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.gps_route_sessions ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.gps_route_sessions TO authenticated;
GRANT ALL ON public.gps_route_sessions TO service_role;

DROP POLICY IF EXISTS "Users read own GPS route sessions" ON public.gps_route_sessions;
CREATE POLICY "Users read own GPS route sessions"
ON public.gps_route_sessions
FOR SELECT TO authenticated
USING (auth.uid() = user_id);

ALTER TABLE public.gps_route_points
ADD COLUMN IF NOT EXISTS route_id UUID REFERENCES public.gps_route_sessions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS gps_route_points_route_captured_idx
ON public.gps_route_points(route_id, captured_at ASC);

CREATE INDEX IF NOT EXISTS gps_route_sessions_user_started_idx
ON public.gps_route_sessions(user_id, started_at DESC);

CREATE OR REPLACE FUNCTION public.ingest_gps_device_point(
  _point_id UUID,
  _route_id UUID,
  _token_hash TEXT,
  _source TEXT,
  _latitude DOUBLE PRECISION,
  _longitude DOUBLE PRECISION,
  _accuracy_m DOUBLE PRECISION,
  _speed_kmh DOUBLE PRECISION,
  _trip_km DOUBLE PRECISION,
  _total_km DOUBLE PRECISION,
  _captured_at TIMESTAMPTZ,
  _sent_at TIMESTAMPTZ
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  _device public.gps_device_tokens;
  _row_count BIGINT := 0;
BEGIN
  SELECT * INTO _device
  FROM public.gps_device_tokens
  WHERE token_hash = _token_hash
    AND is_active
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('accepted', false, 'reason', 'unauthorized');
  END IF;

  IF _route_id IS NOT NULL THEN
    INSERT INTO public.gps_route_sessions(
      id, token_id, user_id, started_at, start_total_km
    )
    VALUES (
      _route_id, _device.id, _device.user_id, _captured_at, _total_km
    )
    ON CONFLICT (id) DO NOTHING;
  END IF;

  INSERT INTO public.gps_route_points(
    point_id, route_id, token_id, user_id, source, latitude, longitude,
    accuracy_m, speed_kmh, trip_km, total_km, captured_at, sent_at
  )
  VALUES (
    _point_id, _route_id, _device.id, _device.user_id, _source, _latitude, _longitude,
    _accuracy_m, _speed_kmh, _trip_km, _total_km, _captured_at, _sent_at
  )
  ON CONFLICT (point_id) DO NOTHING;

  GET DIAGNOSTICS _row_count = ROW_COUNT;

  INSERT INTO public.gps_device_state(
    token_id, user_id, source, latitude, longitude, accuracy_m,
    speed_kmh, trip_km, total_km, captured_at, sent_at
  )
  VALUES (
    _device.id, _device.user_id, _source, _latitude, _longitude, _accuracy_m,
    _speed_kmh, _trip_km, _total_km, _captured_at, _sent_at
  )
  ON CONFLICT (token_id) DO UPDATE SET
    source = EXCLUDED.source,
    latitude = EXCLUDED.latitude,
    longitude = EXCLUDED.longitude,
    accuracy_m = EXCLUDED.accuracy_m,
    speed_kmh = EXCLUDED.speed_kmh,
    trip_km = EXCLUDED.trip_km,
    total_km = EXCLUDED.total_km,
    captured_at = EXCLUDED.captured_at,
    sent_at = EXCLUDED.sent_at,
    received_at = now(),
    updated_at = now()
  WHERE EXCLUDED.captured_at >= public.gps_device_state.captured_at;

  IF _route_id IS NOT NULL AND _row_count > 0 THEN
    UPDATE public.gps_route_sessions
    SET
      end_total_km = _total_km,
      distance_km = GREATEST(_trip_km, 0),
      point_count = point_count + 1,
      updated_at = now()
    WHERE id = _route_id
      AND user_id = _device.user_id;
  END IF;

  UPDATE public.gps_device_tokens
  SET last_used_at = now()
  WHERE id = _device.id;

  RETURN jsonb_build_object(
    'accepted', true,
    'reason', CASE WHEN _row_count > 0 THEN 'accepted' ELSE 'duplicate' END
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.ingest_gps_device_point(
  UUID, UUID, TEXT, TEXT, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION,
  DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, TIMESTAMPTZ, TIMESTAMPTZ
) TO anon, service_role;

CREATE OR REPLACE FUNCTION public.finish_gps_route_session(
  _route_id UUID,
  _token_hash TEXT,
  _ended_at TIMESTAMPTZ,
  _end_total_km DOUBLE PRECISION,
  _distance_km DOUBLE PRECISION
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  _device public.gps_device_tokens;
BEGIN
  SELECT * INTO _device
  FROM public.gps_device_tokens
  WHERE token_hash = _token_hash AND is_active;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('accepted', false, 'reason', 'unauthorized');
  END IF;

  UPDATE public.gps_route_sessions
  SET
    ended_at = _ended_at,
    end_total_km = _end_total_km,
    distance_km = GREATEST(_distance_km, 0),
    updated_at = now()
  WHERE id = _route_id
    AND user_id = _device.user_id;

  RETURN jsonb_build_object('accepted', FOUND);
END;
$$;

GRANT EXECUTE ON FUNCTION public.finish_gps_route_session(
  UUID, TEXT, TIMESTAMPTZ, DOUBLE PRECISION, DOUBLE PRECISION
) TO anon, service_role;