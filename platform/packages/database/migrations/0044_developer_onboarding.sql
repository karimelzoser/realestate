BEGIN;

CREATE TABLE IF NOT EXISTS developer_tenant_branding (
  tenant_id uuid PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  display_name_en text NOT NULL,
  display_name_ar text NOT NULL,
  legal_name text,
  primary_color text NOT NULL DEFAULT '#111827',
  secondary_color text,
  website_url text,
  updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (length(trim(display_name_en)) BETWEEN 2 AND 160),
  CHECK (length(trim(display_name_ar)) BETWEEN 2 AND 160),
  CHECK (primary_color ~ '^#[0-9A-Fa-f]{6}$'),
  CHECK (secondary_color IS NULL OR secondary_color ~ '^#[0-9A-Fa-f]{6}$'),
  CHECK (website_url IS NULL OR website_url ~ '^https://')
);

CREATE TABLE IF NOT EXISTS developer_project_branding (
  project_id uuid PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  display_name_en text NOT NULL,
  display_name_ar text NOT NULL,
  short_description_en text,
  short_description_ar text,
  primary_color text,
  secondary_color text,
  updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (length(trim(display_name_en)) BETWEEN 2 AND 180),
  CHECK (length(trim(display_name_ar)) BETWEEN 2 AND 180),
  CHECK (short_description_en IS NULL OR length(short_description_en) <= 1000),
  CHECK (short_description_ar IS NULL OR length(short_description_ar) <= 1000),
  CHECK (primary_color IS NULL OR primary_color ~ '^#[0-9A-Fa-f]{6}$'),
  CHECK (secondary_color IS NULL OR secondary_color ~ '^#[0-9A-Fa-f]{6}$')
);

CREATE UNIQUE INDEX IF NOT EXISTS developer_project_branding_tenant_project
  ON developer_project_branding(tenant_id, project_id);

CREATE OR REPLACE FUNCTION preneura_developer_project_branding_scope()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  project_tenant uuid;
BEGIN
  SELECT tenant_id INTO project_tenant FROM projects WHERE id = NEW.project_id;
  IF project_tenant IS NULL OR project_tenant <> NEW.tenant_id THEN
    RAISE EXCEPTION 'project branding tenant/project scope mismatch';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_developer_project_branding_scope ON developer_project_branding;
CREATE TRIGGER trg_developer_project_branding_scope
BEFORE INSERT OR UPDATE ON developer_project_branding
FOR EACH ROW EXECUTE FUNCTION preneura_developer_project_branding_scope();

CREATE TABLE IF NOT EXISTS developer_onboarding_states (
  tenant_id uuid PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'SETUP' CHECK (status IN ('SETUP','COMPLETED')),
  completed_at timestamptz,
  completed_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (status = 'SETUP' AND completed_at IS NULL)
    OR (status = 'COMPLETED' AND completed_at IS NOT NULL)
  )
);

INSERT INTO developer_onboarding_states (tenant_id, status)
SELECT id, 'SETUP'
FROM tenants
ON CONFLICT (tenant_id) DO NOTHING;

CREATE TABLE IF NOT EXISTS developer_onboarding_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  project_id uuid REFERENCES projects(id) ON DELETE CASCADE,
  actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  event_type text NOT NULL CHECK (event_type IN (
    'TENANT_BRANDING_UPDATED',
    'PROJECT_BRANDING_UPDATED',
    'OPERATIONS_DIRECTOR_INVITED',
    'ONBOARDING_COMPLETED',
    'TENANT_LIFECYCLE_CHANGED',
    'PROJECT_LIFECYCLE_CHANGED'
  )),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS developer_onboarding_events_tenant_time
  ON developer_onboarding_events(tenant_id, created_at DESC, id DESC);

CREATE OR REPLACE FUNCTION preneura_developer_onboarding_event_immutable()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'developer onboarding events are append-only';
END;
$$;

DROP TRIGGER IF EXISTS trg_developer_onboarding_events_immutable ON developer_onboarding_events;
CREATE TRIGGER trg_developer_onboarding_events_immutable
BEFORE UPDATE OR DELETE ON developer_onboarding_events
FOR EACH ROW EXECUTE FUNCTION preneura_developer_onboarding_event_immutable();

-- Onboarding/branding is additive to runtime 43. Runtime 43 remains compatible during
-- rolling migration, while runtime 44 requires this schema to expose E03 onboarding APIs.
UPDATE platform_runtime_contract
SET
  schema_version = 44,
  minimum_runtime_version = LEAST(minimum_runtime_version, 43),
  migration_marker = '0044_developer_onboarding',
  updated_at = now()
WHERE singleton_key = 'production';

COMMIT;
