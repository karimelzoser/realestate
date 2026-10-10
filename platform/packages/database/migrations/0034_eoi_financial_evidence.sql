BEGIN;

-- The production migrator accepts one canonical four-digit migration per
-- version. Keep the EOI finance scoped identity inside schema 34 rather than
-- relying on a noncanonical 0033a sidecar migration that production would skip.
ALTER TABLE buyer_eois
  ADD CONSTRAINT buyer_eois_finance_scope_identity
  UNIQUE (id, tenant_id, project_id);

-- ---------------------------------------------------------------------------
-- EOI money is independent from the transaction/installment ledger. An EOI is
-- held as a customer deposit liability until it is refunded or the retained
-- portion is recognized. Status columns remain operational projections only.
-- ---------------------------------------------------------------------------
CREATE TABLE eoi_finance_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  eoi_id uuid NOT NULL,
  refund_request_id uuid,
  event_type text NOT NULL CHECK (event_type IN (
    'PAYMENT_RECEIVED','PAYMENT_REVERSED','REFUND_ISSUED','RETAINED_AMOUNT_RECOGNIZED'
  )),
  amount numeric(18,2) NOT NULL CHECK (amount > 0),
  currency char(3) NOT NULL,
  source text NOT NULL CHECK (source IN ('MANUAL','PROVIDER','SYSTEM')),
  external_reference text NOT NULL,
  provider text,
  provider_event_id text,
  related_event_id uuid REFERENCES eoi_finance_events(id) ON DELETE RESTRICT,
  actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  occurred_at timestamptz NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (eoi_id, tenant_id, project_id)
    REFERENCES buyer_eois(id, tenant_id, project_id) ON DELETE RESTRICT,
  FOREIGN KEY (refund_request_id)
    REFERENCES eoi_refund_requests(id) ON DELETE RESTRICT,
  CHECK (
    (source = 'PROVIDER' AND provider IS NOT NULL AND provider_event_id IS NOT NULL)
    OR (source <> 'PROVIDER' AND provider IS NULL AND provider_event_id IS NULL)
  ),
  CHECK (
    (event_type = 'PAYMENT_RECEIVED' AND related_event_id IS NULL AND refund_request_id IS NULL)
    OR (event_type = 'PAYMENT_REVERSED' AND related_event_id IS NOT NULL AND refund_request_id IS NULL)
    OR (event_type IN ('REFUND_ISSUED','RETAINED_AMOUNT_RECOGNIZED')
        AND related_event_id IS NOT NULL AND refund_request_id IS NOT NULL)
  )
);

CREATE UNIQUE INDEX eoi_finance_provider_dedupe
  ON eoi_finance_events(provider, provider_event_id)
  WHERE source = 'PROVIDER';

CREATE UNIQUE INDEX eoi_finance_reference_dedupe
  ON eoi_finance_events(tenant_id, project_id, source, external_reference);

-- Historical receipts remain immutable after compensation. An EOI may receive
-- a corrected replacement receipt only after its previous receipt is reversed.
-- The buyer_eois row lock in the posting function serializes active-receipt
-- creation; the indexes below make active receipt/reversal lookup deterministic.
CREATE INDEX eoi_finance_receipts
  ON eoi_finance_events(eoi_id, occurred_at DESC, created_at DESC, id DESC)
  WHERE event_type = 'PAYMENT_RECEIVED';

CREATE UNIQUE INDEX eoi_finance_one_reversal_per_receipt
  ON eoi_finance_events(related_event_id)
  WHERE event_type = 'PAYMENT_REVERSED';

CREATE UNIQUE INDEX eoi_finance_one_refund_per_request
  ON eoi_finance_events(refund_request_id)
  WHERE event_type = 'REFUND_ISSUED';

CREATE UNIQUE INDEX eoi_finance_one_retained_per_request
  ON eoi_finance_events(refund_request_id)
  WHERE event_type = 'RETAINED_AMOUNT_RECOGNIZED';

CREATE INDEX eoi_finance_events_eoi
  ON eoi_finance_events(eoi_id, occurred_at, created_at, id);

CREATE TABLE eoi_finance_ledger_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  eoi_finance_event_id uuid NOT NULL REFERENCES eoi_finance_events(id) ON DELETE RESTRICT,
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  eoi_id uuid NOT NULL,
  account text NOT NULL CHECK (account IN ('CASH_CLEARING','EOI_DEPOSIT_LIABILITY','EOI_FEE_REVENUE')),
  signed_amount numeric(18,2) NOT NULL CHECK (signed_amount <> 0),
  currency char(3) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (eoi_id, tenant_id, project_id)
    REFERENCES buyer_eois(id, tenant_id, project_id) ON DELETE RESTRICT,
  UNIQUE (eoi_finance_event_id, account)
);

