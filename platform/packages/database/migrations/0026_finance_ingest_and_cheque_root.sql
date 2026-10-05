BEGIN;

CREATE OR REPLACE FUNCTION preneura_initialize_cheque_root_before_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.root_cheque_id IS NULL THEN
    NEW.root_cheque_id := NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_transaction_cheques_00_initialize_root
BEFORE INSERT ON transaction_cheques
FOR EACH ROW EXECUTE FUNCTION preneura_initialize_cheque_root_before_insert();

-- Build FIFO positive allocations for a payment receipt. Overpayment is allowed
-- to remain unallocated in the ledger rather than corrupting schedule items.
CREATE OR REPLACE FUNCTION preneura_fifo_payment_allocations(
  p_transaction_id uuid,
  p_amount numeric
) RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_remaining numeric(18,2) := p_amount;
  v_row record;
  v_take numeric(18,2);
  v_result jsonb := '[]'::jsonb;
BEGIN
  FOR v_row IN
    SELECT i.id,
           i.amount,
           COALESCE(sum(a.amount), 0)::numeric(18,2) AS paid
    FROM payment_schedule_items i
    JOIN payment_schedules s ON s.id = i.payment_schedule_id
    LEFT JOIN finance_payment_allocations a ON a.payment_schedule_item_id = i.id
    WHERE s.transaction_id = p_transaction_id
      AND i.status NOT IN ('WAIVED','CANCELLED')
    GROUP BY i.id, i.amount, i.sequence_number
    HAVING i.amount - COALESCE(sum(a.amount), 0) > 0
    ORDER BY i.sequence_number ASC
  LOOP
    EXIT WHEN v_remaining <= 0;
    v_take := LEAST(v_remaining, v_row.amount - v_row.paid);
    IF v_take > 0 THEN
      v_result := v_result || jsonb_build_array(jsonb_build_object(
        'paymentItemId', v_row.id,
        'amount', v_take
      ));
      v_remaining := v_remaining - v_take;
    END IF;
  END LOOP;
  RETURN v_result;
END;
$$;

-- Build compensating allocations against the original payment's positive
-- allocations, preserving an exact audit link to each original allocation.
CREATE OR REPLACE FUNCTION preneura_compensating_allocations(
  p_original_event_id uuid,
  p_amount numeric
) RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_remaining numeric(18,2) := p_amount;
  v_row record;
  v_available numeric(18,2);
  v_take numeric(18,2);
  v_result jsonb := '[]'::jsonb;
BEGIN
  FOR v_row IN
    SELECT a.id, a.payment_schedule_item_id, a.amount,
           COALESCE((
             SELECT sum(-child.amount)
             FROM finance_payment_allocations child
             JOIN finance_payment_events ce ON ce.id = child.payment_event_id
             WHERE child.original_allocation_id = a.id
               AND ce.event_type IN ('PAYMENT_REVERSED','REFUND_ISSUED')
           ), 0)::numeric(18,2) AS compensated
    FROM finance_payment_allocations a
    WHERE a.payment_event_id = p_original_event_id
      AND a.amount > 0
    ORDER BY a.created_at ASC, a.id ASC
  LOOP
    EXIT WHEN v_remaining <= 0;
    v_available := v_row.amount - v_row.compensated;
    v_take := LEAST(v_remaining, v_available);
    IF v_take > 0 THEN
      v_result := v_result || jsonb_build_array(jsonb_build_object(
        'paymentItemId', v_row.payment_schedule_item_id,
        'amount', -v_take,
        'originalAllocationId', v_row.id
      ));
      v_remaining := v_remaining - v_take;
    END IF;
  END LOOP;

  IF v_remaining > 0 THEN
    RAISE EXCEPTION 'requested compensation exceeds allocated original payment amount';
  END IF;
  RETURN v_result;
END;
$$;

