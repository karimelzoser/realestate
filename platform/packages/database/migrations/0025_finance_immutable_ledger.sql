BEGIN;

-- ---------------------------------------------------------------------------
-- Payment schedule projection: paid_amount/status are derived from immutable
-- allocations. Existing columns stay for compatibility with current APIs/UI.
-- ---------------------------------------------------------------------------
ALTER TABLE payment_schedule_items
  ADD COLUMN IF NOT EXISTS paid_amount numeric(18,2) NOT NULL DEFAULT 0 CHECK (paid_amount >= 0);

ALTER TABLE payment_schedule_items
  DROP CONSTRAINT IF EXISTS payment_schedule_items_status_check;

ALTER TABLE payment_schedule_items
  ADD CONSTRAINT payment_schedule_items_status_check
  CHECK (status IN ('UPCOMING','DUE','PARTIALLY_PAID','PAID','OVERDUE','WAIVED','CANCELLED'));

-- ---------------------------------------------------------------------------
-- Immutable payment/event authority and balanced ledger.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS finance_payment_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  transaction_id uuid NOT NULL,
  event_type text NOT NULL CHECK (event_type IN ('PAYMENT_RECEIVED','PAYMENT_REVERSED','REFUND_ISSUED')),
  amount numeric(18,2) NOT NULL CHECK (amount > 0),
  currency char(3) NOT NULL,
  source text NOT NULL CHECK (source IN ('MANUAL','PROVIDER')),
  external_reference text NOT NULL,
  provider text,
  provider_event_id text,
  related_event_id uuid REFERENCES finance_payment_events(id) ON DELETE RESTRICT,
  actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  occurred_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  FOREIGN KEY (transaction_id, tenant_id, project_id)
    REFERENCES transactions(id, tenant_id, project_id) ON DELETE RESTRICT,
  UNIQUE (id, transaction_id),
  CHECK (
    (source = 'MANUAL' AND provider IS NULL AND provider_event_id IS NULL)
    OR (source = 'PROVIDER' AND provider IS NOT NULL AND provider_event_id IS NOT NULL)
  ),
  CHECK (
    (event_type = 'PAYMENT_RECEIVED' AND related_event_id IS NULL)
    OR (event_type IN ('PAYMENT_REVERSED','REFUND_ISSUED') AND related_event_id IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS finance_payment_events_provider_dedupe
  ON finance_payment_events(provider, provider_event_id)
  WHERE source = 'PROVIDER';

CREATE INDEX IF NOT EXISTS finance_payment_events_transaction
  ON finance_payment_events(transaction_id, occurred_at, created_at);

CREATE TABLE IF NOT EXISTS finance_ledger_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_event_id uuid NOT NULL REFERENCES finance_payment_events(id) ON DELETE RESTRICT,
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  transaction_id uuid NOT NULL,
  account text NOT NULL CHECK (account IN ('CASH_CLEARING','BUYER_RECEIVABLE')),
  signed_amount numeric(18,2) NOT NULL CHECK (signed_amount <> 0),
  currency char(3) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (transaction_id, tenant_id, project_id)
    REFERENCES transactions(id, tenant_id, project_id) ON DELETE RESTRICT,
  UNIQUE (payment_event_id, account)
);

CREATE INDEX IF NOT EXISTS finance_ledger_entries_transaction
  ON finance_ledger_entries(transaction_id, created_at, id);

CREATE TABLE IF NOT EXISTS finance_payment_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_event_id uuid NOT NULL REFERENCES finance_payment_events(id) ON DELETE RESTRICT,
  payment_schedule_item_id uuid NOT NULL REFERENCES payment_schedule_items(id) ON DELETE RESTRICT,
  amount numeric(18,2) NOT NULL CHECK (amount <> 0),
  original_allocation_id uuid REFERENCES finance_payment_allocations(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (amount > 0 AND original_allocation_id IS NULL)
    OR (amount < 0 AND original_allocation_id IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS finance_payment_allocations_item
  ON finance_payment_allocations(payment_schedule_item_id, created_at, id);

CREATE INDEX IF NOT EXISTS finance_payment_allocations_event
  ON finance_payment_allocations(payment_event_id, created_at, id);

-- Provider inbox stores normalized, content-addressed webhook evidence. The raw
-- provider payload is deliberately not persisted here.
CREATE TABLE IF NOT EXISTS finance_provider_webhook_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL,
  provider_event_id text NOT NULL,
  payload_sha256_hex text NOT NULL CHECK (payload_sha256_hex ~ '^[0-9a-f]{64}$'),
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  transaction_id uuid NOT NULL,
  normalized_event_type text NOT NULL CHECK (normalized_event_type IN ('PAYMENT_RECEIVED','PAYMENT_REVERSED','REFUND_ISSUED')),
  amount numeric(18,2) NOT NULL CHECK (amount > 0),
  currency char(3) NOT NULL,
  external_reference text NOT NULL,
  related_provider_event_id text,
  occurred_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'RECEIVED' CHECK (status IN ('RECEIVED','PROCESSED','REJECTED')),
  payment_event_id uuid REFERENCES finance_payment_events(id) ON DELETE RESTRICT,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  rejection_code text,
  FOREIGN KEY (transaction_id, tenant_id, project_id)
    REFERENCES transactions(id, tenant_id, project_id) ON DELETE RESTRICT,
  UNIQUE (provider, provider_event_id),
  CHECK ((status = 'PROCESSED') = (payment_event_id IS NOT NULL AND processed_at IS NOT NULL)),
  CHECK (status <> 'REJECTED' OR rejection_code IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS finance_provider_webhook_events_transaction
  ON finance_provider_webhook_events(transaction_id, received_at DESC);

-- ---------------------------------------------------------------------------
-- Finance immutability / integrity guards.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION preneura_reject_finance_evidence_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'finance ledger evidence is immutable; post a compensating event instead';
END;
$$;

CREATE TRIGGER trg_finance_payment_events_immutable
BEFORE UPDATE OR DELETE ON finance_payment_events
FOR EACH ROW EXECUTE FUNCTION preneura_reject_finance_evidence_mutation();

CREATE TRIGGER trg_finance_ledger_entries_immutable
BEFORE UPDATE OR DELETE ON finance_ledger_entries
FOR EACH ROW EXECUTE FUNCTION preneura_reject_finance_evidence_mutation();

CREATE TRIGGER trg_finance_payment_allocations_immutable
BEFORE UPDATE OR DELETE ON finance_payment_allocations
FOR EACH ROW EXECUTE FUNCTION preneura_reject_finance_evidence_mutation();

CREATE OR REPLACE FUNCTION preneura_finance_payment_event_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_project_currency char(3);
  v_original finance_payment_events%ROWTYPE;
  v_already_compensated numeric(18,2);
BEGIN
  SELECT p.currency INTO v_project_currency
  FROM projects p
  WHERE p.id = NEW.project_id AND p.tenant_id = NEW.tenant_id;

  IF v_project_currency IS NULL OR v_project_currency <> NEW.currency THEN
    RAISE EXCEPTION 'finance event currency must match project currency';
  END IF;

  IF NEW.event_type IN ('PAYMENT_REVERSED','REFUND_ISSUED') THEN
    SELECT * INTO v_original
    FROM finance_payment_events
    WHERE id = NEW.related_event_id
    FOR SHARE;

    IF NOT FOUND OR v_original.event_type <> 'PAYMENT_RECEIVED' THEN
      RAISE EXCEPTION 'reversal/refund must reference an original payment receipt';
    END IF;
    IF v_original.transaction_id <> NEW.transaction_id
       OR v_original.tenant_id <> NEW.tenant_id
       OR v_original.project_id <> NEW.project_id
       OR v_original.currency <> NEW.currency THEN
      RAISE EXCEPTION 'compensating event scope/currency must match original payment';
    END IF;

    SELECT COALESCE(sum(e.amount), 0)::numeric(18,2)
    INTO v_already_compensated
    FROM finance_payment_events e
    WHERE e.related_event_id = v_original.id
      AND e.event_type IN ('PAYMENT_REVERSED','REFUND_ISSUED');

    IF v_already_compensated + NEW.amount > v_original.amount THEN
      RAISE EXCEPTION 'compensating events cannot exceed original payment amount';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_finance_payment_event_guard
BEFORE INSERT ON finance_payment_events
FOR EACH ROW EXECUTE FUNCTION preneura_finance_payment_event_guard();

CREATE OR REPLACE FUNCTION preneura_finance_allocation_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_event finance_payment_events%ROWTYPE;
  v_schedule_transaction uuid;
  v_schedule_currency char(3);
  v_item_amount numeric(18,2);
  v_current_paid numeric(18,2);
  v_original finance_payment_allocations%ROWTYPE;
  v_original_event_type text;
  v_reversed numeric(18,2);
BEGIN
  SELECT * INTO v_event FROM finance_payment_events WHERE id = NEW.payment_event_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'finance allocation event not found'; END IF;

  SELECT s.transaction_id, s.currency, i.amount,
         COALESCE((SELECT sum(a.amount) FROM finance_payment_allocations a WHERE a.payment_schedule_item_id = i.id), 0)
  INTO v_schedule_transaction, v_schedule_currency, v_item_amount, v_current_paid
  FROM payment_schedule_items i
  JOIN payment_schedules s ON s.id = i.payment_schedule_id
  WHERE i.id = NEW.payment_schedule_item_id
  FOR SHARE OF i, s;

  IF v_schedule_transaction IS NULL THEN RAISE EXCEPTION 'payment schedule item not found'; END IF;
  IF v_schedule_transaction <> v_event.transaction_id OR v_schedule_currency <> v_event.currency THEN
    RAISE EXCEPTION 'finance allocation must match event transaction and currency';
  END IF;

  IF v_event.event_type = 'PAYMENT_RECEIVED' THEN
    IF NEW.amount <= 0 OR NEW.original_allocation_id IS NOT NULL THEN
      RAISE EXCEPTION 'payment receipt allocations must be positive';
    END IF;
    IF v_current_paid + NEW.amount > v_item_amount THEN
      RAISE EXCEPTION 'payment allocation exceeds schedule item amount';
    END IF;
  ELSE
    IF NEW.amount >= 0 OR NEW.original_allocation_id IS NULL THEN
      RAISE EXCEPTION 'reversal/refund allocations must be negative and reference original allocation';
    END IF;

    SELECT * INTO v_original
    FROM finance_payment_allocations
    WHERE id = NEW.original_allocation_id;
    IF NOT FOUND OR v_original.amount <= 0 OR v_original.payment_schedule_item_id <> NEW.payment_schedule_item_id THEN
      RAISE EXCEPTION 'compensating allocation must reference the original positive allocation for the same item';
    END IF;

    SELECT event_type INTO v_original_event_type
    FROM finance_payment_events WHERE id = v_original.payment_event_id;
    IF v_original_event_type <> 'PAYMENT_RECEIVED' OR v_original.payment_event_id <> v_event.related_event_id THEN
      RAISE EXCEPTION 'compensating allocation must belong to the payment being reversed/refunded';
    END IF;

    SELECT COALESCE(sum(-a.amount), 0)::numeric(18,2)
    INTO v_reversed
    FROM finance_payment_allocations a
    JOIN finance_payment_events e ON e.id = a.payment_event_id
    WHERE a.original_allocation_id = v_original.id
      AND e.event_type IN ('PAYMENT_REVERSED','REFUND_ISSUED');

    IF v_reversed + (-NEW.amount) > v_original.amount THEN
      RAISE EXCEPTION 'compensating allocation exceeds original allocation amount';
    END IF;
    IF v_current_paid + NEW.amount < 0 THEN
      RAISE EXCEPTION 'payment item paid projection cannot become negative';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_finance_payment_allocation_guard
BEFORE INSERT ON finance_payment_allocations
FOR EACH ROW EXECUTE FUNCTION preneura_finance_allocation_guard();

CREATE OR REPLACE FUNCTION preneura_refresh_payment_item_projection(p_item_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_amount numeric(18,2);
  v_due_at timestamptz;
  v_paid numeric(18,2);
  v_status text;
  v_paid_at timestamptz;
  v_reference text;
  v_schedule_id uuid;
BEGIN
  SELECT amount, due_at, payment_schedule_id
  INTO v_amount, v_due_at, v_schedule_id
  FROM payment_schedule_items
  WHERE id = p_item_id
  FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;

  SELECT COALESCE(sum(a.amount), 0)::numeric(18,2),
         max(e.occurred_at) FILTER (WHERE a.amount > 0),
         (array_agg(e.external_reference ORDER BY e.occurred_at DESC, e.created_at DESC) FILTER (WHERE a.amount > 0))[1]
  INTO v_paid, v_paid_at, v_reference
  FROM finance_payment_allocations a
  JOIN finance_payment_events e ON e.id = a.payment_event_id
  WHERE a.payment_schedule_item_id = p_item_id;

  IF v_paid >= v_amount AND v_amount > 0 THEN
    v_status := 'PAID';
  ELSIF v_paid > 0 THEN
    v_status := 'PARTIALLY_PAID';
    v_paid_at := NULL;
  ELSIF v_due_at <= now() THEN
    v_status := 'DUE';
    v_paid_at := NULL;
    v_reference := NULL;
  ELSE
    v_status := 'UPCOMING';
    v_paid_at := NULL;
    v_reference := NULL;
  END IF;

  PERFORM set_config('preneura.finance_projection_update', '1', true);
  UPDATE payment_schedule_items
  SET paid_amount = v_paid,
      status = CASE WHEN status IN ('WAIVED','CANCELLED') THEN status ELSE v_status END,
      paid_at = CASE WHEN status IN ('WAIVED','CANCELLED') THEN paid_at ELSE v_paid_at END,
      payment_reference = CASE WHEN status IN ('WAIVED','CANCELLED') THEN payment_reference ELSE v_reference END,
      updated_at = now()
  WHERE id = p_item_id;

  UPDATE payment_schedules s
  SET status = CASE
        WHEN NOT EXISTS (
          SELECT 1 FROM payment_schedule_items i
          WHERE i.payment_schedule_id = s.id
            AND i.status NOT IN ('PAID','WAIVED','CANCELLED')
        ) THEN 'COMPLETED'
        ELSE 'ACTIVE'
      END,
      updated_at = now()
  WHERE s.id = v_schedule_id
    AND s.status <> 'CANCELLED';
END;
$$;

CREATE OR REPLACE FUNCTION preneura_refresh_payment_projection_after_allocation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM preneura_refresh_payment_item_projection(NEW.payment_schedule_item_id);
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_finance_allocation_refresh_projection
AFTER INSERT ON finance_payment_allocations
FOR EACH ROW EXECUTE FUNCTION preneura_refresh_payment_projection_after_allocation();

-- Direct PAID/PARTIALLY_PAID manufacture is forbidden outside the projection
-- function. WAIVE/CANCEL flows remain available to their existing admin path.
CREATE OR REPLACE FUNCTION preneura_payment_item_projection_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF (NEW.status IN ('PAID','PARTIALLY_PAID') OR NEW.paid_amount <> OLD.paid_amount)
     AND current_setting('preneura.finance_projection_update', true) IS DISTINCT FROM '1' THEN
    RAISE EXCEPTION 'payment paid state is a ledger projection and cannot be set directly';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_payment_schedule_items_projection_guard
BEFORE UPDATE ON payment_schedule_items
FOR EACH ROW EXECUTE FUNCTION preneura_payment_item_projection_guard();

CREATE OR REPLACE FUNCTION preneura_finance_event_balance_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_count integer;
  v_balance numeric(18,2);
BEGIN
  SELECT count(*)::int, COALESCE(sum(signed_amount),0)::numeric(18,2)
  INTO v_count, v_balance
  FROM finance_ledger_entries
  WHERE payment_event_id = NEW.id;

  IF v_count <> 2 OR v_balance <> 0 THEN
    RAISE EXCEPTION 'finance event must have exactly two balanced ledger entries';
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER trg_finance_payment_event_balanced
AFTER INSERT ON finance_payment_events
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION preneura_finance_event_balance_guard();

-- Central posting function used by manual/API/provider flows.
CREATE OR REPLACE FUNCTION preneura_post_finance_event(
  p_tenant_id uuid,
  p_project_id uuid,
  p_transaction_id uuid,
  p_event_type text,
  p_amount numeric,
  p_currency char(3),
  p_source text,
  p_external_reference text,
  p_actor_user_id uuid,
  p_occurred_at timestamptz,
  p_allocations jsonb DEFAULT '[]'::jsonb,
  p_provider text DEFAULT NULL,
  p_provider_event_id text DEFAULT NULL,
  p_related_event_id uuid DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb
) RETURNS uuid
LANGUAGE plpgsql
AS $$
DECLARE
  v_event_id uuid;
  v_entry jsonb;
  v_allocated numeric(18,2) := 0;
  v_sign numeric(18,2);
BEGIN
  INSERT INTO finance_payment_events (
    tenant_id, project_id, transaction_id, event_type, amount, currency,
    source, external_reference, provider, provider_event_id, related_event_id,
    actor_user_id, occurred_at, metadata
  ) VALUES (
    p_tenant_id, p_project_id, p_transaction_id, p_event_type, p_amount, p_currency,
    p_source, p_external_reference, p_provider, p_provider_event_id, p_related_event_id,
    p_actor_user_id, p_occurred_at, COALESCE(p_metadata, '{}'::jsonb)
  ) RETURNING id INTO v_event_id;

  v_sign := CASE WHEN p_event_type = 'PAYMENT_RECEIVED' THEN 1 ELSE -1 END;

  INSERT INTO finance_ledger_entries (
    payment_event_id, tenant_id, project_id, transaction_id, account, signed_amount, currency
  ) VALUES
    (v_event_id, p_tenant_id, p_project_id, p_transaction_id, 'CASH_CLEARING', v_sign * p_amount, p_currency),
    (v_event_id, p_tenant_id, p_project_id, p_transaction_id, 'BUYER_RECEIVABLE', -v_sign * p_amount, p_currency);

  FOR v_entry IN SELECT value FROM jsonb_array_elements(COALESCE(p_allocations, '[]'::jsonb))
  LOOP
    INSERT INTO finance_payment_allocations (
      payment_event_id, payment_schedule_item_id, amount, original_allocation_id
    ) VALUES (
      v_event_id,
      (v_entry->>'paymentItemId')::uuid,
      (v_entry->>'amount')::numeric,
      CASE WHEN v_entry ? 'originalAllocationId' THEN (v_entry->>'originalAllocationId')::uuid ELSE NULL END
    );
    v_allocated := v_allocated + abs((v_entry->>'amount')::numeric);
  END LOOP;

  IF v_allocated > p_amount THEN
    RAISE EXCEPTION 'finance allocations cannot exceed event amount';
  END IF;

  RETURN v_event_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- Provider inbox transitions are constrained and idempotent.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION preneura_provider_webhook_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'provider webhook evidence cannot be deleted';
  END IF;

  IF OLD.provider IS DISTINCT FROM NEW.provider
     OR OLD.provider_event_id IS DISTINCT FROM NEW.provider_event_id
     OR OLD.payload_sha256_hex IS DISTINCT FROM NEW.payload_sha256_hex
     OR OLD.tenant_id IS DISTINCT FROM NEW.tenant_id
     OR OLD.project_id IS DISTINCT FROM NEW.project_id
     OR OLD.transaction_id IS DISTINCT FROM NEW.transaction_id
     OR OLD.normalized_event_type IS DISTINCT FROM NEW.normalized_event_type
     OR OLD.amount IS DISTINCT FROM NEW.amount
     OR OLD.currency IS DISTINCT FROM NEW.currency
     OR OLD.external_reference IS DISTINCT FROM NEW.external_reference
     OR OLD.related_provider_event_id IS DISTINCT FROM NEW.related_provider_event_id
     OR OLD.occurred_at IS DISTINCT FROM NEW.occurred_at
     OR OLD.received_at IS DISTINCT FROM NEW.received_at THEN
    RAISE EXCEPTION 'provider webhook identity/content is immutable';
  END IF;

  IF OLD.status <> 'RECEIVED' OR NEW.status NOT IN ('PROCESSED','REJECTED') THEN
    RAISE EXCEPTION 'provider webhook can transition only once from RECEIVED';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_finance_provider_webhook_guard
BEFORE UPDATE OR DELETE ON finance_provider_webhook_events
FOR EACH ROW EXECUTE FUNCTION preneura_provider_webhook_guard();

-- ---------------------------------------------------------------------------
-- Append-only cheque history and replacement chain.
-- ---------------------------------------------------------------------------
ALTER TABLE transaction_cheques
  ADD COLUMN IF NOT EXISTS generation integer NOT NULL DEFAULT 1 CHECK (generation > 0),
  ADD COLUMN IF NOT EXISTS root_cheque_id uuid,
  ADD COLUMN IF NOT EXISTS replaces_cheque_id uuid REFERENCES transaction_cheques(id) ON DELETE RESTRICT;

UPDATE transaction_cheques SET root_cheque_id = id WHERE root_cheque_id IS NULL;
ALTER TABLE transaction_cheques ALTER COLUMN root_cheque_id SET NOT NULL;
ALTER TABLE transaction_cheques
  ADD CONSTRAINT transaction_cheques_root_fk
  FOREIGN KEY (root_cheque_id) REFERENCES transaction_cheques(id) ON DELETE RESTRICT;

ALTER TABLE transaction_cheques
  DROP CONSTRAINT IF EXISTS transaction_cheques_transaction_id_sequence_number_key;
CREATE UNIQUE INDEX IF NOT EXISTS transaction_cheques_sequence_generation_unique
  ON transaction_cheques(transaction_id, sequence_number, generation);
CREATE UNIQUE INDEX IF NOT EXISTS transaction_cheques_one_direct_replacement
  ON transaction_cheques(replaces_cheque_id)
  WHERE replaces_cheque_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS finance_cheque_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cheque_id uuid NOT NULL REFERENCES transaction_cheques(id) ON DELETE RESTRICT,
  event_type text NOT NULL CHECK (event_type IN ('EXPECTED','RECEIVED','DEPOSITED','CLEARED','RETURNED','CANCELLED','REPLACED')),
  cheque_number text,
  bank_name text,
  replacement_cheque_id uuid REFERENCES transaction_cheques(id) ON DELETE RESTRICT,
  actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  occurred_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  CHECK ((event_type = 'REPLACED') = (replacement_cheque_id IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS finance_cheque_events_cheque
  ON finance_cheque_events(cheque_id, occurred_at, created_at, id);

CREATE TRIGGER trg_finance_cheque_events_immutable
BEFORE UPDATE OR DELETE ON finance_cheque_events
FOR EACH ROW EXECUTE FUNCTION preneura_reject_finance_evidence_mutation();

-- Backfill one immutable historical state event for pre-existing cheques.
INSERT INTO finance_cheque_events (
  cheque_id, event_type, cheque_number, bank_name, actor_user_id, occurred_at,
  metadata
)
SELECT c.id, c.status, c.cheque_number, c.bank_name, c.verified_by,
       COALESCE(c.received_at, c.updated_at), jsonb_build_object('backfilled', true)
FROM transaction_cheques c
WHERE NOT EXISTS (SELECT 1 FROM finance_cheque_events e WHERE e.cheque_id = c.id);

CREATE OR REPLACE FUNCTION preneura_cheque_projection_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF current_setting('preneura.cheque_projection_update', true) IS DISTINCT FROM '1'
     AND (
       NEW.status IS DISTINCT FROM OLD.status
       OR NEW.cheque_number IS DISTINCT FROM OLD.cheque_number
       OR NEW.bank_name IS DISTINCT FROM OLD.bank_name
       OR NEW.received_at IS DISTINCT FROM OLD.received_at
     ) THEN
    RAISE EXCEPTION 'cheque state is an event projection and cannot be edited directly';
  END IF;

  IF NEW.sequence_number IS DISTINCT FROM OLD.sequence_number
     OR NEW.amount IS DISTINCT FROM OLD.amount
     OR NEW.due_at IS DISTINCT FROM OLD.due_at
     OR NEW.generation IS DISTINCT FROM OLD.generation
     OR NEW.root_cheque_id IS DISTINCT FROM OLD.root_cheque_id
     OR NEW.replaces_cheque_id IS DISTINCT FROM OLD.replaces_cheque_id
     OR NEW.transaction_id IS DISTINCT FROM OLD.transaction_id
     OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     OR NEW.project_id IS DISTINCT FROM OLD.project_id THEN
    RAISE EXCEPTION 'cheque identity/commercial terms are immutable; create a replacement cheque';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_transaction_cheques_projection_guard
BEFORE UPDATE ON transaction_cheques
FOR EACH ROW EXECUTE FUNCTION preneura_cheque_projection_guard();

CREATE OR REPLACE FUNCTION preneura_record_cheque_event(
  p_cheque_id uuid,
  p_event_type text,
  p_actor_user_id uuid,
  p_occurred_at timestamptz,
  p_cheque_number text DEFAULT NULL,
  p_bank_name text DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb
) RETURNS uuid
LANGUAGE plpgsql
AS $$
DECLARE
  v_cheque transaction_cheques%ROWTYPE;
  v_event_id uuid;
  v_allowed boolean := false;
  v_received_at timestamptz;
BEGIN
  SELECT * INTO v_cheque FROM transaction_cheques WHERE id = p_cheque_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'cheque not found'; END IF;

  v_allowed := CASE v_cheque.status
    WHEN 'EXPECTED' THEN p_event_type IN ('RECEIVED','CANCELLED')
    WHEN 'RECEIVED' THEN p_event_type IN ('DEPOSITED','RETURNED','CANCELLED')
    WHEN 'DEPOSITED' THEN p_event_type IN ('CLEARED','RETURNED')
    WHEN 'RETURNED' THEN false
    ELSE false
  END;
  IF NOT v_allowed THEN
    RAISE EXCEPTION 'cheque status cannot transition from % to %', v_cheque.status, p_event_type;
  END IF;

  INSERT INTO finance_cheque_events (
    cheque_id, event_type, cheque_number, bank_name, actor_user_id, occurred_at, metadata
  ) VALUES (
    p_cheque_id, p_event_type, COALESCE(p_cheque_number, v_cheque.cheque_number),
    COALESCE(p_bank_name, v_cheque.bank_name), p_actor_user_id, p_occurred_at,
    COALESCE(p_metadata, '{}'::jsonb)
  ) RETURNING id INTO v_event_id;

  v_received_at := CASE
    WHEN p_event_type = 'RECEIVED' THEN p_occurred_at
    ELSE v_cheque.received_at
  END;

  PERFORM set_config('preneura.cheque_projection_update', '1', true);
  UPDATE transaction_cheques
  SET status = p_event_type,
      cheque_number = COALESCE(p_cheque_number, cheque_number),
      bank_name = COALESCE(p_bank_name, bank_name),
      received_at = v_received_at,
      verified_by = p_actor_user_id,
      updated_at = p_occurred_at
  WHERE id = p_cheque_id;

  RETURN v_event_id;
END;
$$;

CREATE OR REPLACE FUNCTION preneura_replace_returned_cheque(
  p_cheque_id uuid,
  p_actor_user_id uuid,
  p_amount numeric,
  p_due_at timestamptz,
  p_cheque_number text DEFAULT NULL,
  p_bank_name text DEFAULT NULL,
  p_occurred_at timestamptz DEFAULT now()
) RETURNS uuid
LANGUAGE plpgsql
AS $$
DECLARE
  v_old transaction_cheques%ROWTYPE;
  v_new_id uuid;
BEGIN
  SELECT * INTO v_old FROM transaction_cheques WHERE id = p_cheque_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'cheque not found'; END IF;
  IF v_old.status <> 'RETURNED' THEN
    RAISE EXCEPTION 'only a returned cheque can be replaced';
  END IF;

  INSERT INTO transaction_cheques (
    tenant_id, project_id, transaction_id, sequence_number, amount, due_at,
    cheque_number, bank_name, status, received_at, verified_by, updated_at,
    generation, root_cheque_id, replaces_cheque_id
  ) VALUES (
    v_old.tenant_id, v_old.project_id, v_old.transaction_id, v_old.sequence_number,
    p_amount, p_due_at, p_cheque_number, p_bank_name, 'EXPECTED', NULL,
    p_actor_user_id, p_occurred_at, v_old.generation + 1, v_old.root_cheque_id, v_old.id
  ) RETURNING id INTO v_new_id;

  INSERT INTO finance_cheque_events (
    cheque_id, event_type, cheque_number, bank_name, replacement_cheque_id,
    actor_user_id, occurred_at, metadata
  ) VALUES (
    v_old.id, 'REPLACED', p_cheque_number, p_bank_name, v_new_id,
    p_actor_user_id, p_occurred_at, '{}'::jsonb
  );

  INSERT INTO finance_cheque_events (
    cheque_id, event_type, cheque_number, bank_name, actor_user_id, occurred_at, metadata
  ) VALUES (
    v_new_id, 'EXPECTED', p_cheque_number, p_bank_name, p_actor_user_id,
    p_occurred_at, jsonb_build_object('replacesChequeId', v_old.id)
  );

  RETURN v_new_id;
END;
$$;

-- New cheque rows are immutable commercial instruments. Ensure root defaults to self
-- through an AFTER INSERT correction allowed only for this initialization.
CREATE OR REPLACE FUNCTION preneura_initialize_cheque_root()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.root_cheque_id IS NULL THEN
    PERFORM set_config('preneura.cheque_projection_update', '1', true);
    UPDATE transaction_cheques SET root_cheque_id = NEW.id WHERE id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

-- root_cheque_id is NOT NULL after backfill, so ordinary inserts must provide a
-- root explicitly. Application repository uses the inserted id via a two-step
-- transaction for root instruments; replacements are created by the DB function.

COMMIT;
