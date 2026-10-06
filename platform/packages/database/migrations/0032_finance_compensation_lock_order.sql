BEGIN;

-- Lock eligible original allocations in commercial schedule order before
-- calculating remaining compensation. This keeps partial compensation
-- deterministic while preserving the concurrency protection introduced in 0029.
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
    SELECT a.id,
           a.payment_schedule_item_id,
           a.amount,
           i.sequence_number
    FROM finance_payment_allocations a
    JOIN payment_schedule_items i ON i.id = a.payment_schedule_item_id
    WHERE a.payment_event_id = p_original_event_id
      AND a.amount > 0
    ORDER BY i.sequence_number ASC, a.created_at ASC, a.id ASC
    FOR UPDATE OF a
  LOOP
    EXIT WHEN v_remaining <= 0;

    SELECT v_row.amount - COALESCE(sum(-child.amount), 0)::numeric(18,2)
    INTO v_available
    FROM finance_payment_allocations child
    JOIN finance_payment_events ce ON ce.id = child.payment_event_id
    WHERE child.original_allocation_id = v_row.id
      AND ce.event_type IN ('PAYMENT_REVERSED','REFUND_ISSUED');

    -- SUM over no child rows is NULL; preserve the full original allocation.
    v_available := COALESCE(v_available, v_row.amount);
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

  RETURN v_result;
END;
$$;

COMMIT;
