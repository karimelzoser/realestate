BEGIN;

CREATE TABLE buyer_project_attributions (
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  buyer_profile_id uuid NOT NULL,
  source text NOT NULL CHECK (source IN ('DIRECT','BROKER','INTERNAL')),
  broker_company_id uuid,
  broker_agent_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  attributed_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (buyer_profile_id, project_id),
  FOREIGN KEY (project_id, tenant_id)
    REFERENCES projects(id, tenant_id) ON DELETE CASCADE,
  FOREIGN KEY (buyer_profile_id, tenant_id)
    REFERENCES buyer_profiles(id, tenant_id) ON DELETE CASCADE,
  FOREIGN KEY (broker_company_id, tenant_id)
    REFERENCES broker_companies(id, tenant_id) ON DELETE RESTRICT,
  CHECK (
    (source = 'BROKER' AND broker_company_id IS NOT NULL)
    OR (source <> 'BROKER' AND broker_company_id IS NULL AND broker_agent_user_id IS NULL)
  )
);

CREATE INDEX buyer_project_attributions_broker
  ON buyer_project_attributions(tenant_id, project_id, broker_company_id, broker_agent_user_id)
  WHERE source = 'BROKER';

-- Existing EOIs establish the project membership and preserve the legacy attribution
-- that was authoritative when those rows were created.
INSERT INTO buyer_project_attributions (
  tenant_id, project_id, buyer_profile_id, source,
  broker_company_id, broker_agent_user_id, attributed_by, created_at, updated_at
)
SELECT DISTINCT ON (e.buyer_profile_id, e.project_id)
  e.tenant_id,
  e.project_id,
  e.buyer_profile_id,
  b.source,
  b.broker_company_id,
  b.broker_agent_user_id,
  COALESCE(e.created_by, b.created_by),
  LEAST(e.created_at, b.created_at),
  greatest(e.updated_at, b.updated_at)
FROM buyer_eois e
JOIN buyer_profiles b
  ON b.id = e.buyer_profile_id
 AND b.tenant_id = e.tenant_id
ORDER BY e.buyer_profile_id, e.project_id, e.created_at ASC, e.id ASC
ON CONFLICT (buyer_profile_id, project_id) DO NOTHING;

CREATE OR REPLACE FUNCTION validate_buyer_project_attribution()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.source = 'BROKER' THEN
    IF NEW.broker_company_id IS NULL THEN
      RAISE EXCEPTION 'broker attribution requires broker company';
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM broker_project_access access
      WHERE access.tenant_id = NEW.tenant_id
        AND access.project_id = NEW.project_id
        AND access.broker_company_id = NEW.broker_company_id
        AND access.status = 'ACTIVE'
        AND access.effective_from <= now()
        AND (access.effective_to IS NULL OR access.effective_to > now())
    ) THEN
      RAISE EXCEPTION 'broker company is not currently authorized for this project';
    END IF;

    IF NEW.broker_agent_user_id IS NOT NULL AND NOT EXISTS (
      SELECT 1
      FROM access_role_assignments assignment
      WHERE assignment.user_id = NEW.broker_agent_user_id
        AND assignment.role_code = 'BROKER_AGENT'
        AND assignment.scope_type = 'BROKER_COMPANY'
        AND assignment.tenant_id = NEW.tenant_id
        AND assignment.broker_company_id = NEW.broker_company_id
        AND assignment.status = 'ACTIVE'
        AND assignment.revoked_at IS NULL
    ) THEN
      RAISE EXCEPTION 'broker agent is not actively assigned to the attributed broker company';
    END IF;
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER buyer_project_attribution_validate
BEFORE INSERT OR UPDATE ON buyer_project_attributions
FOR EACH ROW EXECUTE FUNCTION validate_buyer_project_attribution();

-- A transaction snapshots the project attribution so later reassignment cannot change
-- historical broker ownership or commission economics.
ALTER TABLE transactions
  ADD COLUMN buyer_source text,
  ADD COLUMN broker_company_id uuid,
  ADD COLUMN broker_agent_user_id uuid REFERENCES users(id) ON DELETE SET NULL;

UPDATE transactions transaction
SET buyer_source = COALESCE(attribution.source, profile.source),
    broker_company_id = COALESCE(attribution.broker_company_id, profile.broker_company_id),
    broker_agent_user_id = COALESCE(attribution.broker_agent_user_id, profile.broker_agent_user_id)
FROM buyer_profiles profile
LEFT JOIN buyer_project_attributions attribution
  ON attribution.buyer_profile_id = profile.id
 AND attribution.tenant_id = profile.tenant_id
 AND attribution.project_id = transaction.project_id
WHERE profile.id = transaction.buyer_profile_id
  AND profile.tenant_id = transaction.tenant_id;

ALTER TABLE transactions
  ALTER COLUMN buyer_source SET NOT NULL,
  ADD CONSTRAINT transactions_buyer_source_check
    CHECK (buyer_source IN ('DIRECT','BROKER','INTERNAL')),
  ADD CONSTRAINT transactions_broker_attribution_check
    CHECK (
      (buyer_source = 'BROKER' AND broker_company_id IS NOT NULL)
      OR (buyer_source <> 'BROKER' AND broker_company_id IS NULL AND broker_agent_user_id IS NULL)
    ),
  ADD CONSTRAINT transactions_broker_company_tenant_fk
    FOREIGN KEY (broker_company_id, tenant_id)
    REFERENCES broker_companies(id, tenant_id) ON DELETE RESTRICT;

CREATE INDEX transactions_broker_attribution
  ON transactions(tenant_id, project_id, broker_company_id, broker_agent_user_id, opened_at DESC)
  WHERE buyer_source = 'BROKER';

CREATE OR REPLACE FUNCTION snapshot_transaction_project_attribution()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  attribution buyer_project_attributions%ROWTYPE;
BEGIN
  SELECT * INTO attribution
  FROM buyer_project_attributions
  WHERE tenant_id = NEW.tenant_id
    AND project_id = NEW.project_id
    AND buyer_profile_id = NEW.buyer_profile_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'buyer is not attributed to this project';
  END IF;

  NEW.buyer_source := attribution.source;
  NEW.broker_company_id := attribution.broker_company_id;
  NEW.broker_agent_user_id := attribution.broker_agent_user_id;
  RETURN NEW;
END;
$$;

CREATE TRIGGER transactions_snapshot_project_attribution
BEFORE INSERT ON transactions
FOR EACH ROW EXECUTE FUNCTION snapshot_transaction_project_attribution();

CREATE OR REPLACE FUNCTION protect_transaction_attribution_snapshot()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.buyer_source IS DISTINCT FROM NEW.buyer_source
     OR OLD.broker_company_id IS DISTINCT FROM NEW.broker_company_id
     OR OLD.broker_agent_user_id IS DISTINCT FROM NEW.broker_agent_user_id THEN
    RAISE EXCEPTION 'transaction broker attribution is immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER transactions_attribution_immutable
BEFORE UPDATE ON transactions
FOR EACH ROW EXECUTE FUNCTION protect_transaction_attribution_snapshot();

UPDATE platform_runtime_contract
SET schema_version = 35,
    minimum_runtime_version = 34,
    migration_marker = '0035_project_buyer_attribution',
    updated_at = now()
WHERE singleton_key = 'production'
  AND schema_version < 35;

COMMIT;
