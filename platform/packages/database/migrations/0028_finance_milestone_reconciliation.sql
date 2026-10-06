BEGIN;

CREATE OR REPLACE FUNCTION preneura_sync_finance_milestones(p_transaction_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_down_count integer;
  v_down_incomplete integer;
  v_cheque_count integer;
  v_cheque_incomplete integer;
BEGIN
  SELECT count(*)::int,
         count(*) FILTER (WHERE i.status NOT IN ('PAID','WAIVED','CANCELLED'))::int
  INTO v_down_count, v_down_incomplete
  FROM payment_schedule_items i
  JOIN payment_schedules s ON s.id = i.payment_schedule_id
  WHERE s.transaction_id = p_transaction_id
    AND i.item_type = 'DOWN_PAYMENT';

  IF v_down_count > 0 AND v_down_incomplete = 0 THEN
    UPDATE transaction_milestones
    SET status = 'COMPLETED', completed_at = COALESCE(completed_at, now()),
        updated_at = now()
    WHERE transaction_id = p_transaction_id
      AND code = 'DOWN_PAYMENT_RECEIVED'
      AND status IN ('PENDING','BLOCKED');
  ELSE
    UPDATE transaction_milestones
    SET status = 'PENDING', completed_at = NULL, completed_by = NULL,
        evidence_document_id = NULL, updated_at = now()
    WHERE transaction_id = p_transaction_id
      AND code = 'DOWN_PAYMENT_RECEIVED'
      AND status = 'COMPLETED';
  END IF;

  -- Only current leaf instruments count. A returned/cancelled historical cheque
  -- remains immutable evidence but no longer competes with its replacement.
  SELECT count(*)::int,
         count(*) FILTER (WHERE c.status NOT IN ('RECEIVED','DEPOSITED','CLEARED'))::int
  INTO v_cheque_count, v_cheque_incomplete
  FROM transaction_cheques c
  WHERE c.transaction_id = p_transaction_id
    AND NOT EXISTS (
      SELECT 1 FROM transaction_cheques child
      WHERE child.replaces_cheque_id = c.id
    );

  IF v_cheque_count > 0 AND v_cheque_incomplete = 0 THEN
    UPDATE transaction_milestones
    SET status = 'COMPLETED', completed_at = COALESCE(completed_at, now()),
        updated_at = now()
    WHERE transaction_id = p_transaction_id
      AND code = 'CHEQUES_RECEIVED'
      AND status IN ('PENDING','BLOCKED');
  ELSE
    UPDATE transaction_milestones
    SET status = 'PENDING', completed_at = NULL, completed_by = NULL,
        evidence_document_id = NULL, updated_at = now()
    WHERE transaction_id = p_transaction_id
      AND code = 'CHEQUES_RECEIVED'
      AND status = 'COMPLETED';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION preneura_sync_finance_milestones_after_allocation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_transaction_id uuid;
BEGIN
  SELECT s.transaction_id INTO v_transaction_id
  FROM payment_schedule_items i
  JOIN payment_schedules s ON s.id = i.payment_schedule_id
  WHERE i.id = NEW.payment_schedule_item_id;

  IF v_transaction_id IS NOT NULL THEN
    PERFORM preneura_sync_finance_milestones(v_transaction_id);
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_finance_allocation_sync_milestones
AFTER INSERT ON finance_payment_allocations
FOR EACH ROW EXECUTE FUNCTION preneura_sync_finance_milestones_after_allocation();

CREATE OR REPLACE FUNCTION preneura_sync_finance_milestones_after_cheque()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM preneura_sync_finance_milestones(NEW.transaction_id);
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_transaction_cheques_sync_milestones_insert
AFTER INSERT ON transaction_cheques
FOR EACH ROW EXECUTE FUNCTION preneura_sync_finance_milestones_after_cheque();

CREATE TRIGGER trg_transaction_cheques_sync_milestones_update
AFTER UPDATE OF status ON transaction_cheques
FOR EACH ROW
WHEN (OLD.status IS DISTINCT FROM NEW.status)
EXECUTE FUNCTION preneura_sync_finance_milestones_after_cheque();

-- Every immutable finance event gets one transaction event/outbox record at the
-- same database boundary, regardless of whether it came from staff or provider.
CREATE OR REPLACE FUNCTION preneura_publish_finance_payment_event()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO transaction_events (
    transaction_id, actor_user_id, event_type, metadata
  ) VALUES (
    NEW.transaction_id,
    NEW.actor_user_id,
    CASE NEW.event_type
      WHEN 'PAYMENT_RECEIVED' THEN 'finance.payment.received'
      WHEN 'PAYMENT_REVERSED' THEN 'finance.payment.reversed'
      ELSE 'finance.payment.refunded'
    END,
    jsonb_build_object(
      'paymentEventId', NEW.id,
      'amount', NEW.amount,
      'currency', NEW.currency,
      'source', NEW.source,
      'externalReference', NEW.external_reference,
      'provider', NEW.provider,
      'providerEventId', NEW.provider_event_id,
      'relatedEventId', NEW.related_event_id
    )
  );

  INSERT INTO domain_outbox_events (
    tenant_id, project_id, aggregate_type, aggregate_id,
    event_type, payload, published_at, attempts
  ) VALUES (
    NEW.tenant_id,
    NEW.project_id,
    'FINANCE_PAYMENT_EVENT',
    NEW.id,
    CASE NEW.event_type
      WHEN 'PAYMENT_RECEIVED' THEN 'finance.payment.received'
      WHEN 'PAYMENT_REVERSED' THEN 'finance.payment.reversed'
      ELSE 'finance.payment.refunded'
    END,
    jsonb_build_object(
      'transactionId', NEW.transaction_id,
      'amount', NEW.amount,
      'currency', NEW.currency,
      'source', NEW.source
    ),
    NULL,
    0
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_finance_payment_event_publish
AFTER INSERT ON finance_payment_events
FOR EACH ROW EXECUTE FUNCTION preneura_publish_finance_payment_event();

CREATE OR REPLACE FUNCTION preneura_publish_cheque_event()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_cheque transaction_cheques%ROWTYPE;
BEGIN
  SELECT * INTO v_cheque FROM transaction_cheques WHERE id = NEW.cheque_id;
  IF NOT FOUND THEN RETURN NEW; END IF;

  INSERT INTO transaction_events (
    transaction_id, actor_user_id, event_type, metadata
  ) VALUES (
    v_cheque.transaction_id,
    NEW.actor_user_id,
    'finance.cheque.event',
    jsonb_build_object(
      'chequeEventId', NEW.id,
      'chequeId', NEW.cheque_id,
      'eventType', NEW.event_type,
      'replacementChequeId', NEW.replacement_cheque_id,
      'generation', v_cheque.generation
    )
  );

  INSERT INTO domain_outbox_events (
    tenant_id, project_id, aggregate_type, aggregate_id,
    event_type, payload, published_at, attempts
  ) VALUES (
    v_cheque.tenant_id,
    v_cheque.project_id,
    'CHEQUE',
    NEW.cheque_id,
    'finance.cheque.event',
    jsonb_build_object(
      'transactionId', v_cheque.transaction_id,
      'eventType', NEW.event_type,
      'replacementChequeId', NEW.replacement_cheque_id,
      'generation', v_cheque.generation
    ),
    NULL,
    0
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_finance_cheque_event_publish
AFTER INSERT ON finance_cheque_events
FOR EACH ROW EXECUTE FUNCTION preneura_publish_cheque_event();

-- Update legacy evidence validation so replacement history does not count as a
-- current outstanding cheque after a successor exists.
CREATE OR REPLACE FUNCTION enforce_transaction_milestone_evidence()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  tx_tenant_id uuid;
  tx_project_id uuid;
  requirement_count integer;
  missing_requirement_count integer;
  evidence_count integer;
  incomplete_count integer;
BEGIN
  IF NEW.status <> 'COMPLETED' OR OLD.status = 'COMPLETED' THEN
    RETURN NEW;
  END IF;

  SELECT t.tenant_id, t.project_id
  INTO tx_tenant_id, tx_project_id
  FROM transactions t
  WHERE t.id = NEW.transaction_id;

  IF tx_tenant_id IS NULL OR tx_project_id IS NULL THEN
    RAISE EXCEPTION 'Transaction % does not exist for milestone evidence validation', NEW.transaction_id;
  END IF;

  CASE NEW.code
    WHEN 'BUYER_DOCUMENTS_COMPLETE' THEN
      SELECT count(*)::int INTO requirement_count
      FROM project_document_requirements r
      WHERE r.tenant_id = tx_tenant_id
        AND r.project_id = tx_project_id
        AND r.required_for_completion = true;

      IF requirement_count = 0 THEN
        RAISE EXCEPTION 'BUYER_DOCUMENTS_COMPLETE requires at least one configured completion document requirement';
      END IF;

      SELECT count(*)::int INTO missing_requirement_count
      FROM project_document_requirements r
      WHERE r.tenant_id = tx_tenant_id
        AND r.project_id = tx_project_id
        AND r.required_for_completion = true
        AND (
          SELECT count(*) FROM transaction_documents d
          WHERE d.transaction_id = NEW.transaction_id
            AND d.category = r.category
            AND d.status IN ('VERIFIED','SIGNED','STAMPED')
        ) < r.required_count;

      IF missing_requirement_count <> 0 THEN
        RAISE EXCEPTION 'BUYER_DOCUMENTS_COMPLETE requires all configured transaction documents to be verified';
      END IF;

    WHEN 'DOWN_PAYMENT_RECEIVED' THEN
      SELECT count(*)::int,
             count(*) FILTER (WHERE item.status NOT IN ('PAID','WAIVED','CANCELLED'))::int
      INTO evidence_count, incomplete_count
      FROM payment_schedule_items item
      JOIN payment_schedules schedule ON schedule.id = item.payment_schedule_id
      WHERE schedule.transaction_id = NEW.transaction_id
        AND item.item_type = 'DOWN_PAYMENT';

      IF evidence_count = 0 OR incomplete_count <> 0 THEN
        RAISE EXCEPTION 'DOWN_PAYMENT_RECEIVED requires all down-payment items to be paid, waived or cancelled';
      END IF;

    WHEN 'CHEQUES_RECEIVED' THEN
      SELECT count(*)::int,
             count(*) FILTER (WHERE c.status NOT IN ('RECEIVED','DEPOSITED','CLEARED'))::int
      INTO evidence_count, incomplete_count
      FROM transaction_cheques c
      WHERE c.transaction_id = NEW.transaction_id
        AND NOT EXISTS (
          SELECT 1 FROM transaction_cheques child
          WHERE child.replaces_cheque_id = c.id
        );

      IF evidence_count = 0 OR incomplete_count <> 0 THEN
        RAISE EXCEPTION 'CHEQUES_RECEIVED requires all current cheques to be received, deposited or cleared';
      END IF;

    WHEN 'CONTRACT_GENERATED' THEN
      SELECT count(*)::int INTO evidence_count
      FROM transaction_documents d
      WHERE d.transaction_id = NEW.transaction_id
        AND d.category = 'CONTRACT'
        AND d.status IN ('VERIFIED','SIGNED','STAMPED');
      IF evidence_count = 0 THEN RAISE EXCEPTION 'CONTRACT_GENERATED requires a verified contract'; END IF;

    WHEN 'CONTRACT_SIGNED' THEN
      SELECT count(*)::int INTO evidence_count
      FROM transaction_documents d
      WHERE d.transaction_id = NEW.transaction_id
        AND d.category = 'CONTRACT'
        AND d.status IN ('SIGNED','STAMPED');
      IF evidence_count = 0 THEN RAISE EXCEPTION 'CONTRACT_SIGNED requires a fully signed contract'; END IF;

    WHEN 'CONTRACT_STAMPED' THEN
      SELECT count(*)::int INTO evidence_count
      FROM transaction_documents d
      WHERE d.transaction_id = NEW.transaction_id
        AND d.category = 'CONTRACT'
        AND d.status = 'STAMPED';
      IF evidence_count = 0 THEN RAISE EXCEPTION 'CONTRACT_STAMPED requires a stamped contract'; END IF;

    ELSE
      RAISE EXCEPTION 'Unsupported transaction milestone code %', NEW.code;
  END CASE;

  RETURN NEW;
END;
$$;

COMMIT;
