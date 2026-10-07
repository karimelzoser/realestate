BEGIN;

-- EOI collection is an incoming customer-deposit authority. Refund cash leaves
-- only through the settlement/disbursement authority introduced in schemas
-- 34-36. The two subledgers meet through BUYER_REFUND_PAYABLE so aggregate
-- accounting remains balanced without recording outgoing cash twice.
ALTER TABLE buyer_eois
  ADD CONSTRAINT buyer_eois_finance_scope_identity
  UNIQUE (id, tenant_id, project_id);

CREATE TABLE eoi_finance_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  eoi_id uuid NOT NULL,
  refund_request_id uuid REFERENCES eoi_refund_requests(id) ON DELETE RESTRICT,
  settlement_id uuid REFERENCES settlement_disbursements(id) ON DELETE RESTRICT,
  event_type text NOT NULL CHECK (event_type IN (
    'PAYMENT_RECEIVED',
    'PAYMENT_REVERSED',
    'REFUND_ISSUED',
    'REFUND_REVERSED',
    'RETAINED_AMOUNT_RECOGNIZED',
    'RETAINED_AMOUNT_REVERSED'
  )),
  amount numeric(18,2) NOT NULL CHECK (amount > 0),
  currency char(3) NOT NULL,
  source text NOT NULL CHECK (source IN ('MANUAL','SYSTEM')),
  external_reference text NOT NULL,
  related_event_id uuid REFERENCES eoi_finance_events(id) ON DELETE RESTRICT,
  actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  occurred_at timestamptz NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (eoi_id, tenant_id, project_id)
    REFERENCES buyer_eois(id, tenant_id, project_id) ON DELETE RESTRICT,
  CHECK (
    (event_type = 'PAYMENT_RECEIVED'
      AND refund_request_id IS NULL AND settlement_id IS NULL AND related_event_id IS NULL)
    OR (event_type = 'PAYMENT_REVERSED'
      AND refund_request_id IS NULL AND settlement_id IS NULL AND related_event_id IS NOT NULL)
    OR (event_type IN ('REFUND_ISSUED','RETAINED_AMOUNT_RECOGNIZED')
      AND refund_request_id IS NOT NULL AND settlement_id IS NOT NULL AND related_event_id IS NOT NULL)
    OR (event_type IN ('REFUND_REVERSED','RETAINED_AMOUNT_REVERSED')
      AND refund_request_id IS NOT NULL AND settlement_id IS NOT NULL AND related_event_id IS NOT NULL)
  )
);

CREATE UNIQUE INDEX eoi_finance_reference_dedupe
  ON eoi_finance_events(tenant_id, project_id, source, external_reference, event_type);
CREATE INDEX eoi_finance_receipts
  ON eoi_finance_events(eoi_id, occurred_at DESC, created_at DESC, id DESC)
  WHERE event_type = 'PAYMENT_RECEIVED';
CREATE UNIQUE INDEX eoi_finance_one_payment_reversal
  ON eoi_finance_events(related_event_id)
  WHERE event_type = 'PAYMENT_REVERSED';
CREATE UNIQUE INDEX eoi_finance_one_refund_event_per_settlement
  ON eoi_finance_events(settlement_id, event_type)
  WHERE settlement_id IS NOT NULL;
CREATE INDEX eoi_finance_events_eoi
  ON eoi_finance_events(eoi_id, occurred_at, created_at, id);
CREATE INDEX eoi_finance_events_refund
  ON eoi_finance_events(refund_request_id, occurred_at, id)
  WHERE refund_request_id IS NOT NULL;

