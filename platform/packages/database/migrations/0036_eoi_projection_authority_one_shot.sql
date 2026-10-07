BEGIN;

-- Projection authority must never leak to later statements in the same
-- transaction. The primary token authorizes exactly one finance projection.
-- Refund payout consumes it on the refund-request projection and issues a
-- second one-shot token solely for the immediately following EOI REFUNDED
-- projection performed by preneura_pay_eoi_refund(...).
CREATE OR REPLACE FUNCTION preneura_guard_eoi_finance_projection()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_primary_authorized boolean :=
    COALESCE(current_setting('preneura.eoi_finance_projection', true), '') = 'on';
  v_refund_followup_authorized boolean :=
    COALESCE(current_setting('preneura.eoi_refund_followup_projection', true), '') = 'on';
  v_finance_transition boolean := false;
  v_authorized boolean := false;
BEGIN
  v_finance_transition :=
    NEW.payment_reference IS DISTINCT FROM OLD.payment_reference
    OR NEW.paid_at IS DISTINCT FROM OLD.paid_at
    OR NEW.refunded_at IS DISTINCT FROM OLD.refunded_at
    OR (OLD.status = 'PAYMENT_PENDING' AND NEW.status = 'PAID')
    OR (OLD.status = 'PAID' AND NEW.status = 'PAYMENT_PENDING')
    OR NEW.status = 'REFUNDED';

  IF NOT v_finance_transition THEN
    RETURN NEW;
  END IF;

  v_authorized := v_primary_authorized
    OR (NEW.status = 'REFUNDED' AND v_refund_followup_authorized);

  IF NOT v_authorized THEN
    RAISE EXCEPTION 'EOI payment/refund projection is ledger-derived and cannot be mutated directly';
  END IF;

  -- Consume whichever token authorized this row update. Payment and reversal
  -- calls therefore cannot accidentally authorize a later direct mutation.
  IF v_primary_authorized THEN
    PERFORM set_config('preneura.eoi_finance_projection', '', true);
  END IF;
  IF NEW.status = 'REFUNDED' AND v_refund_followup_authorized THEN
    PERFORM set_config('preneura.eoi_refund_followup_projection', '', true);
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION preneura_guard_eoi_refund_payout_projection()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_transition boolean :=
    NEW.paid_at IS DISTINCT FROM OLD.paid_at
    OR (OLD.status <> 'PAID' AND NEW.status = 'PAID');
  v_authorized boolean :=
    COALESCE(current_setting('preneura.eoi_finance_projection', true), '') = 'on';
BEGIN
  IF NOT v_transition THEN
    RETURN NEW;
  END IF;

  IF NOT v_authorized THEN
    RAISE EXCEPTION 'EOI refund payout status is ledger-derived and cannot be mutated directly';
  END IF;

  -- Consume primary authority and issue only the narrow follow-up token needed
  -- by the same payout function's buyer_eois REFUNDED projection.
  PERFORM set_config('preneura.eoi_finance_projection', '', true);
  PERFORM set_config('preneura.eoi_refund_followup_projection', 'on', true);
  RETURN NEW;
END;
$$;

UPDATE platform_runtime_contract
SET schema_version = 36,
    minimum_runtime_version = 36,
    migration_marker = '0036_eoi_projection_authority_one_shot',
    updated_at = now()
WHERE singleton_key = 'production';

COMMIT;
