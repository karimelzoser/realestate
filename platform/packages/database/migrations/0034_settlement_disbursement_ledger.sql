BEGIN;

CREATE TABLE settlement_disbursements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  project_id uuid NOT NULL REFERENCES projects(id),
  settlement_type text NOT NULL CHECK (settlement_type IN ('EOI_REFUND','BROKER_COMMISSION')),
  eoi_refund_request_id uuid NULL REFERENCES eoi_refund_requests(id),
  commission_case_id uuid NULL REFERENCES broker_commission_cases(id),
  buyer_profile_id uuid NULL REFERENCES buyer_profiles(id),
  broker_company_id uuid NULL REFERENCES broker_companies(id),
  amount numeric(18,2) NOT NULL CHECK (amount > 0),
  currency char(3) NOT NULL,
  status text NOT NULL DEFAULT 'PENDING_SUBMISSION'
    CHECK (status IN ('PENDING_SUBMISSION','SUBMITTED','SETTLED','FAILED','REVERSED','CANCELLED')),
  provider text NULL,
  provider_reference text NULL,
  idempotency_key text NOT NULL,
  initiated_by uuid NULL REFERENCES users(id),
  initiated_at timestamptz NOT NULL DEFAULT now(),
  submitted_at timestamptz NULL,
  settled_at timestamptz NULL,
  failed_at timestamptz NULL,
  reversed_at timestamptz NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT settlement_source_shape CHECK (
    (settlement_type = 'EOI_REFUND'
      AND eoi_refund_request_id IS NOT NULL
      AND commission_case_id IS NULL
      AND buyer_profile_id IS NOT NULL
      AND broker_company_id IS NULL)
    OR
    (settlement_type = 'BROKER_COMMISSION'
      AND eoi_refund_request_id IS NULL
      AND commission_case_id IS NOT NULL
      AND buyer_profile_id IS NULL
      AND broker_company_id IS NOT NULL)
  ),
  CONSTRAINT settlement_idempotency_unique UNIQUE (tenant_id, idempotency_key)
);

CREATE UNIQUE INDEX settlement_active_eoi_refund_unique
  ON settlement_disbursements(eoi_refund_request_id)
  WHERE eoi_refund_request_id IS NOT NULL
    AND status IN ('PENDING_SUBMISSION','SUBMITTED','SETTLED');

CREATE UNIQUE INDEX settlement_active_commission_unique
  ON settlement_disbursements(commission_case_id)
  WHERE commission_case_id IS NOT NULL
    AND status IN ('PENDING_SUBMISSION','SUBMITTED','SETTLED');

CREATE INDEX settlement_project_status_idx
  ON settlement_disbursements(tenant_id, project_id, status, initiated_at DESC);

CREATE TABLE settlement_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  settlement_id uuid NOT NULL REFERENCES settlement_disbursements(id),
  event_type text NOT NULL CHECK (event_type IN ('CREATED','SUBMITTED','SETTLED','FAILED','REVERSED','CANCELLED')),
  actor_user_id uuid NULL REFERENCES users(id),
  provider text NULL,
  provider_event_id text NULL,
  provider_reference text NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX settlement_provider_event_unique
  ON settlement_events(provider, provider_event_id)
  WHERE provider IS NOT NULL AND provider_event_id IS NOT NULL;

CREATE INDEX settlement_events_settlement_idx
  ON settlement_events(settlement_id, occurred_at, id);

CREATE TABLE settlement_ledger_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  settlement_id uuid NOT NULL REFERENCES settlement_disbursements(id),
  settlement_event_id uuid NOT NULL REFERENCES settlement_events(id),
  account_code text NOT NULL CHECK (account_code IN ('CASH_CLEARING','BUYER_REFUND_PAYABLE','BROKER_COMMISSION_PAYABLE')),
  signed_amount numeric(18,2) NOT NULL CHECK (signed_amount <> 0),
  currency char(3) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX settlement_ledger_settlement_idx
  ON settlement_ledger_entries(settlement_id, created_at, id);
CREATE INDEX settlement_ledger_event_idx
  ON settlement_ledger_entries(settlement_event_id);

CREATE TABLE settlement_provider_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL,
  provider_event_id text NOT NULL,
  content_hash bytea NOT NULL,
  settlement_id uuid NOT NULL REFERENCES settlement_disbursements(id),
  event_type text NOT NULL CHECK (event_type IN ('SETTLED','FAILED','REVERSED')),
  provider_reference text NULL,
  occurred_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz NULL,
  CONSTRAINT settlement_provider_event_id_unique UNIQUE (provider, provider_event_id)
);

