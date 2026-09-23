CREATE TABLE public.ai_scan_usage (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  usage_date DATE NOT NULL DEFAULT (now() AT TIME ZONE 'America/Sao_Paulo')::date,
  count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, usage_date)
);

GRANT SELECT, INSERT, UPDATE ON public.ai_scan_usage TO authenticated;
GRANT ALL ON public.ai_scan_usage TO service_role;

ALTER TABLE public.ai_scan_usage ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own ai usage" ON public.ai_scan_usage
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users insert own ai usage" ON public.ai_scan_usage
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own ai usage" ON public.ai_scan_usage
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.consume_ai_scan_quota(_limit INTEGER)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  _uid UUID := auth.uid();
  _today DATE := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  _new INTEGER;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  INSERT INTO public.ai_scan_usage (user_id, usage_date, count)
  VALUES (_uid, _today, 1)
  ON CONFLICT (user_id, usage_date)
  DO UPDATE SET count = public.ai_scan_usage.count + 1, updated_at = now()
  WHERE public.ai_scan_usage.count < _limit
  RETURNING count INTO _new;

  IF _new IS NULL THEN
    RETURN -1;
  END IF;

  RETURN _new;
END;
$$;

GRANT EXECUTE ON FUNCTION public.consume_ai_scan_quota(INTEGER) TO authenticated;