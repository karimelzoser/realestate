BEGIN;

-- Missing custom settings return NULL. SQL three-valued boolean logic would
-- otherwise make `NOT v_authorized` / `<> 'on'` evaluate to NULL and skip the
-- rejection path. Explicitly coalesce to an empty value so the default is
-- always unauthorized.
CREATE OR REPLACE FUNCTION preneura_guard_eoi_finance_projection()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_authorized boolean :=
    COALESCE(current_setting('preneura.eoi_finance_projection', true), '') = 'on';
  v_finance_transition boolean := false;
BEGIN
  v_finance_transition :=
    NEW.payment_reference IS DISTINCT FROM OLD.payment_reference
    OR NEW.paid_at IS DISTINCT FROM OLD.paid_at
    OR NEW.refunded_at IS DISTINCT FROM OLD.refunded_at
    OR (OLD.status = 'PAYMENT_PENDING' AND NEW.status = 'PAID')
    OR (OLD.status = 'PAID' AND NEW.status = 'PAYMENT_PENDING')
    OR NEW.status = 'REFUNDED';

  IF v_finance_transition AND NOT v_authorized THEN
    RAISE EXCEPTION 'EOI payment/refund projection is ledger-derived and cannot be mutated directly';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION preneura_guard_eoi_refund_payout_projection()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF (
    NEW.paid_at IS DISTINCT FROM OLD.paid_at
    OR (OLD.status <> 'PAID' AND NEW.status = 'PAID')
  ) AND COALESCE(current_setting('preneura.eoi_finance_projection', true), '') <> 'on' THEN
    RAISE EXCEPTION 'EOI refund payout status is ledger-derived and cannot be mutated directly';
  END IF;
  RETURN NEW;
END;
$$;

UPDATE platform_runtime_contract
SET schema_version = 38,
    minimum_runtime_version = 38,
    migration_marker = '0038_eoi_projection_guards_fail_closed',
    updated_at = now()
WHERE singleton_key = 'production';

COMMIT;