CREATE INDEX eoi_finance_ledger_entries_eoi
  ON eoi_finance_ledger_entries(eoi_id, created_at, id);

-- ---------------------------------------------------------------------------
-- Evidence is append-only. Corrections are compensating events.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION preneura_reject_eoi_finance_evidence_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'EOI financial evidence is immutable; post a compensating event instead';
END;
$$;

CREATE TRIGGER trg_eoi_finance_events_immutable
BEFORE UPDATE OR DELETE ON eoi_finance_events
FOR EACH ROW EXECUTE FUNCTION preneura_reject_eoi_finance_evidence_mutation();

CREATE TRIGGER trg_eoi_finance_ledger_immutable
BEFORE UPDATE OR DELETE ON eoi_finance_ledger_entries
FOR EACH ROW EXECUTE FUNCTION preneura_reject_eoi_finance_evidence_mutation();

-- The old projection columns may only be moved by certified EOI finance
-- functions. Business-state transitions such as PAID -> APPLIED or
-- PAID/APPLIED -> REFUND_REQUESTED remain owned by the sales/refund workflow.
CREATE OR REPLACE FUNCTION preneura_guard_eoi_finance_projection()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_authorized boolean := current_setting('preneura.eoi_finance_projection', true) = 'on';
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

CREATE TRIGGER trg_buyer_eois_finance_projection_guard
BEFORE UPDATE ON buyer_eois
FOR EACH ROW EXECUTE FUNCTION preneura_guard_eoi_finance_projection();

CREATE OR REPLACE FUNCTION preneura_guard_eoi_refund_payout_projection()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF (
    NEW.paid_at IS DISTINCT FROM OLD.paid_at
    OR (OLD.status <> 'PAID' AND NEW.status = 'PAID')
  ) AND current_setting('preneura.eoi_finance_projection', true) <> 'on' THEN
    RAISE EXCEPTION 'EOI refund payout status is ledger-derived and cannot be mutated directly';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_eoi_refund_payout_projection_guard
BEFORE UPDATE ON eoi_refund_requests
FOR EACH ROW EXECUTE FUNCTION preneura_guard_eoi_refund_payout_projection();

-- ---------------------------------------------------------------------------
-- Every EOI finance event must have exactly two same-currency balanced lines.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION preneura_assert_eoi_finance_event_balanced()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_event_id uuid := COALESCE(NEW.eoi_finance_event_id, OLD.eoi_finance_event_id);
  v_count integer;
  v_sum numeric(18,2);
  v_currency_count integer;
BEGIN
  SELECT count(*), COALESCE(sum(signed_amount), 0), count(DISTINCT currency)
  INTO v_count, v_sum, v_currency_count
  FROM eoi_finance_ledger_entries
  WHERE eoi_finance_event_id = v_event_id;

  IF v_count <> 2 OR v_sum <> 0 OR v_currency_count <> 1 THEN
    RAISE EXCEPTION 'EOI finance event % must have exactly two balanced same-currency ledger entries', v_event_id;
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER trg_eoi_finance_ledger_balanced
AFTER INSERT ON eoi_finance_ledger_entries
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION preneura_assert_eoi_finance_event_balanced();