CREATE TABLE eoi_finance_ledger_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  eoi_finance_event_id uuid NOT NULL REFERENCES eoi_finance_events(id) ON DELETE RESTRICT,
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  eoi_id uuid NOT NULL,
  account text NOT NULL CHECK (account IN (
    'CASH_CLEARING','EOI_DEPOSIT_LIABILITY','BUYER_REFUND_PAYABLE','EOI_FEE_REVENUE'
  )),
  signed_amount numeric(18,2) NOT NULL CHECK (signed_amount <> 0),
  currency char(3) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (eoi_id, tenant_id, project_id)
    REFERENCES buyer_eois(id, tenant_id, project_id) ON DELETE RESTRICT,
  UNIQUE (eoi_finance_event_id, account)
);

CREATE INDEX eoi_finance_ledger_entries_eoi
  ON eoi_finance_ledger_entries(eoi_id, created_at, id);

CREATE OR REPLACE FUNCTION preneura_reject_eoi_finance_evidence_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'EOI financial evidence is immutable; post compensating evidence instead';
END;
$$;

CREATE TRIGGER trg_eoi_finance_events_immutable
BEFORE UPDATE OR DELETE ON eoi_finance_events
FOR EACH ROW EXECUTE FUNCTION preneura_reject_eoi_finance_evidence_mutation();

CREATE TRIGGER trg_eoi_finance_ledger_immutable
BEFORE UPDATE OR DELETE ON eoi_finance_ledger_entries
FOR EACH ROW EXECUTE FUNCTION preneura_reject_eoi_finance_evidence_mutation();

CREATE OR REPLACE FUNCTION preneura_assert_eoi_finance_event_balanced()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_count integer;
  v_sum numeric(18,2);
  v_currency_count integer;
BEGIN
  SELECT count(*), COALESCE(sum(signed_amount), 0), count(DISTINCT currency)
    INTO v_count, v_sum, v_currency_count
  FROM eoi_finance_ledger_entries
  WHERE eoi_finance_event_id = NEW.eoi_finance_event_id;

  IF v_count <> 2 OR v_sum <> 0 OR v_currency_count <> 1 THEN
    RAISE EXCEPTION 'EOI finance event % must have exactly two balanced same-currency entries',
      NEW.eoi_finance_event_id;
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER trg_eoi_finance_ledger_balanced
AFTER INSERT ON eoi_finance_ledger_entries
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION preneura_assert_eoi_finance_event_balanced();

