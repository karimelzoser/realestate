BEGIN;

DROP FUNCTION IF EXISTS preneura_pay_eoi_refund(uuid,uuid,uuid,text,uuid,timestamp with time zone);

-- Incoming EOI receipt/reversal projections remain owned by EOI finance.
-- REFUNDED/refund reopening are owned only by immutable settlement evidence.
CREATE OR REPLACE FUNCTION preneura_guard_eoi_finance_projection()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_payment_authorized boolean :=
    COALESCE(current_setting('preneura.eoi_finance_projection', true), '') = 'on';
  v_payment_transition boolean :=
    NEW.payment_reference IS DISTINCT FROM OLD.payment_reference
    OR NEW.paid_at IS DISTINCT FROM OLD.paid_at
    OR (OLD.status = 'PAYMENT_PENDING' AND NEW.status = 'PAID')
    OR (OLD.status = 'PAID' AND NEW.status = 'PAYMENT_PENDING');
  v_refund_transition boolean :=
    NEW.refunded_at IS DISTINCT FROM OLD.refunded_at
    OR (OLD.status IS DISTINCT FROM 'REFUNDED' AND NEW.status = 'REFUNDED')
    OR (OLD.status = 'REFUNDED' AND NEW.status IS DISTINCT FROM 'REFUNDED');
  v_settlement_ok boolean := false;
BEGIN
  IF v_payment_transition THEN
    IF NOT v_payment_authorized THEN
      RAISE EXCEPTION 'EOI payment projection is ledger-derived and cannot be mutated directly';
    END IF;
    PERFORM set_config('preneura.eoi_finance_projection', '', true);
  END IF;

  IF v_refund_transition THEN
    IF NEW.status = 'REFUNDED' THEN
      SELECT EXISTS (
        SELECT 1
        FROM eoi_refund_requests r
        JOIN settlement_disbursements s ON s.eoi_refund_request_id = r.id
        WHERE r.eoi_id = NEW.id AND s.status = 'SETTLED'
      ) INTO v_settlement_ok;
    ELSIF OLD.status = 'REFUNDED' AND NEW.status = 'REFUND_REQUESTED' THEN
      SELECT EXISTS (
        SELECT 1
        FROM eoi_refund_requests r
        JOIN settlement_disbursements s ON s.eoi_refund_request_id = r.id
        WHERE r.eoi_id = NEW.id AND s.status = 'REVERSED'
      ) INTO v_settlement_ok;
    END IF;

    IF NOT v_settlement_ok THEN
      RAISE EXCEPTION 'EOI refund projection requires settlement evidence';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- The settlement module is the sole payout state authority.
DROP TRIGGER IF EXISTS trg_eoi_refund_payout_projection_guard ON eoi_refund_requests;
DROP FUNCTION IF EXISTS preneura_guard_eoi_refund_payout_projection();

CREATE OR REPLACE FUNCTION preneura_record_eoi_settlement_subledger()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_request eoi_refund_requests%ROWTYPE;
  v_eoi buyer_eois%ROWTYPE;
  v_receipt eoi_finance_events%ROWTYPE;
  v_refund_event eoi_finance_events%ROWTYPE;
  v_retained_event eoi_finance_events%ROWTYPE;
  v_event_id uuid;
  v_retained numeric(18,2);
