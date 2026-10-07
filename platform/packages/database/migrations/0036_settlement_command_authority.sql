BEGIN;

-- Idempotency keys are tenant-wide command identifiers. Reusing a key for a
-- different source must fail instead of returning an unrelated settlement.
CREATE OR REPLACE FUNCTION preneura_create_eoi_refund_settlement(
  p_refund_request_id uuid,
  p_actor_user_id uuid,
  p_idempotency_key text,
  p_now timestamptz DEFAULT now()
) RETURNS uuid
LANGUAGE plpgsql
AS $$
DECLARE
  v_request eoi_refund_requests%ROWTYPE;
  v_existing settlement_disbursements%ROWTYPE;
  v_id uuid;
BEGIN
  SELECT * INTO v_request
  FROM eoi_refund_requests
  WHERE id = p_refund_request_id
  FOR UPDATE;

  IF NOT FOUND OR v_request.status <> 'APPROVED' THEN
    RAISE EXCEPTION 'EOI refund request must be approved before settlement';
  END IF;

  SELECT * INTO v_existing
  FROM settlement_disbursements
  WHERE tenant_id = v_request.tenant_id
    AND idempotency_key = p_idempotency_key;
  IF FOUND THEN
    IF v_existing.settlement_type <> 'EOI_REFUND'
       OR v_existing.eoi_refund_request_id IS DISTINCT FROM v_request.id THEN
      RAISE EXCEPTION 'settlement idempotency key belongs to a different command';
    END IF;
    RETURN v_existing.id;
  END IF;

  INSERT INTO settlement_disbursements (
    tenant_id, project_id, settlement_type, eoi_refund_request_id, buyer_profile_id,
    amount, currency, status, idempotency_key, initiated_by, initiated_at, updated_at
  ) VALUES (
    v_request.tenant_id, v_request.project_id, 'EOI_REFUND', v_request.id, v_request.buyer_profile_id,
    v_request.requested_amount, v_request.currency, 'PENDING_SUBMISSION', p_idempotency_key,
    p_actor_user_id, p_now, p_now
  ) RETURNING id INTO v_id;

  INSERT INTO settlement_events (settlement_id, event_type, actor_user_id, occurred_at)
  VALUES (v_id, 'CREATED', p_actor_user_id, p_now);

  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION preneura_create_commission_settlement(
  p_commission_case_id uuid,
  p_actor_user_id uuid,
  p_idempotency_key text,
  p_now timestamptz DEFAULT now()
) RETURNS uuid
LANGUAGE plpgsql
AS $$
DECLARE
  v_case broker_commission_cases%ROWTYPE;
  v_currency char(3);
  v_existing settlement_disbursements%ROWTYPE;
  v_id uuid;
BEGIN
  SELECT * INTO v_case
  FROM broker_commission_cases
  WHERE id = p_commission_case_id
  FOR UPDATE;

  IF NOT FOUND OR v_case.status NOT IN ('INVOICED','DUE') THEN
    RAISE EXCEPTION 'commission case must be invoiced or due before settlement';
  END IF;

  SELECT currency INTO v_currency FROM projects WHERE id = v_case.project_id;

  SELECT * INTO v_existing
  FROM settlement_disbursements
  WHERE tenant_id = v_case.tenant_id
    AND idempotency_key = p_idempotency_key;
  IF FOUND THEN
    IF v_existing.settlement_type <> 'BROKER_COMMISSION'
       OR v_existing.commission_case_id IS DISTINCT FROM v_case.id THEN
      RAISE EXCEPTION 'settlement idempotency key belongs to a different command';
    END IF;
    RETURN v_existing.id;
  END IF;

  INSERT INTO settlement_disbursements (
    tenant_id, project_id, settlement_type, commission_case_id, broker_company_id,
    amount, currency, status, idempotency_key, initiated_by, initiated_at, updated_at
  ) VALUES (
    v_case.tenant_id, v_case.project_id, 'BROKER_COMMISSION', v_case.id, v_case.broker_company_id,
    v_case.commission_amount, v_currency, 'PENDING_SUBMISSION', p_idempotency_key,
    p_actor_user_id, p_now, p_now
  ) RETURNING id INTO v_id;

  INSERT INTO settlement_events (settlement_id, event_type, actor_user_id, occurred_at)
  VALUES (v_id, 'CREATED', p_actor_user_id, p_now);

  RETURN v_id;
END;
$$;