-- ---------------------------------------------------------------------------
-- Manual/provider EOI receipt. The EOI is intentionally all-or-nothing: it is
-- an eligibility deposit, not an installment schedule.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION preneura_post_eoi_payment(
  p_tenant_id uuid,
  p_project_id uuid,
  p_eoi_id uuid,
  p_external_reference text,
  p_actor_user_id uuid,
  p_occurred_at timestamptz DEFAULT now(),
  p_source text DEFAULT 'MANUAL',
  p_provider text DEFAULT NULL,
  p_provider_event_id text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
AS $$
DECLARE
  v_eoi buyer_eois%ROWTYPE;
  v_existing eoi_finance_events%ROWTYPE;
  v_event_id uuid;
BEGIN
  SELECT * INTO v_eoi
  FROM buyer_eois
  WHERE id = p_eoi_id
    AND tenant_id = p_tenant_id
    AND project_id = p_project_id
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'EOI not found'; END IF;

  SELECT receipt.* INTO v_existing
  FROM eoi_finance_events receipt
  WHERE receipt.eoi_id = p_eoi_id
    AND receipt.event_type = 'PAYMENT_RECEIVED'
    AND NOT EXISTS (
      SELECT 1
      FROM eoi_finance_events reversal
      WHERE reversal.event_type = 'PAYMENT_REVERSED'
        AND reversal.related_event_id = receipt.id
    )
  ORDER BY receipt.occurred_at DESC, receipt.created_at DESC, receipt.id DESC
  LIMIT 1;

  IF FOUND THEN
    IF v_existing.external_reference = p_external_reference
       AND v_existing.amount = v_eoi.amount
       AND v_existing.currency = v_eoi.currency THEN
      RETURN v_existing.id;
    END IF;
    RAISE EXCEPTION 'EOI already has a different active immutable payment receipt';
  END IF;

  IF v_eoi.status <> 'PAYMENT_PENDING' THEN
    RAISE EXCEPTION 'only a payment-pending EOI can receive payment';
  END IF;

  INSERT INTO eoi_finance_events (
    tenant_id, project_id, eoi_id, event_type, amount, currency,
    source, external_reference, provider, provider_event_id,
    actor_user_id, occurred_at, metadata
  ) VALUES (
    p_tenant_id, p_project_id, p_eoi_id, 'PAYMENT_RECEIVED', v_eoi.amount, v_eoi.currency,
    p_source, p_external_reference, p_provider, p_provider_event_id,
    p_actor_user_id, p_occurred_at, '{}'::jsonb
  ) RETURNING id INTO v_event_id;

  INSERT INTO eoi_finance_ledger_entries
    (eoi_finance_event_id, tenant_id, project_id, eoi_id, account, signed_amount, currency)
  VALUES
    (v_event_id, p_tenant_id, p_project_id, p_eoi_id, 'CASH_CLEARING', v_eoi.amount, v_eoi.currency),
    (v_event_id, p_tenant_id, p_project_id, p_eoi_id, 'EOI_DEPOSIT_LIABILITY', -v_eoi.amount, v_eoi.currency);

  PERFORM set_config('preneura.eoi_finance_projection', 'on', true);
  UPDATE buyer_eois
  SET status = 'PAID',
      payment_reference = p_external_reference,
      paid_at = p_occurred_at,
      updated_at = p_occurred_at
  WHERE id = p_eoi_id;

  INSERT INTO domain_outbox_events (
    tenant_id, project_id, aggregate_type, aggregate_id, event_type, payload, published_at, attempts
  ) VALUES (
    p_tenant_id, p_project_id, 'EOI', p_eoi_id, 'eoi.paid',
    jsonb_build_object(
      'financeEventId', v_event_id,
      'paymentReference', p_external_reference,
      'actorUserId', p_actor_user_id
    ),
    NULL, 0
  );

  RETURN v_event_id;
END;
$$;

-- A mistaken manual receipt can only be reversed before the EOI has entered
-- queue/reservation/refund processing. The original event remains immutable.
CREATE OR REPLACE FUNCTION preneura_reverse_eoi_payment(
  p_tenant_id uuid,
  p_project_id uuid,
  p_eoi_id uuid,
  p_external_reference text,
  p_actor_user_id uuid,
  p_occurred_at timestamptz DEFAULT now()
)
RETURNS uuid
LANGUAGE plpgsql
AS $$
DECLARE
  v_eoi buyer_eois%ROWTYPE;
  v_receipt eoi_finance_events%ROWTYPE;
  v_existing eoi_finance_events%ROWTYPE;
  v_event_id uuid;
BEGIN
  SELECT * INTO v_eoi
  FROM buyer_eois
  WHERE id = p_eoi_id AND tenant_id = p_tenant_id AND project_id = p_project_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'EOI not found'; END IF;

  IF v_eoi.status <> 'PAID' THEN
    RAISE EXCEPTION 'EOI payment can only be reversed while status is PAID';
  END IF;
  IF EXISTS (SELECT 1 FROM queue_entries WHERE eoi_id = p_eoi_id) THEN
    RAISE EXCEPTION 'EOI payment cannot be reversed after queue entry exists';
  END IF;
  IF EXISTS (SELECT 1 FROM eoi_refund_requests WHERE eoi_id = p_eoi_id) THEN
    RAISE EXCEPTION 'EOI payment cannot be reversed after refund workflow begins';
  END IF;

  SELECT receipt.* INTO v_receipt
  FROM eoi_finance_events receipt
  WHERE receipt.eoi_id = p_eoi_id
    AND receipt.event_type = 'PAYMENT_RECEIVED'
    AND NOT EXISTS (
      SELECT 1
      FROM eoi_finance_events reversal
      WHERE reversal.event_type = 'PAYMENT_REVERSED'
        AND reversal.related_event_id = receipt.id
    )
  ORDER BY receipt.occurred_at DESC, receipt.created_at DESC, receipt.id DESC
  LIMIT 1
  FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'active EOI receipt evidence not found'; END IF;

  SELECT * INTO v_existing FROM eoi_finance_events
  WHERE related_event_id = v_receipt.id AND event_type = 'PAYMENT_REVERSED';
  IF FOUND THEN
    IF v_existing.external_reference = p_external_reference THEN RETURN v_existing.id; END IF;
    RAISE EXCEPTION 'EOI receipt already has a different reversal';
  END IF;

  INSERT INTO eoi_finance_events (
    tenant_id, project_id, eoi_id, event_type, amount, currency,
    source, external_reference, related_event_id, actor_user_id, occurred_at, metadata
  ) VALUES (
    p_tenant_id, p_project_id, p_eoi_id, 'PAYMENT_REVERSED', v_receipt.amount, v_receipt.currency,
    'MANUAL', p_external_reference, v_receipt.id, p_actor_user_id, p_occurred_at, '{}'::jsonb
  ) RETURNING id INTO v_event_id;

  INSERT INTO eoi_finance_ledger_entries
    (eoi_finance_event_id, tenant_id, project_id, eoi_id, account, signed_amount, currency)
  VALUES
    (v_event_id, p_tenant_id, p_project_id, p_eoi_id, 'CASH_CLEARING', -v_receipt.amount, v_receipt.currency),
    (v_event_id, p_tenant_id, p_project_id, p_eoi_id, 'EOI_DEPOSIT_LIABILITY', v_receipt.amount, v_receipt.currency);

  PERFORM set_config('preneura.eoi_finance_projection', 'on', true);
  UPDATE buyer_eois
  SET status = 'PAYMENT_PENDING', payment_reference = NULL, paid_at = NULL, updated_at = p_occurred_at
  WHERE id = p_eoi_id;

  INSERT INTO domain_outbox_events (
    tenant_id, project_id, aggregate_type, aggregate_id, event_type, payload, published_at, attempts
  ) VALUES (
    p_tenant_id, p_project_id, 'EOI', p_eoi_id, 'eoi.payment.reversed',
    jsonb_build_object('financeEventId', v_event_id, 'actorUserId', p_actor_user_id), NULL, 0
  );

  RETURN v_event_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- Approved refund payout. A payout is idempotent by refund request and payout
-- reference. The unreturned portion is reclassified from deposit liability to
-- fee/non-refundable revenue in the same transaction.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION preneura_pay_eoi_refund(
  p_tenant_id uuid,
  p_project_id uuid,
  p_refund_request_id uuid,
  p_payout_reference text,
  p_actor_user_id uuid,
  p_occurred_at timestamptz DEFAULT now()
)
RETURNS uuid
LANGUAGE plpgsql
AS $$
DECLARE
  v_request eoi_refund_requests%ROWTYPE;
  v_eoi buyer_eois%ROWTYPE;
  v_receipt eoi_finance_events%ROWTYPE;
  v_existing eoi_finance_events%ROWTYPE;
  v_refund_event_id uuid;
  v_retained_event_id uuid;
  v_retained numeric(18,2);
BEGIN
  SELECT * INTO v_request
  FROM eoi_refund_requests
  WHERE id = p_refund_request_id
    AND tenant_id = p_tenant_id
    AND project_id = p_project_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'refund request not found'; END IF;

  SELECT * INTO v_existing
  FROM eoi_finance_events
  WHERE refund_request_id = p_refund_request_id AND event_type = 'REFUND_ISSUED';
  IF FOUND THEN
    IF v_existing.external_reference = p_payout_reference THEN RETURN v_existing.id; END IF;
    RAISE EXCEPTION 'refund request already has a different immutable payout';
  END IF;

  IF v_request.status <> 'APPROVED' THEN
    RAISE EXCEPTION 'only an approved refund request can be paid';
  END IF;

  SELECT * INTO v_eoi
  FROM buyer_eois
  WHERE id = v_request.eoi_id
    AND tenant_id = p_tenant_id
    AND project_id = p_project_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'EOI not found'; END IF;

  IF v_eoi.status <> 'REFUND_REQUESTED' THEN
    RAISE EXCEPTION 'EOI is not awaiting an approved refund payout';
  END IF;

  SELECT receipt.* INTO v_receipt
  FROM eoi_finance_events receipt
  WHERE receipt.eoi_id = v_eoi.id
    AND receipt.event_type = 'PAYMENT_RECEIVED'
    AND NOT EXISTS (
      SELECT 1
      FROM eoi_finance_events reversal
      WHERE reversal.event_type = 'PAYMENT_REVERSED'
        AND reversal.related_event_id = receipt.id
    )
  ORDER BY receipt.occurred_at DESC, receipt.created_at DESC, receipt.id DESC
  LIMIT 1
  FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'active immutable EOI payment receipt is required before refund payout'; END IF;

  IF v_request.currency <> v_receipt.currency
     OR v_request.original_eoi_amount <> v_receipt.amount
     OR v_request.requested_amount > v_receipt.amount THEN
    RAISE EXCEPTION 'refund financial snapshot does not reconcile to the original EOI receipt';
  END IF;

  v_retained := round(v_receipt.amount - v_request.requested_amount, 2);
  IF v_retained < 0 THEN RAISE EXCEPTION 'refund cannot exceed original EOI receipt'; END IF;

  INSERT INTO eoi_finance_events (
    tenant_id, project_id, eoi_id, refund_request_id, event_type, amount, currency,
    source, external_reference, related_event_id, actor_user_id, occurred_at, metadata
  ) VALUES (
    p_tenant_id, p_project_id, v_eoi.id, v_request.id, 'REFUND_ISSUED',
    v_request.requested_amount, v_request.currency,
    'MANUAL', p_payout_reference, v_receipt.id, p_actor_user_id, p_occurred_at,
    jsonb_build_object('refundPolicyId', v_request.refund_policy_id, 'stage', v_request.stage)
  ) RETURNING id INTO v_refund_event_id;

  INSERT INTO eoi_finance_ledger_entries
    (eoi_finance_event_id, tenant_id, project_id, eoi_id, account, signed_amount, currency)
  VALUES
    (v_refund_event_id, p_tenant_id, p_project_id, v_eoi.id, 'CASH_CLEARING', -v_request.requested_amount, v_request.currency),
    (v_refund_event_id, p_tenant_id, p_project_id, v_eoi.id, 'EOI_DEPOSIT_LIABILITY', v_request.requested_amount, v_request.currency);

  IF v_retained > 0 THEN
    INSERT INTO eoi_finance_events (
      tenant_id, project_id, eoi_id, refund_request_id, event_type, amount, currency,
      source, external_reference, related_event_id, actor_user_id, occurred_at, metadata
    ) VALUES (
      p_tenant_id, p_project_id, v_eoi.id, v_request.id, 'RETAINED_AMOUNT_RECOGNIZED',
      v_retained, v_request.currency,
      'SYSTEM', 'retained:' || v_request.id::text, v_receipt.id, p_actor_user_id, p_occurred_at,
      jsonb_build_object('refundEventId', v_refund_event_id)
    ) RETURNING id INTO v_retained_event_id;

    INSERT INTO eoi_finance_ledger_entries
      (eoi_finance_event_id, tenant_id, project_id, eoi_id, account, signed_amount, currency)
    VALUES
      (v_retained_event_id, p_tenant_id, p_project_id, v_eoi.id, 'EOI_DEPOSIT_LIABILITY', v_retained, v_request.currency),
      (v_retained_event_id, p_tenant_id, p_project_id, v_eoi.id, 'EOI_FEE_REVENUE', -v_retained, v_request.currency);
  END IF;

  PERFORM set_config('preneura.eoi_finance_projection', 'on', true);
  UPDATE eoi_refund_requests
  SET status = 'PAID', paid_at = p_occurred_at, updated_at = p_occurred_at
  WHERE id = v_request.id;

  UPDATE buyer_eois
  SET status = 'REFUNDED', refunded_at = p_occurred_at, updated_at = p_occurred_at
  WHERE id = v_eoi.id;

  INSERT INTO domain_outbox_events (
    tenant_id, project_id, aggregate_type, aggregate_id, event_type, payload, published_at, attempts
  ) VALUES (
    p_tenant_id, p_project_id, 'EOI_REFUND_REQUEST', v_request.id, 'eoi.refund.paid',
    jsonb_build_object(
      'eoiId', v_eoi.id,
      'financeEventId', v_refund_event_id,
      'requestedAmount', v_request.requested_amount,
      'retainedAmount', v_retained,
      'currency', v_request.currency,
      'actorUserId', p_actor_user_id
    ),
    NULL, 0
  );

  RETURN v_refund_event_id;
END;
$$;

-- This migration changes the write authority for EOI payment/refund fields, so
-- runtime 33 must not serve against schema 34.
UPDATE platform_runtime_contract
SET schema_version = 34,
    minimum_runtime_version = 34,
    migration_marker = '0034_eoi_financial_evidence',
    updated_at = now()
WHERE singleton_key = 'production';

COMMIT;
