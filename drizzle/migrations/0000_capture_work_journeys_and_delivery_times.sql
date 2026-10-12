CREATE TABLE public.work_journeys (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL,
 started_at timestamptz NOT NULL,
 ended_at timestamptz NOT NULL,
 distance_km numeric NOT NULL DEFAULT 0,
 source text NOT NULL DEFAULT 'browser',
 created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.work_journeys TO authenticated;
GRANT ALL ON public.work_journeys TO service_role;
ALTER TABLE public.work_journeys ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own journeys" ON public.work_journeys FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX work_journeys_user_started_idx ON public.work_journeys(user_id, started_at DESC);
CREATE FUNCTION public.validate_work_journey() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$ BEGIN
 IF NEW.ended_at < NEW.started_at THEN RAISE EXCEPTION 'Journey end must not precede start'; END IF;
 IF NEW.distance_km < 0 THEN RAISE EXCEPTION 'Journey distance must not be negative'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER validate_work_journey BEFORE INSERT OR UPDATE ON public.work_journeys FOR EACH ROW EXECUTE FUNCTION public.validate_work_journey();
ALTER TABLE public.deliveries ADD COLUMN IF NOT EXISTS started_at timestamptz;
ALTER TABLE public.deliveries ADD COLUMN IF NOT EXISTS ended_at timestamptz;
ALTER TABLE public.deliveries ADD COLUMN IF NOT EXISTS estimated_duration_min numeric;
COMMENT ON COLUMN public.deliveries.estimated_duration_min IS 'Route planner estimate, separate from captured elapsed delivery time';