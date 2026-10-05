BEGIN;

CREATE TABLE platform_support_access_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_user_id uuid NOT NULL REFERENCES users(id),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  project_id uuid NULL REFERENCES projects(id),
  reason text NOT NULL CHECK (char_length(trim(reason)) >= 8),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','ENDED','EXPIRED')),
  started_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  ended_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (expires_at > started_at),
  CHECK (expires_at <= started_at + interval '4 hours'),
  CHECK (
    (status = 'ACTIVE' AND ended_at IS NULL)
    OR (status IN ('ENDED','EXPIRED'))
  )
);

CREATE INDEX platform_support_access_operator_active
  ON platform_support_access_sessions(operator_user_id, expires_at)
  WHERE status = 'ACTIVE';

CREATE INDEX platform_support_access_tenant_history
  ON platform_support_access_sessions(tenant_id, started_at DESC);

CREATE UNIQUE INDEX platform_support_access_one_active_scope
  ON platform_support_access_sessions(operator_user_id, tenant_id, coalesce(project_id, '00000000-0000-0000-0000-000000000000'::uuid))
  WHERE status = 'ACTIVE';

CREATE OR REPLACE FUNCTION enforce_support_access_project_tenant()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.project_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM projects p
    WHERE p.id = NEW.project_id AND p.tenant_id = NEW.tenant_id
  ) THEN
    RAISE EXCEPTION 'support access project must belong to tenant';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_support_access_project_tenant
BEFORE INSERT OR UPDATE OF tenant_id, project_id
ON platform_support_access_sessions
FOR EACH ROW EXECUTE FUNCTION enforce_support_access_project_tenant();

COMMIT;
