CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated;

CREATE POLICY "Users identify own GPS tokens" ON public.gps_device_tokens
FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION private.list_my_gps_devices()
RETURNS TABLE(id UUID, device_name TEXT, is_active BOOLEAN, last_used_at TIMESTAMPTZ, created_at TIMESTAMPTZ)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, private, pg_temp AS $$
  SELECT t.id, t.device_name, t.is_active, t.last_used_at, t.created_at
  FROM public.gps_device_tokens t
  WHERE t.user_id = auth.uid()
  ORDER BY t.created_at DESC;
$$;

CREATE OR REPLACE FUNCTION private.create_my_gps_device_token(_device_name TEXT)
RETURNS TABLE(id UUID, device_name TEXT, token TEXT, created_at TIMESTAMPTZ)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, private, extensions, pg_temp AS $$
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

CREATE OR REPLACE FUNCTION private.revoke_my_gps_device_token(_token_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, private, pg_temp AS $$
BEGIN
  UPDATE public.gps_device_tokens SET is_active = false
  WHERE id = _token_id AND user_id = auth.uid() AND is_active;
  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION private.list_my_gps_devices(), private.create_my_gps_device_token(TEXT), private.revoke_my_gps_device_token(UUID) FROM PUBLIC;
GRANT USAGE ON SCHEMA private TO authenticated;
GRANT EXECUTE ON FUNCTION private.list_my_gps_devices(), private.create_my_gps_device_token(TEXT), private.revoke_my_gps_device_token(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.list_my_gps_devices()
RETURNS TABLE(id UUID, device_name TEXT, is_active BOOLEAN, last_used_at TIMESTAMPTZ, created_at TIMESTAMPTZ)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public, private, pg_temp AS $$
  SELECT * FROM private.list_my_gps_devices();
$$;

CREATE OR REPLACE FUNCTION public.create_my_gps_device_token(_device_name TEXT)
RETURNS TABLE(id UUID, device_name TEXT, token TEXT, created_at TIMESTAMPTZ)
LANGUAGE sql SECURITY INVOKER SET search_path = public, private, pg_temp AS $$
  SELECT * FROM private.create_my_gps_device_token(_device_name);
$$;

CREATE OR REPLACE FUNCTION public.revoke_my_gps_device_token(_token_id UUID)
RETURNS BOOLEAN
LANGUAGE sql SECURITY INVOKER SET search_path = public, private, pg_temp AS $$
  SELECT private.revoke_my_gps_device_token(_token_id);
$$;

REVOKE EXECUTE ON FUNCTION public.list_my_gps_devices(), public.create_my_gps_device_token(TEXT), public.revoke_my_gps_device_token(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_my_gps_devices(), public.create_my_gps_device_token(TEXT), public.revoke_my_gps_device_token(UUID) TO authenticated;