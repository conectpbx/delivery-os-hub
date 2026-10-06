CREATE TABLE public.gps_device_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  device_name TEXT NOT NULL CHECK (length(trim(device_name)) BETWEEN 1 AND 80),
  token_hash TEXT NOT NULL UNIQUE CHECK (length(token_hash) = 64),
  is_active BOOLEAN NOT NULL DEFAULT true,
  last_used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT ALL ON public.gps_device_tokens TO service_role;
ALTER TABLE public.gps_device_tokens ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.gps_device_state (
  token_id UUID PRIMARY KEY REFERENCES public.gps_device_tokens(id) ON DELETE CASCADE,
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
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.gps_device_state TO authenticated;
GRANT ALL ON public.gps_device_state TO service_role;
ALTER TABLE public.gps_device_state ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users read own GPS device state" ON public.gps_device_state FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE INDEX gps_device_state_user_updated_idx ON public.gps_device_state (user_id, updated_at DESC);

CREATE OR REPLACE FUNCTION public.touch_gps_updated_at() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.touch_gps_updated_at() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER gps_device_tokens_updated_at BEFORE UPDATE ON public.gps_device_tokens FOR EACH ROW EXECUTE FUNCTION public.touch_gps_updated_at();

CREATE OR REPLACE FUNCTION public.list_my_gps_devices()
RETURNS TABLE(id UUID, device_name TEXT, is_active BOOLEAN, last_used_at TIMESTAMPTZ, created_at TIMESTAMPTZ)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT t.id, t.device_name, t.is_active, t.last_used_at, t.created_at
  FROM public.gps_device_tokens t
  WHERE t.user_id = auth.uid()
  ORDER BY t.created_at DESC;
$$;
REVOKE EXECUTE ON FUNCTION public.list_my_gps_devices() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_my_gps_devices() TO authenticated;

CREATE OR REPLACE FUNCTION public.create_my_gps_device_token(_device_name TEXT)
RETURNS TABLE(id UUID, device_name TEXT, token TEXT, created_at TIMESTAMPTZ)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp AS $$
DECLARE
  _token TEXT;
  _id UUID;
  _created TIMESTAMPTZ;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501'; END IF;
  IF length(trim(_device_name)) NOT BETWEEN 1 AND 80 THEN RAISE EXCEPTION 'invalid device name' USING ERRCODE = '22023'; END IF;
  _token := 'dos_gps_' || encode(gen_random_bytes(32), 'hex');
  INSERT INTO public.gps_device_tokens(user_id, device_name, token_hash)
  VALUES (auth.uid(), trim(_device_name), encode(digest(_token, 'sha256'), 'hex'))
  RETURNING gps_device_tokens.id, gps_device_tokens.created_at INTO _id, _created;
  RETURN QUERY SELECT _id, trim(_device_name), _token, _created;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.create_my_gps_device_token(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_my_gps_device_token(TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.revoke_my_gps_device_token(_token_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  UPDATE public.gps_device_tokens SET is_active = false
  WHERE id = _token_id AND user_id = auth.uid() AND is_active;
  RETURN FOUND;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.revoke_my_gps_device_token(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.revoke_my_gps_device_token(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.ingest_gps_device_state(
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
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  _device public.gps_device_tokens;
  _accepted BOOLEAN := false;
BEGIN
  SELECT * INTO _device FROM public.gps_device_tokens
  WHERE token_hash = _token_hash AND is_active
  FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('accepted', false, 'reason', 'unauthorized'); END IF;

  INSERT INTO public.gps_device_state(token_id, user_id, source, latitude, longitude, accuracy_m, speed_kmh, trip_km, total_km, captured_at, sent_at)
  VALUES (_device.id, _device.user_id, _source, _latitude, _longitude, _accuracy_m, _speed_kmh, _trip_km, _total_km, _captured_at, _sent_at)
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
  GET DIAGNOSTICS _accepted = ROW_COUNT;

  IF _accepted THEN
    UPDATE public.gps_device_tokens SET last_used_at = now() WHERE id = _device.id;
  END IF;
  RETURN jsonb_build_object('accepted', _accepted, 'reason', CASE WHEN _accepted THEN 'accepted' ELSE 'stale' END);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.ingest_gps_device_state(TEXT, TEXT, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ingest_gps_device_state(TEXT, TEXT, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, TIMESTAMPTZ, TIMESTAMPTZ) TO service_role;