-- Each challenge has one optional receipt. Repeated confirmation cannot create extra income.
CREATE TABLE public.app_challenges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  app_name text NOT NULL CHECK (length(trim(app_name)) BETWEEN 1 AND 100),
  title text NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 200),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  metric text NOT NULL CHECK (metric IN ('deliveries', 'revenue')),
  target numeric NOT NULL CHECK (target > 0 AND target < 1000000000 AND (metric <> 'deliveries' OR target = trunc(target))),
  reward numeric(12,2) NOT NULL CHECK (reward > 0 AND reward < 1000000000),
  received_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at >= starts_at),
  CHECK (received_at IS NULL OR (received_at >= starts_at AND received_at <= now()))
);
ALTER TABLE public.app_challenges ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.app_challenges TO authenticated;
GRANT ALL ON public.app_challenges TO service_role;
CREATE POLICY "Users manage own app challenges" ON public.app_challenges
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX app_challenges_user_dates_idx ON public.app_challenges (user_id, starts_at, ends_at);
CREATE INDEX app_challenges_user_received_idx ON public.app_challenges (user_id, received_at) WHERE received_at IS NOT NULL;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.app_challenges;
  END IF;
END $$;