CREATE INDEX settlement_provider_unprocessed_idx
  ON settlement_provider_events(received_at, id)
  WHERE processed_at IS NULL;

CREATE OR REPLACE FUNCTION settlement_immutable_row()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END;
$$;

CREATE TRIGGER trg_settlement_events_immutable
BEFORE UPDATE OR DELETE ON settlement_events
FOR EACH ROW EXECUTE FUNCTION settlement_immutable_row();

CREATE TRIGGER trg_settlement_ledger_immutable
BEFORE UPDATE OR DELETE ON settlement_ledger_entries
FOR EACH ROW EXECUTE FUNCTION settlement_immutable_row();

CREATE OR REPLACE FUNCTION settlement_validate_scope()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_tenant uuid;
  v_project uuid;
  v_amount numeric(18,2);
  v_currency char(3);
  v_buyer uuid;
  v_broker uuid;
BEGIN
  IF NEW.settlement_type = 'EOI_REFUND' THEN
    SELECT r.tenant_id, r.project_id, r.requested_amount, r.currency, r.buyer_profile_id
      INTO v_tenant, v_project, v_amount, v_currency, v_buyer
    FROM eoi_refund_requests r
    WHERE r.id = NEW.eoi_refund_request_id;

    IF v_tenant IS NULL OR v_tenant <> NEW.tenant_id OR v_project <> NEW.project_id
       OR v_amount <> NEW.amount OR v_currency <> NEW.currency OR v_buyer <> NEW.buyer_profile_id THEN
      RAISE EXCEPTION 'EOI refund settlement scope/amount mismatch';
    END IF;
  ELSE
    SELECT c.tenant_id, c.project_id, c.commission_amount, p.currency, c.broker_company_id
      INTO v_tenant, v_project, v_amount, v_currency, v_broker
    FROM broker_commission_cases c
    JOIN transactions t ON t.id = c.transaction_id
    JOIN reservations r ON r.id = t.reservation_id
    JOIN projects p ON p.id = c.project_id
    WHERE c.id = NEW.commission_case_id;

    IF v_tenant IS NULL OR v_tenant <> NEW.tenant_id OR v_project <> NEW.project_id
       OR v_amount <> NEW.amount OR v_currency <> NEW.currency OR v_broker <> NEW.broker_company_id THEN
      RAISE EXCEPTION 'commission settlement scope/amount mismatch';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_settlement_validate_scope
BEFORE INSERT ON settlement_disbursements
FOR EACH ROW EXECUTE FUNCTION settlement_validate_scope();

CREATE OR REPLACE FUNCTION settlement_protect_identity()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     OR NEW.project_id IS DISTINCT FROM OLD.project_id
     OR NEW.settlement_type IS DISTINCT FROM OLD.settlement_type
     OR NEW.eoi_refund_request_id IS DISTINCT FROM OLD.eoi_refund_request_id
     OR NEW.commission_case_id IS DISTINCT FROM OLD.commission_case_id
     OR NEW.buyer_profile_id IS DISTINCT FROM OLD.buyer_profile_id
     OR NEW.broker_company_id IS DISTINCT FROM OLD.broker_company_id
     OR NEW.amount IS DISTINCT FROM OLD.amount
     OR NEW.currency IS DISTINCT FROM OLD.currency
     OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
     OR NEW.initiated_by IS DISTINCT FROM OLD.initiated_by
     OR NEW.initiated_at IS DISTINCT FROM OLD.initiated_at THEN
    RAISE EXCEPTION 'settlement identity and amount are immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_settlement_protect_identity
BEFORE UPDATE ON settlement_disbursements
FOR EACH ROW EXECUTE FUNCTION settlement_protect_identity();