-- Submission is a retry-safe command. Evidence is inserted before the status
-- projection so the state-authority trigger can prove the transition.
CREATE OR REPLACE FUNCTION preneura_submit_settlement(
  p_settlement_id uuid,
  p_actor_user_id uuid,
  p_provider text,
  p_provider_reference text,
  p_now timestamptz DEFAULT now()
) RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_row settlement_disbursements%ROWTYPE;
BEGIN
  SELECT * INTO v_row
  FROM settlement_disbursements
  WHERE id = p_settlement_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'settlement not found'; END IF;

  IF nullif(trim(p_provider), '') IS NULL OR nullif(trim(p_provider_reference), '') IS NULL THEN
    RAISE EXCEPTION 'provider and provider reference are required';
  END IF;

  IF v_row.status = 'SUBMITTED' THEN
    IF v_row.provider = p_provider AND v_row.provider_reference = p_provider_reference THEN
      RETURN;
    END IF;
    RAISE EXCEPTION 'settlement was already submitted with different provider evidence';
  END IF;

  IF v_row.status <> 'PENDING_SUBMISSION' THEN
    RAISE EXCEPTION 'settlement is not pending submission';
  END IF;

  INSERT INTO settlement_events (
    settlement_id, event_type, actor_user_id, provider, provider_reference, occurred_at
  ) VALUES (
    p_settlement_id, 'SUBMITTED', p_actor_user_id, p_provider, p_provider_reference, p_now
  );

  UPDATE settlement_disbursements
  SET status = 'SUBMITTED', provider = p_provider, provider_reference = p_provider_reference,
      submitted_at = p_now, updated_at = p_now
  WHERE id = p_settlement_id;
END;
$$;

-- Validate both legal transition shape and matching immutable event evidence.
CREATE OR REPLACE FUNCTION enforce_settlement_terminal_evidence()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_event_type text;
  v_event_id uuid;
  v_count integer;
  v_sum numeric(18,2);
  v_transition_allowed boolean := false;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  v_transition_allowed := CASE OLD.status
    WHEN 'PENDING_SUBMISSION' THEN NEW.status IN ('SUBMITTED','SETTLED','FAILED','CANCELLED')
    WHEN 'SUBMITTED' THEN NEW.status IN ('SETTLED','FAILED','CANCELLED')
    WHEN 'FAILED' THEN NEW.status = 'SETTLED'
    WHEN 'SETTLED' THEN NEW.status = 'REVERSED'
    ELSE false
  END;

  IF NOT v_transition_allowed THEN
    RAISE EXCEPTION 'illegal settlement state transition % -> %', OLD.status, NEW.status;
  END IF;

  v_event_type := CASE NEW.status
    WHEN 'SUBMITTED' THEN 'SUBMITTED'
    WHEN 'SETTLED' THEN 'SETTLED'
    WHEN 'FAILED' THEN 'FAILED'
    WHEN 'REVERSED' THEN 'REVERSED'
    WHEN 'CANCELLED' THEN 'CANCELLED'
    ELSE NULL
  END;

  SELECT id INTO v_event_id
  FROM settlement_events
  WHERE settlement_id = NEW.id
    AND event_type = v_event_type
  ORDER BY occurred_at DESC, id DESC
  LIMIT 1;

  IF v_event_id IS NULL THEN
    RAISE EXCEPTION 'settlement status % requires immutable event evidence', NEW.status;
  END IF;

  IF NEW.status IN ('SETTLED','REVERSED') THEN
    SELECT count(*), coalesce(sum(signed_amount), 0)
      INTO v_count, v_sum
    FROM settlement_ledger_entries
    WHERE settlement_event_id = v_event_id;
    IF v_count <> 2 OR v_sum <> 0 THEN
      RAISE EXCEPTION 'settlement status % requires balanced ledger evidence', NEW.status;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- Paid obligations can be reopened only when their settlement itself carries
-- immutable REVERSED evidence. This prevents direct rollback of paid state.
CREATE OR REPLACE FUNCTION enforce_eoi_refund_paid_by_settlement()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status = 'PAID' AND OLD.status IS DISTINCT FROM 'PAID' THEN
    IF NOT EXISTS (
      SELECT 1 FROM settlement_disbursements s
      WHERE s.eoi_refund_request_id = NEW.id AND s.status = 'SETTLED'
    ) THEN
      RAISE EXCEPTION 'EOI refund cannot be marked PAID without settled disbursement evidence';
    END IF;
  ELSIF OLD.status = 'PAID' AND NEW.status IS DISTINCT FROM 'PAID' THEN
    IF NOT EXISTS (
      SELECT 1 FROM settlement_disbursements s
      WHERE s.eoi_refund_request_id = NEW.id AND s.status = 'REVERSED'
    ) THEN
      RAISE EXCEPTION 'paid EOI refund cannot be reopened without reversed disbursement evidence';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION enforce_commission_paid_by_settlement()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status = 'PAID' AND OLD.status IS DISTINCT FROM 'PAID' THEN
    IF NOT EXISTS (
      SELECT 1 FROM settlement_disbursements s
      WHERE s.commission_case_id = NEW.id AND s.status = 'SETTLED'
    ) THEN
      RAISE EXCEPTION 'commission cannot be marked PAID without settled disbursement evidence';
    END IF;
  ELSIF OLD.status = 'PAID' AND NEW.status IS DISTINCT FROM 'PAID' THEN
    IF NOT EXISTS (
      SELECT 1 FROM settlement_disbursements s
      WHERE s.commission_case_id = NEW.id AND s.status = 'REVERSED'
    ) THEN
      RAISE EXCEPTION 'paid commission cannot be reopened without reversed disbursement evidence';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

UPDATE platform_runtime_contract
SET schema_version = 36,
    minimum_runtime_version = 36,
    migration_marker = '0036_settlement_command_authority',
    updated_at = now()
WHERE singleton_key = 'production';

COMMIT;
