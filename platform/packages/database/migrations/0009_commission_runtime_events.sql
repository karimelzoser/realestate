BEGIN;

CREATE OR REPLACE FUNCTION refresh_broker_commission_case(p_transaction_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_completion numeric(5,2);
  v_prerequisites_complete boolean;
  v_now timestamptz := now();
  v_case_id uuid;
  v_tenant_id uuid;
  v_project_id uuid;
  v_old_status text;
  v_new_status text;
  v_old_completion numeric(5,2);
  v_old_eligible_at timestamptz;
  v_old_due_at timestamptz;
  v_new_eligible_at timestamptz;
  v_new_due_at timestamptz;
  v_due_days integer;
  v_transaction_status text;
BEGIN
  SELECT COALESCE(sum(
    CASE WHEN status IN ('COMPLETED','WAIVED') THEN weight_percent ELSE 0 END
  ), 0)
  INTO v_completion
  FROM transaction_milestones
  WHERE transaction_id = p_transaction_id;

  SELECT count(*) = 4
  INTO v_prerequisites_complete
  FROM transaction_milestones
  WHERE transaction_id = p_transaction_id
    AND code IN (
      'DOWN_PAYMENT_RECEIVED',
      'CHEQUES_RECEIVED',
      'CONTRACT_SIGNED',
      'CONTRACT_STAMPED'
    )
    AND status = 'COMPLETED';

  SELECT
    c.id,
    c.tenant_id,
    c.project_id,
    c.status,
    c.completion_percent_snapshot,
    c.eligible_at,
    c.due_at,
    p.due_days_after_eligibility,
    t.status
  INTO
    v_case_id,
    v_tenant_id,
    v_project_id,
    v_old_status,
    v_old_completion,
    v_old_eligible_at,
    v_old_due_at,
    v_due_days,
    v_transaction_status
  FROM broker_commission_cases c
  JOIN broker_commission_plans p ON p.id = c.commission_plan_id
  JOIN transactions t ON t.id = c.transaction_id
  WHERE c.transaction_id = p_transaction_id
  FOR UPDATE OF c;

  IF v_case_id IS NULL THEN
    RETURN;
  END IF;

  v_new_status := v_old_status;
  v_new_eligible_at := v_old_eligible_at;
  v_new_due_at := v_old_due_at;

  IF v_transaction_status = 'CANCELLED' THEN
    v_new_status := 'CANCELLED';
  ELSIF v_prerequisites_complete THEN
    IF v_old_status = 'PENDING_PREREQUISITES' THEN
      v_new_status := 'ELIGIBLE';
      v_new_eligible_at := v_now;
      v_new_due_at := v_now + make_interval(days => v_due_days);
    END IF;
    IF v_new_due_at IS NOT NULL
       AND v_new_due_at <= v_now
       AND v_new_status IN ('ELIGIBLE','INVOICED') THEN
      v_new_status := 'DUE';
    END IF;
  ELSE
    IF v_old_status = 'ELIGIBLE' THEN
      v_new_status := 'PENDING_PREREQUISITES';
      v_new_eligible_at := NULL;
      v_new_due_at := NULL;
    ELSIF v_old_status IN ('INVOICED','DUE') THEN
      v_new_status := 'DISPUTED';
    END IF;
  END IF;

  UPDATE broker_commission_cases
  SET
    completion_percent_snapshot = v_completion,
    status = v_new_status,
    eligible_at = v_new_eligible_at,
    due_at = v_new_due_at,
    updated_at = v_now
  WHERE id = v_case_id;

  IF v_old_status IS DISTINCT FROM v_new_status
     OR v_old_completion IS DISTINCT FROM v_completion
     OR v_old_eligible_at IS DISTINCT FROM v_new_eligible_at
     OR v_old_due_at IS DISTINCT FROM v_new_due_at THEN
    INSERT INTO domain_outbox_events (
      tenant_id,
      project_id,
      aggregate_type,
      aggregate_id,
      event_type,
      payload,
      published_at,
      attempts
    ) VALUES (
      v_tenant_id,
      v_project_id,
      'BROKER_COMMISSION_CASE',
      v_case_id,
      'commission.case.refreshed',
      jsonb_build_object(
        'transactionId', p_transaction_id,
        'status', v_new_status,
        'completionPercent', v_completion,
        'eligibleAt', v_new_eligible_at,
        'dueAt', v_new_due_at
      ),
      NULL,
      0
    );
  END IF;
END;
$$;

COMMIT;
