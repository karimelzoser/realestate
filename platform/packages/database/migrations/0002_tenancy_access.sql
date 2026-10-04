BEGIN;

CREATE TABLE IF NOT EXISTS tenants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL,
  name text NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','SUSPENDED','ARCHIVED')),
  default_currency char(3) NOT NULL DEFAULT 'EGP',
  default_timezone text NOT NULL DEFAULT 'Africa/Cairo',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (code)
);

CREATE TABLE IF NOT EXISTS tenant_memberships (
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','SUSPENDED','INVITED')),
  joined_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, user_id)
);

CREATE TABLE IF NOT EXISTS projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  code text NOT NULL,
  name text NOT NULL,
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','ACTIVE','PAUSED','CLOSED','ARCHIVED')),
  currency char(3) NOT NULL DEFAULT 'EGP',
  timezone text NOT NULL DEFAULT 'Africa/Cairo',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, code),
  UNIQUE (id, tenant_id)
);

CREATE INDEX IF NOT EXISTS projects_tenant_status
  ON projects(tenant_id, status);

CREATE TABLE IF NOT EXISTS broker_companies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  code text NOT NULL,
  name text NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','SUSPENDED','ARCHIVED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, code),
  UNIQUE (id, tenant_id)
);

CREATE TABLE IF NOT EXISTS broker_project_access (
  broker_company_id uuid NOT NULL,
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','SUSPENDED','EXPIRED')),
  effective_from timestamptz NOT NULL DEFAULT now(),
  effective_to timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (broker_company_id, project_id),
  FOREIGN KEY (broker_company_id, tenant_id)
    REFERENCES broker_companies(id, tenant_id) ON DELETE CASCADE,
  FOREIGN KEY (project_id, tenant_id)
    REFERENCES projects(id, tenant_id) ON DELETE CASCADE,
  CHECK (effective_to IS NULL OR effective_to > effective_from)
);

CREATE TABLE IF NOT EXISTS access_role_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_code text NOT NULL CHECK (role_code IN (
    'PRENEURA_SUPER_ADMIN',
    'OPERATIONS_DIRECTOR',
    'MANAGER',
    'SALES',
    'QUEUE_RECEPTIONIST',
    'ALLOCATOR',
    'TRANSACTION_OPERATOR',
    'BROKER_MANAGER',
    'BROKER_FINANCE',
    'BROKER_AGENT',
    'BUYER'
  )),
  scope_type text NOT NULL CHECK (scope_type IN ('PLATFORM','TENANT','PROJECT','BROKER_COMPANY')),
  tenant_id uuid REFERENCES tenants(id) ON DELETE CASCADE,
  project_id uuid,
  broker_company_id uuid,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','SUSPENDED')),
  granted_by uuid REFERENCES users(id) ON DELETE SET NULL,
  granted_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  FOREIGN KEY (project_id, tenant_id)
    REFERENCES projects(id, tenant_id) ON DELETE CASCADE,
  FOREIGN KEY (broker_company_id, tenant_id)
    REFERENCES broker_companies(id, tenant_id) ON DELETE CASCADE,
  CHECK (
    (scope_type = 'PLATFORM' AND tenant_id IS NULL AND project_id IS NULL AND broker_company_id IS NULL)
    OR
    (scope_type = 'TENANT' AND tenant_id IS NOT NULL AND project_id IS NULL AND broker_company_id IS NULL)
    OR
    (scope_type = 'PROJECT' AND tenant_id IS NOT NULL AND project_id IS NOT NULL AND broker_company_id IS NULL)
    OR
    (scope_type = 'BROKER_COMPANY' AND tenant_id IS NOT NULL AND project_id IS NULL AND broker_company_id IS NOT NULL)
  ),
  CHECK (role_code = 'PRENEURA_SUPER_ADMIN' OR scope_type <> 'PLATFORM'),
  CHECK (role_code <> 'PRENEURA_SUPER_ADMIN' OR scope_type = 'PLATFORM')
);

CREATE UNIQUE INDEX IF NOT EXISTS access_role_assignments_active_unique
  ON access_role_assignments(
    user_id,
    role_code,
    scope_type,
    COALESCE(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid),
    COALESCE(project_id, '00000000-0000-0000-0000-000000000000'::uuid),
    COALESCE(broker_company_id, '00000000-0000-0000-0000-000000000000'::uuid)
  )
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS access_role_assignments_user_active
  ON access_role_assignments(user_id, scope_type, tenant_id, project_id, broker_company_id)
  WHERE status = 'ACTIVE' AND revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS broker_project_access_project_active
  ON broker_project_access(project_id, broker_company_id)
  WHERE status = 'ACTIVE';

COMMIT;
