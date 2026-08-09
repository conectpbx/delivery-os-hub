CREATE TABLE public.apps (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  color text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE (user_id, name)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.apps TO authenticated;
GRANT ALL ON public.apps TO service_role;

ALTER TABLE public.apps ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own apps"
ON public.apps
FOR ALL
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);