CREATE OR REPLACE FUNCTION preneura_post_eoi_payment(
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
  v_existing eoi_finance_events%ROWTYPE;
  v_event_id uuid;
BEGIN
  IF nullif(trim(p_external_reference), '') IS NULL THEN
    RAISE EXCEPTION 'EOI payment reference is required';
  END IF;

  SELECT * INTO v_eoi
  FROM buyer_eois
  WHERE id = p_eoi_id AND tenant_id = p_tenant_id AND project_id = p_project_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'EOI not found'; END IF;

  SELECT receipt.* INTO v_existing
  FROM eoi_finance_events receipt
  WHERE receipt.eoi_id = p_eoi_id
    AND receipt.event_type = 'PAYMENT_RECEIVED'
    AND NOT EXISTS (
      SELECT 1 FROM eoi_finance_events reversal
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
    source, external_reference, actor_user_id, occurred_at
  ) VALUES (
    p_tenant_id, p_project_id, p_eoi_id, 'PAYMENT_RECEIVED', v_eoi.amount, v_eoi.currency,
    'MANUAL', p_external_reference, p_actor_user_id, p_occurred_at
  ) RETURNING id INTO v_event_id;

  INSERT INTO eoi_finance_ledger_entries
    (eoi_finance_event_id, tenant_id, project_id, eoi_id, account, signed_amount, currency)
  VALUES
    (v_event_id, p_tenant_id, p_project_id, p_eoi_id, 'CASH_CLEARING', v_eoi.amount, v_eoi.currency),
    (v_event_id, p_tenant_id, p_project_id, p_eoi_id, 'EOI_DEPOSIT_LIABILITY', -v_eoi.amount, v_eoi.currency);

  PERFORM set_config('preneura.eoi_finance_projection', 'on', true);
  UPDATE buyer_eois
  SET status = 'PAID', payment_reference = p_external_reference,
      paid_at = p_occurred_at, updated_at = p_occurred_at
  WHERE id = p_eoi_id;

  INSERT INTO domain_outbox_events (
    tenant_id, project_id, aggregate_type, aggregate_id, event_type, payload, published_at, attempts
  ) VALUES (
    p_tenant_id, p_project_id, 'EOI', p_eoi_id, 'eoi.paid',
    jsonb_build_object('financeEventId', v_event_id, 'paymentReference', p_external_reference,
      'actorUserId', p_actor_user_id), NULL, 0
  );
  RETURN v_event_id;
END;
$$;

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
  IF nullif(trim(p_external_reference), '') IS NULL THEN
    RAISE EXCEPTION 'EOI reversal reference is required';
  END IF;

  SELECT * INTO v_eoi
  FROM buyer_eois
  WHERE id = p_eoi_id AND tenant_id = p_tenant_id AND project_id = p_project_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'EOI not found'; END IF;
  IF v_eoi.status <> 'PAID' THEN RAISE EXCEPTION 'EOI payment can only be reversed while status is PAID'; END IF;
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
      SELECT 1 FROM eoi_finance_events reversal
      WHERE reversal.event_type = 'PAYMENT_REVERSED' AND reversal.related_event_id = receipt.id
    )
  ORDER BY receipt.occurred_at DESC, receipt.created_at DESC, receipt.id DESC
  LIMIT 1
  FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'active EOI receipt evidence not found'; END IF;

  SELECT * INTO v_existing
  FROM eoi_finance_events
  WHERE related_event_id = v_receipt.id AND event_type = 'PAYMENT_REVERSED';
  IF FOUND THEN
    IF v_existing.external_reference = p_external_reference THEN RETURN v_existing.id; END IF;
    RAISE EXCEPTION 'EOI receipt already has a different reversal';
  END IF;

  INSERT INTO eoi_finance_events (
    tenant_id, project_id, eoi_id, event_type, amount, currency, source,
    external_reference, related_event_id, actor_user_id, occurred_at
  ) VALUES (
    p_tenant_id, p_project_id, p_eoi_id, 'PAYMENT_REVERSED', v_receipt.amount,
    v_receipt.currency, 'MANUAL', p_external_reference, v_receipt.id,
    p_actor_user_id, p_occurred_at
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

CREATE OR REPLACE FUNCTION preneura_record_eoi_settlement_accounting(
  p_settlement_id uuid,
  p_status text,
  p_occurred_at timestamptz DEFAULT now()
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_settlement settlement_disbursements%ROWTYPE;
  v_request eoi_refund_requests%ROWTYPE;
  v_eoi buyer_eois%ROWTYPE;
  v_receipt eoi_finance_events%ROWTYPE;
  v_refund eoi_finance_events%ROWTYPE;
  v_retained_event eoi_finance_events%ROWTYPE;
  v_event_id uuid;
  v_retained numeric(18,2);
BEGIN
  IF p_status NOT IN ('SETTLED','REVERSED') THEN RETURN; END IF;

  SELECT * INTO v_settlement
  FROM settlement_disbursements
  WHERE id = p_settlement_id AND settlement_type = 'EOI_REFUND';
  IF NOT FOUND THEN RETURN; END IF;
  IF v_settlement.status <> p_status THEN
    RAISE EXCEPTION 'EOI accounting settlement status mismatch';
  END IF;

  SELECT * INTO v_request FROM eoi_refund_requests
  WHERE id = v_settlement.eoi_refund_request_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'EOI refund request not found for settlement accounting'; END IF;

  SELECT * INTO v_eoi FROM buyer_eois WHERE id = v_request.eoi_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'EOI not found for settlement accounting'; END IF;

  SELECT receipt.* INTO v_receipt
  FROM eoi_finance_events receipt
  WHERE receipt.eoi_id = v_eoi.id
    AND receipt.event_type = 'PAYMENT_RECEIVED'
    AND NOT EXISTS (
      SELECT 1 FROM eoi_finance_events reversal
      WHERE reversal.event_type = 'PAYMENT_REVERSED' AND reversal.related_event_id = receipt.id
    )
  ORDER BY receipt.occurred_at DESC, receipt.created_at DESC, receipt.id DESC
  LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'active immutable EOI receipt is required before refund settlement'; END IF;

  IF v_request.currency <> v_receipt.currency
     OR v_request.original_eoi_amount <> v_receipt.amount
     OR v_request.requested_amount > v_receipt.amount
     OR v_settlement.amount <> v_request.requested_amount
     OR v_settlement.currency <> v_request.currency THEN
    RAISE EXCEPTION 'EOI refund settlement does not reconcile to immutable deposit evidence';
  END IF;

  v_retained := round(v_receipt.amount - v_request.requested_amount, 2);

  IF p_status = 'SETTLED' THEN
    IF EXISTS (SELECT 1 FROM eoi_finance_events WHERE settlement_id = p_settlement_id AND event_type = 'REFUND_ISSUED') THEN
      RETURN;
    END IF;

    INSERT INTO eoi_finance_events (
      tenant_id, project_id, eoi_id, refund_request_id, settlement_id, event_type,
      amount, currency, source, external_reference, related_event_id, actor_user_id,
      occurred_at, metadata
    ) VALUES (
      v_settlement.tenant_id, v_settlement.project_id, v_eoi.id, v_request.id,
      p_settlement_id, 'REFUND_ISSUED', v_request.requested_amount, v_request.currency,
      'SYSTEM', 'settlement:' || p_settlement_id::text, v_receipt.id, v_settlement.initiated_by,
      p_occurred_at, jsonb_build_object('settlementId', p_settlement_id)
    ) RETURNING id INTO v_event_id;

    INSERT INTO eoi_finance_ledger_entries
      (eoi_finance_event_id, tenant_id, project_id, eoi_id, account, signed_amount, currency)
    VALUES
      (v_event_id, v_settlement.tenant_id, v_settlement.project_id, v_eoi.id,
       'EOI_DEPOSIT_LIABILITY', v_request.requested_amount, v_request.currency),
      (v_event_id, v_settlement.tenant_id, v_settlement.project_id, v_eoi.id,
       'BUYER_REFUND_PAYABLE', -v_request.requested_amount, v_request.currency);

    IF v_retained > 0 THEN
      INSERT INTO eoi_finance_events (
        tenant_id, project_id, eoi_id, refund_request_id, settlement_id, event_type,
        amount, currency, source, external_reference, related_event_id, actor_user_id,
        occurred_at, metadata
      ) VALUES (
        v_settlement.tenant_id, v_settlement.project_id, v_eoi.id, v_request.id,
        p_settlement_id, 'RETAINED_AMOUNT_RECOGNIZED', v_retained, v_request.currency,
        'SYSTEM', 'retained:' || p_settlement_id::text, v_receipt.id, v_settlement.initiated_by,
        p_occurred_at, jsonb_build_object('settlementId', p_settlement_id)
      ) RETURNING id INTO v_event_id;

      INSERT INTO eoi_finance_ledger_entries
        (eoi_finance_event_id, tenant_id, project_id, eoi_id, account, signed_amount, currency)
      VALUES
        (v_event_id, v_settlement.tenant_id, v_settlement.project_id, v_eoi.id,
         'EOI_DEPOSIT_LIABILITY', v_retained, v_request.currency),
        (v_event_id, v_settlement.tenant_id, v_settlement.project_id, v_eoi.id,
         'EOI_FEE_REVENUE', -v_retained, v_request.currency);
    END IF;
  ELSE
    SELECT * INTO v_refund FROM eoi_finance_events
    WHERE settlement_id = p_settlement_id AND event_type = 'REFUND_ISSUED';
    IF NOT FOUND THEN RAISE EXCEPTION 'settled EOI refund evidence is required before reversal'; END IF;
    IF EXISTS (SELECT 1 FROM eoi_finance_events WHERE settlement_id = p_settlement_id AND event_type = 'REFUND_REVERSED') THEN
      RETURN;
    END IF;

    INSERT INTO eoi_finance_events (
      tenant_id, project_id, eoi_id, refund_request_id, settlement_id, event_type,
      amount, currency, source, external_reference, related_event_id, actor_user_id,
      occurred_at, metadata
    ) VALUES (
      v_settlement.tenant_id, v_settlement.project_id, v_eoi.id, v_request.id,
      p_settlement_id, 'REFUND_REVERSED', v_refund.amount, v_refund.currency,
      'SYSTEM', 'settlement-reversal:' || p_settlement_id::text, v_refund.id,
      v_settlement.initiated_by, p_occurred_at, jsonb_build_object('settlementId', p_settlement_id)
    ) RETURNING id INTO v_event_id;

    INSERT INTO eoi_finance_ledger_entries
      (eoi_finance_event_id, tenant_id, project_id, eoi_id, account, signed_amount, currency)
    VALUES
      (v_event_id, v_settlement.tenant_id, v_settlement.project_id, v_eoi.id,
       'EOI_DEPOSIT_LIABILITY', -v_refund.amount, v_refund.currency),
      (v_event_id, v_settlement.tenant_id, v_settlement.project_id, v_eoi.id,
       'BUYER_REFUND_PAYABLE', v_refund.amount, v_refund.currency);

    SELECT * INTO v_retained_event FROM eoi_finance_events
    WHERE settlement_id = p_settlement_id AND event_type = 'RETAINED_AMOUNT_RECOGNIZED';
    IF FOUND THEN
      INSERT INTO eoi_finance_events (
        tenant_id, project_id, eoi_id, refund_request_id, settlement_id, event_type,
        amount, currency, source, external_reference, related_event_id, actor_user_id,
        occurred_at, metadata
      ) VALUES (
        v_settlement.tenant_id, v_settlement.project_id, v_eoi.id, v_request.id,
        p_settlement_id, 'RETAINED_AMOUNT_REVERSED', v_retained_event.amount, v_retained_event.currency,
        'SYSTEM', 'retained-reversal:' || p_settlement_id::text, v_retained_event.id,
        v_settlement.initiated_by, p_occurred_at, jsonb_build_object('settlementId', p_settlement_id)
      ) RETURNING id INTO v_event_id;

      INSERT INTO eoi_finance_ledger_entries
        (eoi_finance_event_id, tenant_id, project_id, eoi_id, account, signed_amount, currency)
      VALUES
        (v_event_id, v_settlement.tenant_id, v_settlement.project_id, v_eoi.id,
         'EOI_DEPOSIT_LIABILITY', -v_retained_event.amount, v_retained_event.currency),
        (v_event_id, v_settlement.tenant_id, v_settlement.project_id, v_eoi.id,
         'EOI_FEE_REVENUE', v_retained_event.amount, v_retained_event.currency);
    END IF;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION preneura_eoi_accounting_from_settlement()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.settlement_type = 'EOI_REFUND'
     AND NEW.status IS DISTINCT FROM OLD.status
     AND NEW.status IN ('SETTLED','REVERSED') THEN
    PERFORM preneura_record_eoi_settlement_accounting(NEW.id, NEW.status, COALESCE(NEW.settled_at, NEW.reversed_at, now()));
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_eoi_accounting_from_settlement
AFTER UPDATE OF status ON settlement_disbursements
FOR EACH ROW EXECUTE FUNCTION preneura_eoi_accounting_from_settlement();

UPDATE platform_runtime_contract
SET schema_version = 37,
    minimum_runtime_version = 37,
    migration_marker = '0037_eoi_financial_evidence',
    updated_at = now()
WHERE singleton_key = 'production';

COMMIT;
