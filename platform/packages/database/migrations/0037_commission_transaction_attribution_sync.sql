BEGIN;

CREATE OR REPLACE FUNCTION ensure_broker_commission_case(p_transaction_id uuid)
RETURNS uuid
LANGUAGE plpgsql
AS $$
DECLARE
  v_transaction transactions%ROWTYPE;
  v_basis_amount numeric(18,2);
  v_plan_id uuid;
  v_rate_percent numeric(7,4);
  v_case_id uuid;
BEGIN
  SELECT * INTO v_transaction
  FROM transactions
  WHERE id = p_transaction_id;

  IF NOT FOUND
     OR v_transaction.buyer_source <> 'BROKER'
     OR v_transaction.broker_company_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT quoted_total
  INTO v_basis_amount
  FROM reservations
  WHERE id = v_transaction.reservation_id
    AND tenant_id = v_transaction.tenant_id
    AND project_id = v_transaction.project_id;

  IF v_basis_amount IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT id, rate_percent
  INTO v_plan_id, v_rate_percent
  FROM broker_commission_plans
  WHERE tenant_id = v_transaction.tenant_id
    AND project_id = v_transaction.project_id
    AND broker_company_id = v_transaction.broker_company_id
    AND status = 'ACTIVE'
    AND effective_at <= v_transaction.opened_at
  ORDER BY effective_at DESC, version_number DESC
  LIMIT 1;

  IF v_plan_id IS NULL THEN
    RETURN NULL;
  END IF;

  INSERT INTO broker_commission_cases (
    tenant_id,
    project_id,
    transaction_id,
    broker_company_id,
    broker_agent_user_id,
    commission_plan_id,
    basis_amount,
    rate_percent,
    commission_amount,
    status,
    completion_percent_snapshot
  ) VALUES (
    v_transaction.tenant_id,
    v_transaction.project_id,
    v_transaction.id,
    v_transaction.broker_company_id,
    v_transaction.broker_agent_user_id,
    v_plan_id,
    v_basis_amount,
    v_rate_percent,
    round(v_basis_amount * v_rate_percent / 100, 2),
    'PENDING_PREREQUISITES',
    0
  )
  ON CONFLICT (transaction_id) DO UPDATE
  SET broker_agent_user_id = broker_commission_cases.broker_agent_user_id
  RETURNING id INTO v_case_id;

  PERFORM refresh_broker_commission_case(v_transaction.id);
  RETURN v_case_id;
END;
$$;

CREATE OR REPLACE FUNCTION create_broker_commission_case_for_transaction()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM ensure_broker_commission_case(NEW.id);
  RETURN NEW;
END;
$$;

-- Backfill only transactions that are already broker-snapshotted. Historical
-- commission rows are never repriced because ON CONFLICT retains their plan/economics.
DO $$
DECLARE
  transaction_id uuid;
BEGIN
  FOR transaction_id IN
    SELECT id
    FROM transactions
    WHERE buyer_source = 'BROKER'
      AND broker_company_id IS NOT NULL
  LOOP
    PERFORM ensure_broker_commission_case(transaction_id);
  END LOOP;
END;
$$;

UPDATE platform_runtime_contract
SET schema_version = 37,
    minimum_runtime_version = 36,
    migration_marker = '0037_commission_transaction_attribution_sync',
    updated_at = now()
WHERE singleton_key = 'production'
  AND schema_version < 37;

COMMIT;
