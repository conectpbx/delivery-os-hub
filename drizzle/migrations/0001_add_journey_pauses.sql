ALTER TABLE public.work_journeys ADD COLUMN pauses jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE public.work_journeys ADD CONSTRAINT work_journey_pauses_array CHECK (jsonb_typeof(pauses) = 'array');
COMMENT ON COLUMN public.work_journeys.pauses IS 'User-recorded breaks with id, reason, started_at and ended_at; included in elapsed journey but excluded from delivery and unassigned time';