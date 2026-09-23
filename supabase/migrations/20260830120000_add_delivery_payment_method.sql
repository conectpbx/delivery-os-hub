ALTER TABLE public.deliveries
  ADD COLUMN IF NOT EXISTS payment_method text NOT NULL DEFAULT 'credito';

ALTER TABLE public.deliveries
  DROP CONSTRAINT IF EXISTS deliveries_payment_method_check;

ALTER TABLE public.deliveries
  ADD CONSTRAINT deliveries_payment_method_check
  CHECK (payment_method IN ('credito', 'pix', 'dinheiro'));
