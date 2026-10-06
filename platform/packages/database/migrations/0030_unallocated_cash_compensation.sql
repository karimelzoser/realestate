BEGIN;

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

  -- Any remaining amount represents original cash that was never allocated to
  -- a schedule item (for example an overpayment). It is still reversed/refunded
  -- in the balanced ledger, but correctly has no negative item allocation.
  RETURN v_result;
END;
$$;

COMMIT;
