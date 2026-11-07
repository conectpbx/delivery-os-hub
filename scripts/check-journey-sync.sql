-- Read-only diagnosis: run in the SQL Editor of the same Supabase project used by the app.
SELECT
  to_regclass('public.active_work_journeys') IS NOT NULL AS active_journeys_table,
  to_regclass('public.work_journeys') IS NOT NULL AS journeys_table,
  to_regprocedure('public.sync_active_work_journey(uuid,jsonb,text)') IS NOT NULL AS sync_function,
  EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public'
      AND tablename = 'active_work_journeys'
  ) AS realtime_enabled;

SELECT tablename, policyname, cmd, roles
FROM pg_policies
WHERE schemaname = 'public' AND tablename IN ('active_work_journeys', 'work_journeys')
ORDER BY tablename, policyname;
