BEGIN;

CREATE TABLE IF NOT EXISTS document_template_signer_requirements (
  template_id uuid NOT NULL REFERENCES document_templates(id) ON DELETE CASCADE,
  signer_role text NOT NULL CHECK (signer_role IN ('BUYER','COMPANY','WITNESS','BROKER')),
  signing_order integer NOT NULL DEFAULT 1 CHECK (signing_order > 0),
  required boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (template_id, signer_role)
);

CREATE TABLE IF NOT EXISTS project_milestone_slas (
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  milestone_code text NOT NULL CHECK (milestone_code IN (
    'BUYER_DOCUMENTS_COMPLETE',
    'DOWN_PAYMENT_RECEIVED',
    'CHEQUES_RECEIVED',
    'CONTRACT_GENERATED',
    'CONTRACT_SIGNED',
    'CONTRACT_STAMPED'
  )),
  target_hours_after_open integer NOT NULL CHECK (target_hours_after_open > 0 AND target_hours_after_open <= 87600),
  reminder_hours_before integer NOT NULL DEFAULT 24 CHECK (reminder_hours_before >= 0 AND reminder_hours_before <= 87600),
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (project_id, tenant_id)
    REFERENCES projects(id, tenant_id) ON DELETE CASCADE,
  PRIMARY KEY (project_id, milestone_code)
);

CREATE OR REPLACE FUNCTION refresh_broker_commission_case(p_transaction_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_completion numeric(5,2);
  v_prerequisites_complete boolean;
  v_now timestamptz := now();
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

  UPDATE broker_commission_cases c
  SET
    completion_percent_snapshot = v_completion,
    status = CASE
      WHEN v_prerequisites_complete AND c.status = 'PENDING_PREREQUISITES' THEN 'ELIGIBLE'
      WHEN NOT v_prerequisites_complete AND c.status = 'ELIGIBLE' THEN 'PENDING_PREREQUISITES'
      WHEN NOT v_prerequisites_complete AND c.status IN ('INVOICED','DUE') THEN 'DISPUTED'
      ELSE c.status
    END,
    eligible_at = CASE
      WHEN v_prerequisites_complete AND c.eligible_at IS NULL THEN v_now
      WHEN NOT v_prerequisites_complete AND c.status = 'ELIGIBLE' THEN NULL
      ELSE c.eligible_at
    END,
    due_at = CASE
      WHEN v_prerequisites_complete AND c.due_at IS NULL
        THEN v_now + make_interval(days => p.due_days_after_eligibility)
      WHEN NOT v_prerequisites_complete AND c.status = 'ELIGIBLE' THEN NULL
      ELSE c.due_at
    END,
    updated_at = v_now
  FROM broker_commission_plans p
  WHERE c.transaction_id = p_transaction_id
    AND p.id = c.commission_plan_id;
END;
$$;

CREATE OR REPLACE FUNCTION create_broker_commission_case_for_transaction()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_broker_company_id uuid;
  v_broker_agent_user_id uuid;
  v_basis_amount numeric(18,2);
  v_plan_id uuid;
  v_rate_percent numeric(7,4);
  v_commission_amount numeric(18,2);
BEGIN
  SELECT
    b.broker_company_id,
    b.broker_agent_user_id,
    r.quoted_total
  INTO
    v_broker_company_id,
    v_broker_agent_user_id,
    v_basis_amount
  FROM buyer_profiles b
  JOIN reservations r ON r.id = NEW.reservation_id
  WHERE b.id = NEW.buyer_profile_id
    AND b.source = 'BROKER';

  IF v_broker_company_id IS NULL OR v_basis_amount IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT p.id, p.rate_percent
  INTO v_plan_id, v_rate_percent
  FROM broker_commission_plans p
  WHERE p.tenant_id = NEW.tenant_id
    AND p.project_id = NEW.project_id
    AND p.broker_company_id = v_broker_company_id
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
    v_broker_company_id,
    v_broker_agent_user_id,
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

DROP TRIGGER IF EXISTS trg_create_broker_commission_case ON transactions;
CREATE TRIGGER trg_create_broker_commission_case
AFTER INSERT ON transactions
FOR EACH ROW
EXECUTE FUNCTION create_broker_commission_case_for_transaction();

CREATE OR REPLACE FUNCTION refresh_commission_after_milestone()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM refresh_broker_commission_case(NEW.transaction_id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_refresh_commission_after_milestone ON transaction_milestones;
CREATE TRIGGER trg_refresh_commission_after_milestone
AFTER INSERT OR UPDATE OF status, weight_percent ON transaction_milestones
FOR EACH ROW
EXECUTE FUNCTION refresh_commission_after_milestone();

-- Upgrade-safe backfill: create missing commission cases for already-open broker transactions
-- only when a plan was already effective when that transaction opened.
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
)
SELECT
  t.tenant_id,
  t.project_id,
  t.id,
  b.broker_company_id,
  b.broker_agent_user_id,
  p.id,
  r.quoted_total,
  p.rate_percent,
  round(r.quoted_total * p.rate_percent / 100, 2),
  'PENDING_PREREQUISITES',
  0
FROM transactions t
JOIN buyer_profiles b ON b.id = t.buyer_profile_id AND b.source = 'BROKER'
JOIN reservations r ON r.id = t.reservation_id AND r.quoted_total IS NOT NULL
JOIN LATERAL (
  SELECT cp.id, cp.rate_percent
  FROM broker_commission_plans cp
  WHERE cp.tenant_id = t.tenant_id
    AND cp.project_id = t.project_id
    AND cp.broker_company_id = b.broker_company_id
    AND cp.status = 'ACTIVE'
    AND cp.effective_at <= t.opened_at
  ORDER BY cp.effective_at DESC, cp.version_number DESC
  LIMIT 1
) p ON true
WHERE b.broker_company_id IS NOT NULL
ON CONFLICT (transaction_id) DO NOTHING;

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT transaction_id FROM broker_commission_cases LOOP
    PERFORM refresh_broker_commission_case(r.transaction_id);
  END LOOP;
END $$;

COMMIT;