CREATE OR REPLACE FUNCTION settlement_assert_balanced_event(p_event_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_count integer;
  v_sum numeric(18,2);
BEGIN
  SELECT count(*), coalesce(sum(signed_amount), 0)
    INTO v_count, v_sum
  FROM settlement_ledger_entries
  WHERE settlement_event_id = p_event_id;

  IF v_count <> 2 OR v_sum <> 0 THEN
    RAISE EXCEPTION 'settlement ledger event % must contain exactly two balanced entries', p_event_id;
  END IF;
END;
$$;

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
  v_id uuid;
BEGIN
  SELECT * INTO v_request
  FROM eoi_refund_requests
  WHERE id = p_refund_request_id
  FOR UPDATE;

  IF NOT FOUND OR v_request.status <> 'APPROVED' THEN
    RAISE EXCEPTION 'EOI refund request must be approved before settlement';
  END IF;

  SELECT id INTO v_id
  FROM settlement_disbursements
  WHERE tenant_id = v_request.tenant_id
    AND idempotency_key = p_idempotency_key;
  IF v_id IS NOT NULL THEN
    RETURN v_id;
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

  SELECT id INTO v_id
  FROM settlement_disbursements
  WHERE tenant_id = v_case.tenant_id
    AND idempotency_key = p_idempotency_key;
  IF v_id IS NOT NULL THEN
    RETURN v_id;
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
  SELECT * INTO v_row FROM settlement_disbursements WHERE id = p_settlement_id FOR UPDATE;
  IF NOT FOUND OR v_row.status <> 'PENDING_SUBMISSION' THEN
    RAISE EXCEPTION 'settlement is not pending submission';
  END IF;
  IF nullif(trim(p_provider), '') IS NULL OR nullif(trim(p_provider_reference), '') IS NULL THEN
    RAISE EXCEPTION 'provider and provider reference are required';
  END IF;

  UPDATE settlement_disbursements
  SET status = 'SUBMITTED', provider = p_provider, provider_reference = p_provider_reference,
      submitted_at = p_now, updated_at = p_now
  WHERE id = p_settlement_id;

  INSERT INTO settlement_events (
    settlement_id, event_type, actor_user_id, provider, provider_reference, occurred_at
  ) VALUES (
    p_settlement_id, 'SUBMITTED', p_actor_user_id, p_provider, p_provider_reference, p_now
  );
END;
$$;

CREATE OR REPLACE FUNCTION preneura_apply_settlement_outcome(
  p_settlement_id uuid,
  p_event_type text,
  p_actor_user_id uuid,
  p_provider text,
  p_provider_event_id text,
  p_provider_reference text,
  p_occurred_at timestamptz,
  p_metadata jsonb DEFAULT '{}'::jsonb
) RETURNS uuid
LANGUAGE plpgsql
AS $$
DECLARE
  v_row settlement_disbursements%ROWTYPE;
  v_event_id uuid;
  v_payable_account text;
BEGIN
  IF p_event_type NOT IN ('SETTLED','FAILED','REVERSED') THEN
    RAISE EXCEPTION 'unsupported settlement outcome %', p_event_type;
  END IF;

  SELECT * INTO v_row FROM settlement_disbursements WHERE id = p_settlement_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'settlement not found'; END IF;

  IF p_event_type = 'SETTLED' AND v_row.status NOT IN ('PENDING_SUBMISSION','SUBMITTED','FAILED') THEN
    RAISE EXCEPTION 'settlement cannot transition from % to SETTLED', v_row.status;
  ELSIF p_event_type = 'FAILED' AND v_row.status NOT IN ('PENDING_SUBMISSION','SUBMITTED') THEN
    RAISE EXCEPTION 'settlement cannot transition from % to FAILED', v_row.status;
  ELSIF p_event_type = 'REVERSED' AND v_row.status <> 'SETTLED' THEN
    RAISE EXCEPTION 'only a settled disbursement can be reversed';
  END IF;

  INSERT INTO settlement_events (
    settlement_id, event_type, actor_user_id, provider, provider_event_id,
    provider_reference, metadata, occurred_at
  ) VALUES (
    p_settlement_id, p_event_type, p_actor_user_id, p_provider, p_provider_event_id,
    p_provider_reference, coalesce(p_metadata, '{}'::jsonb), p_occurred_at
  ) RETURNING id INTO v_event_id;

  v_payable_account := CASE v_row.settlement_type
    WHEN 'EOI_REFUND' THEN 'BUYER_REFUND_PAYABLE'
    ELSE 'BROKER_COMMISSION_PAYABLE'
  END;

  IF p_event_type = 'SETTLED' THEN
    INSERT INTO settlement_ledger_entries (
      settlement_id, settlement_event_id, account_code, signed_amount, currency
    ) VALUES
      (p_settlement_id, v_event_id, v_payable_account, v_row.amount, v_row.currency),
      (p_settlement_id, v_event_id, 'CASH_CLEARING', -v_row.amount, v_row.currency);
    PERFORM settlement_assert_balanced_event(v_event_id);

    UPDATE settlement_disbursements
    SET status = 'SETTLED', provider = coalesce(p_provider, provider),
        provider_reference = coalesce(p_provider_reference, provider_reference),
        settled_at = p_occurred_at, failed_at = NULL, updated_at = now()
    WHERE id = p_settlement_id;

    IF v_row.settlement_type = 'EOI_REFUND' THEN
      UPDATE eoi_refund_requests
      SET status = 'PAID', paid_at = p_occurred_at, updated_at = now()
      WHERE id = v_row.eoi_refund_request_id AND status = 'APPROVED';
      IF NOT FOUND THEN RAISE EXCEPTION 'approved EOI refund request not found during settlement'; END IF;

      UPDATE buyer_eois e
      SET status = 'REFUNDED', refunded_at = p_occurred_at, updated_at = now()
      FROM eoi_refund_requests r
      WHERE r.id = v_row.eoi_refund_request_id
        AND e.id = r.eoi_id
        AND e.status = 'REFUND_REQUESTED';
      IF NOT FOUND THEN RAISE EXCEPTION 'EOI refund state is not payable'; END IF;
    ELSE
      UPDATE broker_commission_cases
      SET status = 'PAID', paid_at = p_occurred_at, updated_at = now()
      WHERE id = v_row.commission_case_id AND status IN ('INVOICED','DUE');
      IF NOT FOUND THEN RAISE EXCEPTION 'commission case is not payable'; END IF;
    END IF;

  ELSIF p_event_type = 'FAILED' THEN
    UPDATE settlement_disbursements
    SET status = 'FAILED', provider = coalesce(p_provider, provider),
        provider_reference = coalesce(p_provider_reference, provider_reference),
        failed_at = p_occurred_at, updated_at = now()
    WHERE id = p_settlement_id;

  ELSE
    INSERT INTO settlement_ledger_entries (
      settlement_id, settlement_event_id, account_code, signed_amount, currency
    ) VALUES
      (p_settlement_id, v_event_id, v_payable_account, -v_row.amount, v_row.currency),
      (p_settlement_id, v_event_id, 'CASH_CLEARING', v_row.amount, v_row.currency);
    PERFORM settlement_assert_balanced_event(v_event_id);

    UPDATE settlement_disbursements
    SET status = 'REVERSED', reversed_at = p_occurred_at, updated_at = now()
    WHERE id = p_settlement_id;

    IF v_row.settlement_type = 'EOI_REFUND' THEN
      UPDATE eoi_refund_requests
      SET status = 'APPROVED', paid_at = NULL, updated_at = now()
      WHERE id = v_row.eoi_refund_request_id AND status = 'PAID';
      UPDATE buyer_eois e
      SET status = 'REFUND_REQUESTED', refunded_at = NULL, updated_at = now()
      FROM eoi_refund_requests r
      WHERE r.id = v_row.eoi_refund_request_id
        AND e.id = r.eoi_id
        AND e.status = 'REFUNDED';
    ELSE
      UPDATE broker_commission_cases c
      SET status = CASE WHEN c.due_at IS NOT NULL AND c.due_at <= p_occurred_at THEN 'DUE' ELSE 'INVOICED' END,
          paid_at = NULL, updated_at = now()
      WHERE c.id = v_row.commission_case_id AND c.status = 'PAID';
    END IF;
  END IF;

  RETURN v_event_id;
END;
$$;

CREATE OR REPLACE FUNCTION protect_settlement_provider_event()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'settlement provider events cannot be deleted';
  END IF;
  IF NEW.provider IS DISTINCT FROM OLD.provider
     OR NEW.provider_event_id IS DISTINCT FROM OLD.provider_event_id
     OR NEW.content_hash IS DISTINCT FROM OLD.content_hash
     OR NEW.settlement_id IS DISTINCT FROM OLD.settlement_id
     OR NEW.event_type IS DISTINCT FROM OLD.event_type
     OR NEW.provider_reference IS DISTINCT FROM OLD.provider_reference
     OR NEW.occurred_at IS DISTINCT FROM OLD.occurred_at
     OR NEW.received_at IS DISTINCT FROM OLD.received_at THEN
    RAISE EXCEPTION 'settlement provider event identity/content are immutable';
  END IF;
  IF OLD.processed_at IS NOT NULL AND NEW.processed_at IS DISTINCT FROM OLD.processed_at THEN
    RAISE EXCEPTION 'processed settlement provider event cannot be changed';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_settlement_provider_event_protect
BEFORE UPDATE OR DELETE ON settlement_provider_events
FOR EACH ROW EXECUTE FUNCTION protect_settlement_provider_event();

UPDATE platform_runtime_contract
SET schema_version = 34,
    minimum_runtime_version = 33,
    migration_marker = '0034_settlement_disbursement_ledger',
    updated_at = now()
WHERE singleton_key = 'production';

COMMIT;
