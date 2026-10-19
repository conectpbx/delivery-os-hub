CREATE TABLE public.active_work_journeys (
  user_id uuid PRIMARY KEY,
  state jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.active_work_journeys TO authenticated;
GRANT ALL ON public.active_work_journeys TO service_role;
ALTER TABLE public.active_work_journeys ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own active journey select" ON public.active_work_journeys FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "own active journey insert" ON public.active_work_journeys FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own active journey update" ON public.active_work_journeys FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own active journey delete" ON public.active_work_journeys FOR DELETE TO authenticated USING (auth.uid() = user_id);
COMMENT ON TABLE public.active_work_journeys IS 'Cross-device snapshot of the in-progress journey (start, pauses, distance), one row per user';