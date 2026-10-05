BEGIN;

CREATE TABLE project_ai_settings (
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  project_id uuid NOT NULL REFERENCES projects(id),
  buyer_enabled boolean NOT NULL DEFAULT false,
  manager_enabled boolean NOT NULL DEFAULT false,
  provider_code text NOT NULL DEFAULT 'DETERMINISTIC' CHECK (provider_code IN ('DETERMINISTIC','EXTERNAL_HTTP')),
  model text NULL,
  updated_by uuid NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, project_id)
);

CREATE INDEX project_ai_settings_provider
  ON project_ai_settings(provider_code)
  WHERE buyer_enabled = true OR manager_enabled = true;

CREATE TABLE ai_invocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  project_id uuid NOT NULL REFERENCES projects(id),
  user_id uuid NOT NULL REFERENCES users(id),
  purpose text NOT NULL CHECK (purpose IN ('BUYER_RECOMMENDATION','MANAGER_INSIGHT')),
  provider_code text NOT NULL CHECK (provider_code IN ('DETERMINISTIC','EXTERNAL_HTTP')),
  model text NULL,
  request_fingerprint text NOT NULL,
  candidate_count integer NULL CHECK (candidate_count IS NULL OR candidate_count >= 0),
  status text NOT NULL CHECK (status IN ('SUCCESS','FAILED','FALLBACK')),
  latency_ms integer NOT NULL CHECK (latency_ms >= 0),
  external_request_id text NULL,
  error_code text NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ai_invocations_project_created
  ON ai_invocations(tenant_id, project_id, created_at DESC);

CREATE INDEX ai_invocations_failures
  ON ai_invocations(tenant_id, project_id, created_at DESC)
  WHERE status IN ('FAILED','FALLBACK');

CREATE OR REPLACE FUNCTION enforce_ai_project_tenant()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM projects p
    WHERE p.id = NEW.project_id AND p.tenant_id = NEW.tenant_id
  ) THEN
    RAISE EXCEPTION 'AI configuration project must belong to tenant';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_ai_settings_project_tenant
BEFORE INSERT OR UPDATE OF tenant_id, project_id
ON project_ai_settings
FOR EACH ROW EXECUTE FUNCTION enforce_ai_project_tenant();

CREATE TRIGGER trg_ai_invocations_project_tenant
BEFORE INSERT OR UPDATE OF tenant_id, project_id
ON ai_invocations
FOR EACH ROW EXECUTE FUNCTION enforce_ai_project_tenant();

COMMIT;
