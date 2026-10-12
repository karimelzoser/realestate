BEGIN;

CREATE TABLE IF NOT EXISTS brokerage_organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  display_name_en text NOT NULL,
  display_name_ar text NOT NULL,
  legal_name text,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','SUSPENDED','ARCHIVED')),
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (code ~ '^[A-Z0-9][A-Z0-9_-]{1,63}$'),
  CHECK (length(trim(display_name_en)) BETWEEN 2 AND 180),
  CHECK (length(trim(display_name_ar)) BETWEEN 2 AND 180)
);

CREATE TABLE IF NOT EXISTS brokerage_tenant_links (
  organization_id uuid NOT NULL REFERENCES brokerage_organizations(id) ON DELETE RESTRICT,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  broker_company_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','SUSPENDED','TERMINATED')),
  linked_by uuid REFERENCES users(id) ON DELETE SET NULL,
  linked_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, tenant_id),
  UNIQUE (broker_company_id),
  UNIQUE (organization_id, tenant_id, broker_company_id),
  FOREIGN KEY (broker_company_id, tenant_id)
    REFERENCES broker_companies(id, tenant_id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS brokerage_agreements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  tenant_id uuid NOT NULL,
  broker_company_id uuid NOT NULL,
  version_number integer NOT NULL CHECK (version_number >= 1),
  agreement_code text NOT NULL,
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','ACTIVE','SUSPENDED','EXPIRED','TERMINATED')),
  effective_from timestamptz NOT NULL,
  effective_to timestamptz,
  commercial_terms jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  approved_by uuid REFERENCES users(id) ON DELETE SET NULL,
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, tenant_id, broker_company_id)
    REFERENCES brokerage_tenant_links(organization_id, tenant_id, broker_company_id) ON DELETE RESTRICT,
  UNIQUE (tenant_id, agreement_code),
  UNIQUE (organization_id, tenant_id, version_number),
  UNIQUE (id, tenant_id),
  CHECK (effective_to IS NULL OR effective_to > effective_from),
  CHECK ((status = 'ACTIVE' AND approved_at IS NOT NULL) OR status <> 'ACTIVE')
);

CREATE INDEX IF NOT EXISTS brokerage_agreements_tenant_status
  ON brokerage_agreements(tenant_id, status, organization_id);

CREATE TABLE IF NOT EXISTS brokerage_agreement_projects (
  agreement_id uuid NOT NULL,
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','SUSPENDED','EXPIRED')),
  effective_from timestamptz NOT NULL DEFAULT now(),
  effective_to timestamptz,
  granted_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (agreement_id, project_id),
  FOREIGN KEY (agreement_id, tenant_id)
    REFERENCES brokerage_agreements(id, tenant_id) ON DELETE CASCADE,
  FOREIGN KEY (project_id, tenant_id)
    REFERENCES projects(id, tenant_id) ON DELETE CASCADE,
  CHECK (effective_to IS NULL OR effective_to > effective_from)
);

CREATE INDEX IF NOT EXISTS brokerage_agreement_projects_project_active
  ON brokerage_agreement_projects(project_id, agreement_id)
  WHERE status = 'ACTIVE';

