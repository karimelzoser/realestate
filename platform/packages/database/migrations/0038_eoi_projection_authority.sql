BEGIN;

-- Payment projection authority is one-shot. Refund payout/reversal projections
-- are derived only from already-settled/reversed disbursement evidence plus the
-- matching EOI accounting event created by the settlement status trigger.
CREATE OR REPLACE FUNCTION preneura_guard_eoi_finance_projection()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_payment_transition boolean := false;
  v_refund_settle_transition boolean := false;
  v_refund_reverse_transition boolean := false;
  v_payment_authorized boolean :=
    COALESCE(current_setting('preneura.eoi_finance_projection', true), '') = 'on';
  v_evidence_exists boolean := false;
BEGIN
  v_payment_transition :=
    NEW.payment_reference IS DISTINCT FROM OLD.payment_reference
    OR NEW.paid_at IS DISTINCT FROM OLD.paid_at
    OR (OLD.status = 'PAYMENT_PENDING' AND NEW.status = 'PAID')
    OR (OLD.status = 'PAID' AND NEW.status = 'PAYMENT_PENDING');

  v_refund_settle_transition :=
    (NEW.status = 'REFUNDED' AND OLD.status IS DISTINCT FROM 'REFUNDED')
    OR (NEW.refunded_at IS NOT NULL AND NEW.refunded_at IS DISTINCT FROM OLD.refunded_at);

  v_refund_reverse_transition :=
    (OLD.status = 'REFUNDED' AND NEW.status = 'REFUND_REQUESTED')
    OR (OLD.refunded_at IS NOT NULL AND NEW.refunded_at IS NULL);

  IF v_payment_transition THEN
    IF NOT v_payment_authorized THEN
      RAISE EXCEPTION 'EOI payment projection is ledger-derived and cannot be mutated directly';
    END IF;
    PERFORM set_config('preneura.eoi_finance_projection', '', true);
  END IF;

  IF v_refund_settle_transition THEN
    SELECT EXISTS (
      SELECT 1
      FROM eoi_refund_requests r
      JOIN settlement_disbursements s
        ON s.eoi_refund_request_id = r.id
       AND s.settlement_type = 'EOI_REFUND'
       AND s.status = 'SETTLED'
      JOIN eoi_finance_events f
        ON f.settlement_id = s.id
       AND f.refund_request_id = r.id
       AND f.event_type = 'REFUND_ISSUED'
      WHERE r.eoi_id = NEW.id
        AND r.tenant_id = NEW.tenant_id
        AND r.project_id = NEW.project_id
    ) INTO v_evidence_exists;
    IF NOT v_evidence_exists THEN
      RAISE EXCEPTION 'EOI refund projection requires settled disbursement and deposit-ledger evidence';
    END IF;
  END IF;

  IF v_refund_reverse_transition THEN
    SELECT EXISTS (
      SELECT 1
      FROM eoi_refund_requests r
      JOIN settlement_disbursements s
        ON s.eoi_refund_request_id = r.id
       AND s.settlement_type = 'EOI_REFUND'
       AND s.status = 'REVERSED'
      JOIN eoi_finance_events f
        ON f.settlement_id = s.id
       AND f.refund_request_id = r.id
       AND f.event_type = 'REFUND_REVERSED'
      WHERE r.eoi_id = NEW.id
        AND r.tenant_id = NEW.tenant_id
        AND r.project_id = NEW.project_id
    ) INTO v_evidence_exists;
    IF NOT v_evidence_exists THEN
      RAISE EXCEPTION 'EOI refund reopening requires reversed disbursement and deposit-ledger evidence';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_buyer_eois_finance_projection_guard ON buyer_eois;
CREATE TRIGGER trg_buyer_eois_finance_projection_guard
BEFORE UPDATE ON buyer_eois
FOR EACH ROW EXECUTE FUNCTION preneura_guard_eoi_finance_projection();

CREATE OR REPLACE FUNCTION preneura_guard_eoi_refund_payout_projection()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_pay_transition boolean :=
    (NEW.status = 'PAID' AND OLD.status IS DISTINCT FROM 'PAID')
    OR (NEW.paid_at IS NOT NULL AND NEW.paid_at IS DISTINCT FROM OLD.paid_at);
  v_reopen_transition boolean :=
    (OLD.status = 'PAID' AND NEW.status = 'APPROVED')
    OR (OLD.paid_at IS NOT NULL AND NEW.paid_at IS NULL);
  v_evidence_exists boolean := false;
BEGIN
  IF v_pay_transition THEN
    SELECT EXISTS (
      SELECT 1
      FROM settlement_disbursements s
      JOIN eoi_finance_events f
        ON f.settlement_id = s.id
       AND f.refund_request_id = NEW.id
       AND f.event_type = 'REFUND_ISSUED'
      WHERE s.eoi_refund_request_id = NEW.id
        AND s.tenant_id = NEW.tenant_id
        AND s.project_id = NEW.project_id
        AND s.settlement_type = 'EOI_REFUND'
        AND s.status = 'SETTLED'
    ) INTO v_evidence_exists;
    IF NOT v_evidence_exists THEN
      RAISE EXCEPTION 'EOI refund payout projection requires settled disbursement and deposit-ledger evidence';
    END IF;
  END IF;

  IF v_reopen_transition THEN
    SELECT EXISTS (
      SELECT 1
      FROM settlement_disbursements s
      JOIN eoi_finance_events f
        ON f.settlement_id = s.id
       AND f.refund_request_id = NEW.id
       AND f.event_type = 'REFUND_REVERSED'
      WHERE s.eoi_refund_request_id = NEW.id
        AND s.tenant_id = NEW.tenant_id
        AND s.project_id = NEW.project_id
        AND s.settlement_type = 'EOI_REFUND'
        AND s.status = 'REVERSED'
    ) INTO v_evidence_exists;
    IF NOT v_evidence_exists THEN
      RAISE EXCEPTION 'EOI refund payout reopening requires reversed disbursement and deposit-ledger evidence';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_eoi_refund_payout_projection_guard ON eoi_refund_requests;
CREATE TRIGGER trg_eoi_refund_payout_projection_guard
BEFORE UPDATE ON eoi_refund_requests
FOR EACH ROW EXECUTE FUNCTION preneura_guard_eoi_refund_payout_projection();

UPDATE platform_runtime_contract
SET schema_version = 38,
    minimum_runtime_version = 38,
    migration_marker = '0038_eoi_projection_authority',
    updated_at = now()
WHERE singleton_key = 'production';

COMMIT;
