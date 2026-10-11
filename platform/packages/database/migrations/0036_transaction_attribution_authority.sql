BEGIN;

-- New commission cases must use the immutable transaction attribution captured at
-- transaction creation. Later project-attribution changes cannot move a historical sale.
CREATE OR REPLACE FUNCTION create_broker_commission_case_for_transaction()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_basis_amount numeric(18,2);
  v_plan_id uuid;
  v_rate_percent numeric(7,4);
  v_commission_amount numeric(18,2);
BEGIN
  IF NEW.buyer_source <> 'BROKER' OR NEW.broker_company_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT r.quoted_total
  INTO v_basis_amount
  FROM reservations r
  WHERE r.id = NEW.reservation_id
    AND r.tenant_id = NEW.tenant_id
    AND r.project_id = NEW.project_id;

  IF v_basis_amount IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT p.id, p.rate_percent
  INTO v_plan_id, v_rate_percent
  FROM broker_commission_plans p
  WHERE p.tenant_id = NEW.tenant_id
    AND p.project_id = NEW.project_id
    AND p.broker_company_id = NEW.broker_company_id
    AND p.status = 'ACTIVE'
    AND p.effective_at <= NEW.opened_at
  ORDER BY p.effective_at DESC, p.version_number DESC
  LIMIT 1;

  IF v_plan_id IS NULL THEN
    RETURN NEW;
  END IF;

  v_commission_amount := round(v_basis_amount * v_rate_percent / 100, 2);

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
    NEW.tenant_id,
    NEW.project_id,
    NEW.id,
    NEW.broker_company_id,
    NEW.broker_agent_user_id,
    v_plan_id,
    v_basis_amount,
    v_rate_percent,
    v_commission_amount,
    'PENDING_PREREQUISITES',
    0
  )
  ON CONFLICT (transaction_id) DO NOTHING;

  PERFORM refresh_broker_commission_case(NEW.id);
  RETURN NEW;
END;
$$;

UPDATE platform_runtime_contract
SET schema_version = 36,
    minimum_runtime_version = 35,
    migration_marker = '0036_transaction_attribution_authority',
    updated_at = now()
WHERE singleton_key = 'production'
  AND schema_version < 36;

COMMIT;