CREATE TABLE IF NOT EXISTS brokerage_attribution_transfers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  project_id uuid NOT NULL,
  buyer_profile_id uuid NOT NULL,
  from_broker_company_id uuid,
  from_broker_agent_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  to_broker_company_id uuid NOT NULL,
  to_broker_agent_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'REQUESTED' CHECK (status IN ('REQUESTED','APPROVED','REJECTED','CANCELLED')),
  requested_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  requested_at timestamptz NOT NULL DEFAULT now(),
  reviewed_by uuid REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  review_note text,
  FOREIGN KEY (project_id, tenant_id) REFERENCES projects(id, tenant_id) ON DELETE CASCADE,
  FOREIGN KEY (buyer_profile_id, tenant_id) REFERENCES buyer_profiles(id, tenant_id) ON DELETE CASCADE,
  FOREIGN KEY (from_broker_company_id, tenant_id) REFERENCES broker_companies(id, tenant_id) ON DELETE RESTRICT,
  FOREIGN KEY (to_broker_company_id, tenant_id) REFERENCES broker_companies(id, tenant_id) ON DELETE RESTRICT,
  CHECK (length(trim(reason)) BETWEEN 3 AND 1000),
  CHECK (
    (status = 'REQUESTED' AND reviewed_at IS NULL)
    OR (status IN ('APPROVED','REJECTED') AND reviewed_at IS NOT NULL)
    OR status = 'CANCELLED'
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS brokerage_attribution_transfers_one_pending
  ON brokerage_attribution_transfers(buyer_profile_id)
  WHERE status = 'REQUESTED';

CREATE INDEX IF NOT EXISTS brokerage_attribution_transfers_tenant_project
  ON brokerage_attribution_transfers(tenant_id, project_id, requested_at DESC);

CREATE TABLE IF NOT EXISTS brokerage_attribution_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  buyer_profile_id uuid NOT NULL,
  transfer_id uuid REFERENCES brokerage_attribution_transfers(id) ON DELETE SET NULL,
  broker_company_id uuid,
  broker_agent_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  event_type text NOT NULL CHECK (event_type IN ('INITIAL','TRANSFER_APPROVED','CLEARED')),
  actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (buyer_profile_id, tenant_id) REFERENCES buyer_profiles(id, tenant_id) ON DELETE CASCADE,
  FOREIGN KEY (broker_company_id, tenant_id) REFERENCES broker_companies(id, tenant_id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS brokerage_attribution_history_buyer_time
  ON brokerage_attribution_history(buyer_profile_id, occurred_at DESC, id DESC);

CREATE OR REPLACE FUNCTION preneura_brokerage_history_immutable()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'brokerage attribution history is append-only';
END;
$$;

DROP TRIGGER IF EXISTS trg_brokerage_attribution_history_immutable ON brokerage_attribution_history;
CREATE TRIGGER trg_brokerage_attribution_history_immutable
BEFORE UPDATE OR DELETE ON brokerage_attribution_history
FOR EACH ROW EXECUTE FUNCTION preneura_brokerage_history_immutable();

-- Preserve existing tenant-local broker companies by wrapping each one in a global
-- brokerage organization and a legacy active agreement. Future onboarding can link
-- the same organization to additional developer tenants without changing the
-- tenant-local broker_company_id used by commissions and transactions.
INSERT INTO brokerage_organizations (
  code, display_name_en, display_name_ar, legal_name, status
)
SELECT
  'LEGACY_' || upper(replace(left(bc.tenant_id::text, 8) || '_' || bc.code, '-', '_')),
  bc.name,
  bc.name,
  bc.name,
  CASE WHEN bc.status = 'ARCHIVED' THEN 'ARCHIVED' WHEN bc.status = 'SUSPENDED' THEN 'SUSPENDED' ELSE 'ACTIVE' END
FROM broker_companies bc
ON CONFLICT (code) DO NOTHING;

INSERT INTO brokerage_tenant_links (organization_id, tenant_id, broker_company_id, status)
SELECT
  bo.id,
  bc.tenant_id,
  bc.id,
  CASE WHEN bc.status = 'ACTIVE' THEN 'ACTIVE' ELSE 'SUSPENDED' END
FROM broker_companies bc
JOIN brokerage_organizations bo
  ON bo.code = 'LEGACY_' || upper(replace(left(bc.tenant_id::text, 8) || '_' || bc.code, '-', '_'))
ON CONFLICT (organization_id, tenant_id) DO NOTHING;

INSERT INTO brokerage_agreements (
  organization_id, tenant_id, broker_company_id, version_number, agreement_code,
  status, effective_from, approved_at, commercial_terms
)
SELECT
  l.organization_id,
  l.tenant_id,
  l.broker_company_id,
  1,
  'LEGACY-' || left(l.broker_company_id::text, 8),
  CASE WHEN l.status = 'ACTIVE' THEN 'ACTIVE' ELSE 'SUSPENDED' END,
  l.linked_at,
  CASE WHEN l.status = 'ACTIVE' THEN l.linked_at ELSE NULL END,
  jsonb_build_object('source', 'legacy_backfill')
FROM brokerage_tenant_links l
ON CONFLICT (organization_id, tenant_id, version_number) DO NOTHING;

INSERT INTO brokerage_agreement_projects (
  agreement_id, tenant_id, project_id, status, effective_from, effective_to
)
SELECT
  a.id,
  access.tenant_id,
  access.project_id,
  access.status,
  access.effective_from,
  access.effective_to
FROM broker_project_access access
JOIN brokerage_agreements a
  ON a.tenant_id = access.tenant_id
 AND a.broker_company_id = access.broker_company_id
 AND a.version_number = 1
ON CONFLICT (agreement_id, project_id) DO NOTHING;

INSERT INTO brokerage_attribution_history (
  tenant_id, buyer_profile_id, broker_company_id, broker_agent_user_id, event_type
)
SELECT tenant_id, id, broker_company_id, broker_agent_user_id, 'INITIAL'
FROM buyer_profiles
WHERE broker_company_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM brokerage_attribution_history h WHERE h.buyer_profile_id = buyer_profiles.id
  );

CREATE OR REPLACE FUNCTION preneura_approve_brokerage_attribution_transfer(
  p_transfer_id uuid,
  p_actor_user_id uuid,
  p_review_note text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
AS $$
DECLARE
  v_transfer brokerage_attribution_transfers%ROWTYPE;
  v_buyer buyer_profiles%ROWTYPE;
BEGIN
  SELECT * INTO v_transfer
  FROM brokerage_attribution_transfers
  WHERE id = p_transfer_id
  FOR UPDATE;

  IF v_transfer.id IS NULL OR v_transfer.status <> 'REQUESTED' THEN
    RAISE EXCEPTION 'attribution transfer is not pending';
  END IF;

  SELECT * INTO v_buyer
  FROM buyer_profiles
  WHERE id = v_transfer.buyer_profile_id AND tenant_id = v_transfer.tenant_id
  FOR UPDATE;

  IF v_buyer.id IS NULL THEN
    RAISE EXCEPTION 'buyer profile not found';
  END IF;

  IF v_buyer.broker_company_id IS DISTINCT FROM v_transfer.from_broker_company_id
     OR v_buyer.broker_agent_user_id IS DISTINCT FROM v_transfer.from_broker_agent_user_id THEN
    RAISE EXCEPTION 'buyer attribution changed after transfer request';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM broker_project_access access
    JOIN brokerage_agreements agreement
      ON agreement.tenant_id = access.tenant_id
     AND agreement.broker_company_id = access.broker_company_id
     AND agreement.status = 'ACTIVE'
     AND agreement.effective_from <= now()
     AND (agreement.effective_to IS NULL OR agreement.effective_to > now())
    JOIN brokerage_agreement_projects ap
      ON ap.agreement_id = agreement.id
     AND ap.project_id = access.project_id
     AND ap.status = 'ACTIVE'
     AND ap.effective_from <= now()
     AND (ap.effective_to IS NULL OR ap.effective_to > now())
    WHERE access.tenant_id = v_transfer.tenant_id
      AND access.project_id = v_transfer.project_id
      AND access.broker_company_id = v_transfer.to_broker_company_id
      AND access.status = 'ACTIVE'
      AND access.effective_from <= now()
      AND (access.effective_to IS NULL OR access.effective_to > now())
  ) THEN
    RAISE EXCEPTION 'target brokerage has no active agreement for project';
  END IF;

  IF v_transfer.to_broker_agent_user_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM access_role_assignments assignment
    WHERE assignment.user_id = v_transfer.to_broker_agent_user_id
      AND assignment.role_code = 'BROKER_AGENT'
      AND assignment.scope_type = 'BROKER_COMPANY'
      AND assignment.tenant_id = v_transfer.tenant_id
      AND assignment.broker_company_id = v_transfer.to_broker_company_id
      AND assignment.status = 'ACTIVE'
      AND assignment.revoked_at IS NULL
  ) THEN
    RAISE EXCEPTION 'target broker agent is not active in target brokerage';
  END IF;

  UPDATE buyer_profiles
  SET source = 'BROKER',
      broker_company_id = v_transfer.to_broker_company_id,
      broker_agent_user_id = v_transfer.to_broker_agent_user_id,
      updated_at = now()
  WHERE id = v_transfer.buyer_profile_id;

  UPDATE brokerage_attribution_transfers
  SET status = 'APPROVED',
      reviewed_by = p_actor_user_id,
      reviewed_at = now(),
      review_note = p_review_note
  WHERE id = p_transfer_id;

  INSERT INTO brokerage_attribution_history (
    tenant_id, buyer_profile_id, transfer_id, broker_company_id,
    broker_agent_user_id, event_type, actor_user_id
  ) VALUES (
    v_transfer.tenant_id, v_transfer.buyer_profile_id, v_transfer.id,
    v_transfer.to_broker_company_id, v_transfer.to_broker_agent_user_id,
    'TRANSFER_APPROVED', p_actor_user_id
  );

  RETURN p_transfer_id;
END;
$$;

UPDATE platform_runtime_contract
SET schema_version = 45,
    minimum_runtime_version = LEAST(minimum_runtime_version, 44),
    migration_marker = '0045_brokerage_b2b_onboarding',
    updated_at = now()
WHERE singleton_key = 'production';

COMMIT;
