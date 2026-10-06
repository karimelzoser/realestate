BEGIN;

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
    FOR UPDATE;

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

  SELECT s.transaction_id, s.currency, i.amount
  INTO v_schedule_transaction, v_schedule_currency, v_item_amount
  FROM payment_schedule_items i
  JOIN payment_schedules s ON s.id = i.payment_schedule_id
  WHERE i.id = NEW.payment_schedule_item_id
  FOR UPDATE OF i;

  IF v_schedule_transaction IS NULL THEN RAISE EXCEPTION 'payment schedule item not found'; END IF;

  SELECT COALESCE(sum(a.amount), 0)::numeric(18,2)
  INTO v_current_paid
  FROM finance_payment_allocations a
  WHERE a.payment_schedule_item_id = NEW.payment_schedule_item_id;

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
    WHERE id = NEW.original_allocation_id
    FOR UPDATE;

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

COMMIT;
