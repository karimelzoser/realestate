BEGIN;

-- Partial reversals/refunds must unwind the original receipt deterministically.
-- Follow the same commercial order as receipt allocation: oldest schedule item
-- first, then original allocation creation order as a stable tie-breaker.
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
           i.sequence_number,
           COALESCE((
             SELECT sum(-child.amount)
             FROM finance_payment_allocations child
             JOIN finance_payment_events ce ON ce.id = child.payment_event_id
             WHERE child.original_allocation_id = a.id
               AND ce.event_type IN ('PAYMENT_REVERSED','REFUND_ISSUED')
           ), 0)::numeric(18,2) AS compensated
    FROM finance_payment_allocations a
    JOIN payment_schedule_items i ON i.id = a.payment_schedule_item_id
    WHERE a.payment_event_id = p_original_event_id
      AND a.amount > 0
    ORDER BY i.sequence_number ASC, a.created_at ASC, a.id ASC
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

  -- Remaining compensation may represent cash from the original receipt that
  -- was never allocated (for example an overpayment). The balanced ledger still
  -- reverses/refunds the full event amount without inventing item allocations.
  RETURN v_result;
END;
$$;

COMMIT;
