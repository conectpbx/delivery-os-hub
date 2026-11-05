-- Token ownership and chronological integrity must also hold for direct RPC calls.
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
SET search_path = ''
AS $$
DECLARE
  _device public.gps_device_tokens;
  _row_count BIGINT := 0;
BEGIN
  IF _point_id IS NULL OR _source IS NULL OR length(btrim(_source)) NOT BETWEEN 1 AND 80
    OR _latitude IS NULL OR NOT (_latitude BETWEEN -90 AND 90)
    OR _longitude IS NULL OR NOT (_longitude BETWEEN -180 AND 180)
    OR _accuracy_m IS NULL OR NOT (_accuracy_m BETWEEN 0 AND 10000)
    OR _speed_kmh IS NULL OR NOT (_speed_kmh BETWEEN 0 AND 500)
    OR _trip_km IS NULL OR NOT (_trip_km BETWEEN 0 AND 1000000)
    OR _total_km IS NULL OR NOT (_total_km BETWEEN 0 AND 10000000)
    OR _captured_at IS NULL OR _sent_at IS NULL
    OR _captured_at > now() + interval '5 minutes'
    OR _captured_at < now() - interval '30 days' THEN
    RETURN jsonb_build_object('accepted', false, 'reason', 'invalid_payload');
  END IF;
  SELECT * INTO _device
  FROM public.gps_device_tokens
  WHERE token_hash = _token_hash
    AND is_active
    AND EXISTS (SELECT 1 FROM auth.users u WHERE u.id = gps_device_tokens.user_id
      AND (u.banned_until IS NULL OR u.banned_until <= now()))
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
    PERFORM 1 FROM public.gps_route_sessions
      WHERE id = _route_id AND token_id = _device.id AND user_id = _device.user_id
      FOR UPDATE;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('accepted', false, 'reason', 'unauthorized');
    END IF;
    IF EXISTS (SELECT 1 FROM public.gps_route_sessions WHERE id = _route_id
        AND ended_at IS NOT NULL AND _captured_at > ended_at) THEN
      RETURN jsonb_build_object('accepted', false, 'reason', 'route_closed');
    END IF;
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
  IF _row_count = 0 THEN
    RETURN jsonb_build_object('accepted', true, 'reason', 'duplicate');
  END IF;

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
  WHERE EXCLUDED.captured_at > public.gps_device_state.captured_at;

  IF _route_id IS NOT NULL AND _row_count > 0 THEN
    UPDATE public.gps_route_sessions
    SET
      end_total_km = CASE WHEN ended_at IS NULL AND NOT EXISTS (
        SELECT 1 FROM public.gps_route_points p WHERE p.route_id = _route_id
          AND p.point_id <> _point_id AND p.captured_at >= _captured_at
      ) THEN _total_km ELSE end_total_km END,
      distance_km = CASE WHEN ended_at IS NULL AND NOT EXISTS (
        SELECT 1 FROM public.gps_route_points p WHERE p.route_id = _route_id
          AND p.point_id <> _point_id AND p.captured_at >= _captured_at
      ) THEN GREATEST(_trip_km, 0) ELSE distance_km END,
      point_count = point_count + 1,
      updated_at = now()
    WHERE id = _route_id
      AND user_id = _device.user_id AND token_id = _device.id;
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

REVOKE ALL ON FUNCTION public.ingest_gps_device_point(
  uuid,uuid,text,text,double precision,double precision,double precision,
  double precision,double precision,double precision,timestamptz,timestamptz
) FROM PUBLIC, authenticated;
GRANT EXECUTE ON FUNCTION public.ingest_gps_device_point(
  uuid,uuid,text,text,double precision,double precision,double precision,
  double precision,double precision,double precision,timestamptz,timestamptz
) TO anon, service_role;

CREATE OR REPLACE FUNCTION public.finish_gps_route_session(
  _route_id uuid, _token_hash text, _ended_at timestamptz,
  _end_total_km double precision, _distance_km double precision
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE device public.gps_device_tokens; route public.gps_route_sessions;
BEGIN
  IF _ended_at IS NULL OR _ended_at > now() + interval '5 minutes'
    OR _ended_at < now() - interval '30 days'
    OR _end_total_km IS NULL OR NOT (_end_total_km BETWEEN 0 AND 10000000)
    OR _distance_km IS NULL OR NOT (_distance_km BETWEEN 0 AND 1000000) THEN
    RETURN jsonb_build_object('accepted', false, 'reason', 'invalid_payload');
  END IF;
  SELECT * INTO device FROM public.gps_device_tokens t WHERE t.token_hash = _token_hash AND t.is_active
    AND EXISTS (SELECT 1 FROM auth.users u WHERE u.id = t.user_id AND (u.banned_until IS NULL OR u.banned_until <= now()))
    FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('accepted', false, 'reason', 'unauthorized'); END IF;
  SELECT * INTO route FROM public.gps_route_sessions
    WHERE id = _route_id AND token_id = device.id AND user_id = device.user_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('accepted', false, 'reason', 'unauthorized'); END IF;
  IF _ended_at < route.started_at OR EXISTS (
    SELECT 1 FROM public.gps_route_points p WHERE p.route_id = _route_id AND p.captured_at > _ended_at
  ) THEN RETURN jsonb_build_object('accepted', false, 'reason', 'invalid_payload'); END IF;
  IF route.ended_at IS NOT NULL THEN
    RETURN jsonb_build_object('accepted', route.ended_at = _ended_at
      AND route.end_total_km = _end_total_km AND route.distance_km = _distance_km,
      'reason', 'already_finished');
  END IF;
  UPDATE public.gps_route_sessions SET ended_at = _ended_at, end_total_km = _end_total_km,
    distance_km = _distance_km, updated_at = now() WHERE id = _route_id;
  RETURN jsonb_build_object('accepted', true);
END;
$$;
REVOKE ALL ON FUNCTION public.finish_gps_route_session(uuid,text,timestamptz,double precision,double precision) FROM PUBLIC, authenticated;
GRANT EXECUTE ON FUNCTION public.finish_gps_route_session(uuid,text,timestamptz,double precision,double precision) TO anon, service_role;
