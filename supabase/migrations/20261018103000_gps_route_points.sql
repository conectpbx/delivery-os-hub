CREATE TABLE IF NOT EXISTS public.gps_route_points (
  point_id UUID PRIMARY KEY,
  token_id UUID NOT NULL REFERENCES public.gps_device_tokens(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  source TEXT NOT NULL CHECK (length(source) BETWEEN 1 AND 80),
  latitude DOUBLE PRECISION NOT NULL CHECK (latitude BETWEEN -90 AND 90),
  longitude DOUBLE PRECISION NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  accuracy_m DOUBLE PRECISION NOT NULL CHECK (accuracy_m BETWEEN 0 AND 10000),
  speed_kmh DOUBLE PRECISION CHECK (speed_kmh BETWEEN 0 AND 500),
  trip_km DOUBLE PRECISION NOT NULL CHECK (trip_km BETWEEN 0 AND 1000000),
  total_km DOUBLE PRECISION NOT NULL CHECK (total_km BETWEEN 0 AND 10000000),
  captured_at TIMESTAMPTZ NOT NULL,
  sent_at TIMESTAMPTZ NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.gps_route_points ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.gps_route_points TO authenticated;
GRANT ALL ON public.gps_route_points TO service_role;

DROP POLICY IF EXISTS "Users read own GPS route points" ON public.gps_route_points;
CREATE POLICY "Users read own GPS route points"
ON public.gps_route_points
FOR SELECT TO authenticated
USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS gps_route_points_user_captured_idx
ON public.gps_route_points (user_id, captured_at DESC);

CREATE INDEX IF NOT EXISTS gps_route_points_token_captured_idx
ON public.gps_route_points (token_id, captured_at DESC);

CREATE OR REPLACE FUNCTION public.ingest_gps_device_point(
  _point_id UUID,
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
  _rows INTEGER := 0;
BEGIN
  SELECT * INTO _device
  FROM public.gps_device_tokens
  WHERE token_hash = _token_hash
    AND is_active
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('accepted', false, 'reason', 'unauthorized');
  END IF;

  INSERT INTO public.gps_route_points(
    point_id, token_id, user_id, source, latitude, longitude,
    accuracy_m, speed_kmh, trip_km, total_km, captured_at, sent_at
  )
  VALUES (
    _point_id, _device.id, _device.user_id, _source, _latitude, _longitude,
    _accuracy_m, _speed_kmh, _trip_km, _total_km, _captured_at, _sent_at
  )
  ON CONFLICT (point_id) DO NOTHING;

  GET DIAGNOSTICS _rows = ROW_COUNT;

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

  UPDATE public.gps_device_tokens
  SET last_used_at = now()
  WHERE id = _device.id;

  RETURN jsonb_build_object(
    'accepted', true,
    'reason', CASE WHEN _rows > 0 THEN 'accepted' ELSE 'duplicate' END
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.ingest_gps_device_point(
  UUID, TEXT, TEXT, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION,
  DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, TIMESTAMPTZ, TIMESTAMPTZ
) FROM PUBLIC, authenticated;

GRANT EXECUTE ON FUNCTION public.ingest_gps_device_point(
  UUID, TEXT, TEXT, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION,
  DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, TIMESTAMPTZ, TIMESTAMPTZ
) TO anon, service_role;