BEGIN
  IF NEW.settlement_type <> 'EOI_REFUND'
     OR NEW.status IS NOT DISTINCT FROM OLD.status
     OR NEW.status NOT IN ('SETTLED','REVERSED') THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_request
  FROM eoi_refund_requests
  WHERE id = NEW.eoi_refund_request_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'EOI refund request not found for settlement accounting'; END IF;

  SELECT * INTO v_eoi
  FROM buyer_eois
  WHERE id = v_request.eoi_id
    AND tenant_id = NEW.tenant_id
    AND project_id = NEW.project_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'EOI not found for settlement accounting'; END IF;

  SELECT receipt.* INTO v_receipt
  FROM eoi_finance_events receipt
  WHERE receipt.eoi_id = v_eoi.id
    AND receipt.event_type = 'PAYMENT_RECEIVED'
    AND NOT EXISTS (
      SELECT 1 FROM eoi_finance_events reversal
      WHERE reversal.event_type = 'PAYMENT_REVERSED'
        AND reversal.related_event_id = receipt.id
    )
  ORDER BY receipt.occurred_at DESC, receipt.created_at DESC, receipt.id DESC
  LIMIT 1
  FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'active immutable EOI payment receipt is required before refund settlement';
  END IF;

  IF v_request.currency <> v_receipt.currency
     OR v_request.original_eoi_amount <> v_receipt.amount
     OR NEW.amount <> v_request.requested_amount
     OR NEW.currency <> v_request.currency THEN
    RAISE EXCEPTION 'refund settlement does not reconcile to EOI financial evidence';
  END IF;

  v_retained := round(v_receipt.amount - v_request.requested_amount, 2);
  IF v_retained < 0 THEN RAISE EXCEPTION 'refund cannot exceed original EOI receipt'; END IF;

  IF NEW.status = 'SETTLED' THEN
    IF EXISTS (
      SELECT 1 FROM eoi_finance_events
      WHERE refund_request_id = v_request.id AND event_type = 'REFUND_ISSUED'
    ) THEN
      RETURN NEW;
    END IF;

    INSERT INTO eoi_finance_events (
      tenant_id, project_id, eoi_id, refund_request_id, event_type, amount, currency,
      source, external_reference, related_event_id, actor_user_id, occurred_at, metadata
    ) VALUES (
      NEW.tenant_id, NEW.project_id, v_eoi.id, v_request.id, 'REFUND_ISSUED',
      v_request.requested_amount, v_request.currency,
      'SYSTEM', 'settlement:' || NEW.id::text || ':settled', v_receipt.id,
      NEW.initiated_by, COALESCE(NEW.settled_at, now()),
      jsonb_build_object('settlementId', NEW.id, 'provider', NEW.provider, 'providerReference', NEW.provider_reference)
    ) RETURNING id INTO v_event_id;

    INSERT INTO eoi_finance_ledger_entries
      (eoi_finance_event_id, tenant_id, project_id, eoi_id, account, signed_amount, currency)
    VALUES
      (v_event_id, NEW.tenant_id, NEW.project_id, v_eoi.id, 'CASH_CLEARING', -v_request.requested_amount, v_request.currency),
      (v_event_id, NEW.tenant_id, NEW.project_id, v_eoi.id, 'EOI_DEPOSIT_LIABILITY', v_request.requested_amount, v_request.currency);

    IF v_retained > 0 THEN
      INSERT INTO eoi_finance_events (
        tenant_id, project_id, eoi_id, refund_request_id, event_type, amount, currency,
        source, external_reference, related_event_id, actor_user_id, occurred_at, metadata
      ) VALUES (
        NEW.tenant_id, NEW.project_id, v_eoi.id, v_request.id, 'RETAINED_AMOUNT_RECOGNIZED',
        v_retained, v_request.currency,
        'SYSTEM', 'settlement:' || NEW.id::text || ':retained', v_receipt.id,
        NEW.initiated_by, COALESCE(NEW.settled_at, now()),
        jsonb_build_object('settlementId', NEW.id, 'refundEventId', v_event_id)
      ) RETURNING id INTO v_event_id;

      INSERT INTO eoi_finance_ledger_entries
        (eoi_finance_event_id, tenant_id, project_id, eoi_id, account, signed_amount, currency)
      VALUES
        (v_event_id, NEW.tenant_id, NEW.project_id, v_eoi.id, 'EOI_DEPOSIT_LIABILITY', v_retained, v_request.currency),
        (v_event_id, NEW.tenant_id, NEW.project_id, v_eoi.id, 'EOI_FEE_REVENUE', -v_retained, v_request.currency);
    END IF;

  ELSE
    SELECT * INTO v_refund_event
    FROM eoi_finance_events
    WHERE refund_request_id = v_request.id AND event_type = 'REFUND_ISSUED'
    ORDER BY occurred_at DESC, id DESC LIMIT 1;
    IF NOT FOUND THEN RAISE EXCEPTION 'EOI refund settlement accounting event missing'; END IF;

    IF NOT EXISTS (
      SELECT 1 FROM eoi_finance_events
      WHERE related_event_id = v_refund_event.id AND event_type = 'REFUND_REVERSED'
    ) THEN
      INSERT INTO eoi_finance_events (
        tenant_id, project_id, eoi_id, refund_request_id, event_type, amount, currency,
        source, external_reference, related_event_id, actor_user_id, occurred_at, metadata
      ) VALUES (
        NEW.tenant_id, NEW.project_id, v_eoi.id, v_request.id, 'REFUND_REVERSED',
        v_refund_event.amount, v_refund_event.currency,
        'SYSTEM', 'settlement:' || NEW.id::text || ':reversed', v_refund_event.id,
        NEW.initiated_by, COALESCE(NEW.reversed_at, now()), jsonb_build_object('settlementId', NEW.id)
      ) RETURNING id INTO v_event_id;

      INSERT INTO eoi_finance_ledger_entries
        (eoi_finance_event_id, tenant_id, project_id, eoi_id, account, signed_amount, currency)
      VALUES
        (v_event_id, NEW.tenant_id, NEW.project_id, v_eoi.id, 'CASH_CLEARING', v_refund_event.amount, v_refund_event.currency),
        (v_event_id, NEW.tenant_id, NEW.project_id, v_eoi.id, 'EOI_DEPOSIT_LIABILITY', -v_refund_event.amount, v_refund_event.currency);
    END IF;

    SELECT * INTO v_retained_event
    FROM eoi_finance_events
    WHERE refund_request_id = v_request.id AND event_type = 'RETAINED_AMOUNT_RECOGNIZED'
    ORDER BY occurred_at DESC, id DESC LIMIT 1;
    IF FOUND AND NOT EXISTS (
      SELECT 1 FROM eoi_finance_events
      WHERE related_event_id = v_retained_event.id AND event_type = 'RETAINED_AMOUNT_REVERSED'
    ) THEN
      INSERT INTO eoi_finance_events (
        tenant_id, project_id, eoi_id, refund_request_id, event_type, amount, currency,
        source, external_reference, related_event_id, actor_user_id, occurred_at, metadata
      ) VALUES (
        NEW.tenant_id, NEW.project_id, v_eoi.id, v_request.id, 'RETAINED_AMOUNT_REVERSED',
        v_retained_event.amount, v_retained_event.currency,
        'SYSTEM', 'settlement:' || NEW.id::text || ':retained-reversed', v_retained_event.id,
        NEW.initiated_by, COALESCE(NEW.reversed_at, now()), jsonb_build_object('settlementId', NEW.id)
      ) RETURNING id INTO v_event_id;

      INSERT INTO eoi_finance_ledger_entries
        (eoi_finance_event_id, tenant_id, project_id, eoi_id, account, signed_amount, currency)
      VALUES
        (v_event_id, NEW.tenant_id, NEW.project_id, v_eoi.id, 'EOI_DEPOSIT_LIABILITY', -v_retained_event.amount, v_retained_event.currency),
        (v_event_id, NEW.tenant_id, NEW.project_id, v_eoi.id, 'EOI_FEE_REVENUE', v_retained_event.amount, v_retained_event.currency);
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_eoi_settlement_subledger ON settlement_disbursements;
CREATE TRIGGER trg_eoi_settlement_subledger
AFTER UPDATE OF status ON settlement_disbursements
FOR EACH ROW EXECUTE FUNCTION preneura_record_eoi_settlement_subledger();

UPDATE platform_runtime_contract
SET schema_version = 39,
    minimum_runtime_version = 39,
    migration_marker = '0039_eoi_projection_authority_one_shot',
    updated_at = now()
WHERE singleton_key = 'production';

COMMIT;
