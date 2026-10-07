BEGIN;

CREATE OR REPLACE FUNCTION enforce_settlement_terminal_evidence()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_event_type text;
  v_event_id uuid;
  v_count integer;
  v_sum numeric(18,2);
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  v_event_type := CASE NEW.status
    WHEN 'SETTLED' THEN 'SETTLED'
    WHEN 'FAILED' THEN 'FAILED'
    WHEN 'REVERSED' THEN 'REVERSED'
    ELSE NULL
  END;

  IF v_event_type IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT id INTO v_event_id
  FROM settlement_events
  WHERE settlement_id = NEW.id
    AND event_type = v_event_type
  ORDER BY occurred_at DESC, id DESC
  LIMIT 1;

  IF v_event_id IS NULL THEN
    RAISE EXCEPTION 'settlement terminal status % requires immutable event evidence', NEW.status;
  END IF;

  IF NEW.status IN ('SETTLED','REVERSED') THEN
    SELECT count(*), coalesce(sum(signed_amount), 0)
      INTO v_count, v_sum
    FROM settlement_ledger_entries
    WHERE settlement_event_id = v_event_id;
    IF v_count <> 2 OR v_sum <> 0 THEN
      RAISE EXCEPTION 'settlement terminal status % requires balanced ledger evidence', NEW.status;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_settlement_terminal_evidence ON settlement_disbursements;
CREATE TRIGGER trg_settlement_terminal_evidence
BEFORE UPDATE OF status ON settlement_disbursements
FOR EACH ROW EXECUTE FUNCTION enforce_settlement_terminal_evidence();

CREATE OR REPLACE FUNCTION enforce_eoi_refund_paid_by_settlement()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status = 'PAID' AND OLD.status IS DISTINCT FROM 'PAID' THEN
    IF NOT EXISTS (
      SELECT 1
      FROM settlement_disbursements s
      WHERE s.eoi_refund_request_id = NEW.id
        AND s.status = 'SETTLED'
    ) THEN
      RAISE EXCEPTION 'EOI refund cannot be marked PAID without settled disbursement evidence';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_eoi_refund_paid_by_settlement ON eoi_refund_requests;
CREATE TRIGGER trg_eoi_refund_paid_by_settlement
BEFORE UPDATE OF status ON eoi_refund_requests
FOR EACH ROW EXECUTE FUNCTION enforce_eoi_refund_paid_by_settlement();

CREATE OR REPLACE FUNCTION enforce_commission_paid_by_settlement()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status = 'PAID' AND OLD.status IS DISTINCT FROM 'PAID' THEN
    IF NOT EXISTS (
      SELECT 1
      FROM settlement_disbursements s
      WHERE s.commission_case_id = NEW.id
        AND s.status = 'SETTLED'
    ) THEN
      RAISE EXCEPTION 'commission cannot be marked PAID without settled disbursement evidence';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_commission_paid_by_settlement ON broker_commission_cases;
CREATE TRIGGER trg_commission_paid_by_settlement
BEFORE UPDATE OF status ON broker_commission_cases
FOR EACH ROW EXECUTE FUNCTION enforce_commission_paid_by_settlement();

UPDATE platform_runtime_contract
SET schema_version = 35,
    minimum_runtime_version = 34,
    migration_marker = '0035_settlement_state_authority',
    updated_at = now()
WHERE singleton_key = 'production';

COMMIT;