-- Idempotent normalized provider ingress. Re-delivery with the same provider
-- event ID and the same payload hash returns the original result. Re-use of the
-- ID with different content is rejected as an integrity violation.
CREATE OR REPLACE FUNCTION preneura_ingest_provider_finance_event(
  p_provider text,
  p_provider_event_id text,
  p_payload_sha256_hex text,
  p_tenant_id uuid,
  p_project_id uuid,
  p_transaction_id uuid,
  p_event_type text,
  p_amount numeric,
  p_currency char(3),
  p_external_reference text,
  p_occurred_at timestamptz,
  p_related_provider_event_id text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
AS $$
DECLARE
  v_inbox finance_provider_webhook_events%ROWTYPE;
  v_original_event_id uuid;
  v_allocations jsonb;
  v_event_id uuid;
BEGIN
  INSERT INTO finance_provider_webhook_events (
    provider, provider_event_id, payload_sha256_hex,
    tenant_id, project_id, transaction_id, normalized_event_type,
    amount, currency, external_reference, related_provider_event_id,
    occurred_at, status
  ) VALUES (
    p_provider, p_provider_event_id, lower(p_payload_sha256_hex),
    p_tenant_id, p_project_id, p_transaction_id, p_event_type,
    p_amount, p_currency, p_external_reference, p_related_provider_event_id,
    p_occurred_at, 'RECEIVED'
  )
  ON CONFLICT (provider, provider_event_id) DO NOTHING;

  SELECT * INTO v_inbox
  FROM finance_provider_webhook_events
  WHERE provider = p_provider AND provider_event_id = p_provider_event_id
  FOR UPDATE;

  IF v_inbox.payload_sha256_hex <> lower(p_payload_sha256_hex)
     OR v_inbox.tenant_id <> p_tenant_id
     OR v_inbox.project_id <> p_project_id
     OR v_inbox.transaction_id <> p_transaction_id
     OR v_inbox.normalized_event_type <> p_event_type
     OR v_inbox.amount <> p_amount
     OR v_inbox.currency <> p_currency
     OR v_inbox.external_reference <> p_external_reference
     OR v_inbox.related_provider_event_id IS DISTINCT FROM p_related_provider_event_id
     OR v_inbox.occurred_at <> p_occurred_at THEN
    RAISE EXCEPTION 'provider event ID was re-used with different normalized content';
  END IF;

  IF v_inbox.status = 'PROCESSED' THEN
    RETURN v_inbox.payment_event_id;
  END IF;
  IF v_inbox.status = 'REJECTED' THEN
    RAISE EXCEPTION 'provider event was previously rejected: %', v_inbox.rejection_code;
  END IF;

  IF p_event_type = 'PAYMENT_RECEIVED' THEN
    v_allocations := preneura_fifo_payment_allocations(p_transaction_id, p_amount);
    v_original_event_id := NULL;
  ELSE
    IF p_related_provider_event_id IS NULL THEN
      RAISE EXCEPTION 'provider reversal/refund requires related provider event ID';
    END IF;
    SELECT e.id INTO v_original_event_id
    FROM finance_payment_events e
    WHERE e.provider = p_provider
      AND e.provider_event_id = p_related_provider_event_id
      AND e.event_type = 'PAYMENT_RECEIVED';
    IF v_original_event_id IS NULL THEN
      RAISE EXCEPTION 'related provider payment receipt not found';
    END IF;
    v_allocations := preneura_compensating_allocations(v_original_event_id, p_amount);
  END IF;

  v_event_id := preneura_post_finance_event(
    p_tenant_id,
    p_project_id,
    p_transaction_id,
    p_event_type,
    p_amount,
    p_currency,
    'PROVIDER',
    p_external_reference,
    NULL,
    p_occurred_at,
    v_allocations,
    p_provider,
    p_provider_event_id,
    v_original_event_id,
    jsonb_build_object('providerInboxId', v_inbox.id)
  );

  UPDATE finance_provider_webhook_events
  SET status = 'PROCESSED', payment_event_id = v_event_id,
      processed_at = now(), rejection_code = NULL
  WHERE id = v_inbox.id;

  RETURN v_event_id;
EXCEPTION WHEN OTHERS THEN
  -- Preserve the unique inbox evidence when the row exists. The surrounding
  -- transaction may still roll back on an integrity failure; callers receive
  -- the deterministic error and may retry after correcting dependencies.
  RAISE;
END;
$$;

COMMIT;
