-- Automatic credits are recorded once at server validation time, never backdated.
ALTER TABLE public.app_challenges
  ADD COLUMN auto_receive boolean NOT NULL DEFAULT true;

CREATE INDEX deliveries_challenge_progress_idx
  ON public.deliveries (user_id, lower(btrim(app_name)), occurred_at)
  INCLUDE (earnings, tip) WHERE status = 'concluida';

CREATE FUNCTION public.validate_app_challenge_credit() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE progress numeric;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.received_at IS NOT NULL THEN
      RAISE EXCEPTION 'Estorne a bonificação antes de excluir o desafio.';
    END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.user_id IS DISTINCT FROM OLD.user_id OR NEW.id IS DISTINCT FROM OLD.id THEN
      RAISE EXCEPTION 'A identidade do desafio não pode ser alterada.';
    END IF;
    IF OLD.received_at IS NOT NULL THEN
      IF ROW(NEW.app_name, NEW.title, NEW.starts_at, NEW.ends_at, NEW.metric, NEW.target, NEW.reward)
          IS DISTINCT FROM ROW(OLD.app_name, OLD.title, OLD.starts_at, OLD.ends_at, OLD.metric, OLD.target, OLD.reward)
          OR (NEW.received_at IS NOT NULL AND NEW.received_at IS DISTINCT FROM OLD.received_at) THEN
        RAISE EXCEPTION 'Estorne a bonificação antes de alterar o desafio.';
      END IF;
      IF NEW.received_at IS NULL THEN NEW.auto_receive := false; END IF;
      RETURN NEW;
    END IF;
  END IF;
  SELECT CASE WHEN NEW.metric = 'deliveries' THEN count(*)::numeric
         ELSE coalesce(sum(d.earnings + d.tip), 0) END INTO progress
  FROM public.deliveries d
  WHERE d.user_id = NEW.user_id AND d.status = 'concluida'
    AND lower(btrim(d.app_name)) = lower(btrim(NEW.app_name))
    AND d.occurred_at BETWEEN NEW.starts_at AND NEW.ends_at
    AND d.occurred_at <= coalesce(NEW.received_at, now());
  IF NEW.received_at IS NOT NULL AND
     (progress < NEW.target OR NEW.received_at > now() OR NEW.received_at < NEW.starts_at) THEN
    RAISE EXCEPTION 'A bonificação exige a meta concluída até a data do crédito.';
  END IF;
  IF NEW.received_at IS NULL AND NEW.auto_receive AND progress >= NEW.target THEN
    NEW.received_at := now();
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.validate_app_challenge_credit() FROM PUBLIC;
CREATE TRIGGER validate_app_challenge_credit
  BEFORE INSERT OR UPDATE OR DELETE ON public.app_challenges
  FOR EACH ROW EXECUTE FUNCTION public.validate_app_challenge_credit();

-- Serialize credit evaluation on each challenge. No increments or duplicate receipts.
CREATE FUNCTION public.credit_delivery_challenges() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE challenge_id uuid;
BEGIN
  IF NEW.status <> 'concluida' THEN RETURN NEW; END IF;
  FOR challenge_id IN
    SELECT c.id FROM public.app_challenges c
    WHERE c.user_id = NEW.user_id AND c.auto_receive AND c.received_at IS NULL
      AND lower(btrim(c.app_name)) = lower(btrim(NEW.app_name))
      AND NEW.occurred_at BETWEEN c.starts_at AND c.ends_at
    ORDER BY c.id FOR UPDATE
  LOOP
    UPDATE public.app_challenges c SET auto_receive = true WHERE c.id = challenge_id
      AND (SELECT CASE WHEN c.metric = 'deliveries' THEN count(*)::numeric
            ELSE coalesce(sum(d.earnings + d.tip), 0) END
           FROM public.deliveries d WHERE d.user_id = c.user_id AND d.status = 'concluida'
             AND lower(btrim(d.app_name)) = lower(btrim(c.app_name))
             AND d.occurred_at BETWEEN c.starts_at AND c.ends_at
             AND d.occurred_at <= now()) >= c.target;
  END LOOP;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.credit_delivery_challenges() FROM PUBLIC;
CREATE TRIGGER credit_delivery_challenges
  AFTER INSERT OR UPDATE OF status, earnings, tip, occurred_at, app_name, user_id
  ON public.deliveries FOR EACH ROW EXECUTE FUNCTION public.credit_delivery_challenges();

-- Covers existing deliveries and future-dated entries after time has elapsed.
-- No caller-selected user ID; the authenticated account is the sole scope.
CREATE FUNCTION public.reconcile_app_challenges() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE challenge_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Autenticação necessária.'; END IF;
  FOR challenge_id IN
    SELECT c.id FROM public.app_challenges c
    WHERE c.user_id = auth.uid() AND c.auto_receive AND c.received_at IS NULL
      AND c.starts_at <= now()
    ORDER BY c.id FOR UPDATE
  LOOP
    UPDATE public.app_challenges c SET auto_receive = true WHERE c.id = challenge_id
      AND (SELECT CASE WHEN c.metric = 'deliveries' THEN count(*)::numeric
           ELSE coalesce(sum(d.earnings + d.tip), 0) END
           FROM public.deliveries d WHERE d.user_id = c.user_id AND d.status = 'concluida'
           AND lower(btrim(d.app_name)) = lower(btrim(c.app_name))
           AND d.occurred_at BETWEEN c.starts_at AND c.ends_at
           AND d.occurred_at <= now()) >= c.target;
  END LOOP;
END;
$$;
REVOKE ALL ON FUNCTION public.reconcile_app_challenges() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reconcile_app_challenges() TO authenticated;

-- Activate existing eligible challenges once; retain already recorded receipts.
UPDATE public.app_challenges SET auto_receive = true WHERE received_at IS NULL;