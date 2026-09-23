ALTER TABLE public.expenses
ADD COLUMN IF NOT EXISTS allocation_method TEXT NOT NULL DEFAULT 'immediate'
CHECK (allocation_method IN ('immediate', 'monthly'));

-- Preserva o comportamento já esperado para seguros existentes.
UPDATE public.expenses
SET allocation_method = 'monthly'
WHERE lower(trim(category)) = 'seguro';

COMMENT ON COLUMN public.expenses.allocation_method IS
  'Forma de apropriação operacional: immediate no lançamento ou monthly até o próximo vencimento mensal.';
