ALTER TABLE public.apps ADD COLUMN IF NOT EXISTS fee_percent numeric NOT NULL DEFAULT 0;
ALTER TABLE public.deliveries ADD COLUMN IF NOT EXISTS gross_earnings numeric NOT NULL DEFAULT 0;
ALTER TABLE public.deliveries ADD COLUMN IF NOT EXISTS fee_percent numeric NOT NULL DEFAULT 0;
UPDATE public.deliveries SET gross_earnings = earnings WHERE gross_earnings = 0;