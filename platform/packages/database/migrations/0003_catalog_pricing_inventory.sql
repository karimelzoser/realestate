BEGIN;

CREATE TABLE IF NOT EXISTS catalog_unit_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  code text NOT NULL,
  name text NOT NULL,
  description text,
  bedroom_count integer CHECK (bedroom_count IS NULL OR bedroom_count >= 0),
  indoor_area_sqm numeric(12,2) NOT NULL CHECK (indoor_area_sqm > 0),
  roof_area_sqm numeric(12,2) NOT NULL DEFAULT 0 CHECK (roof_area_sqm >= 0),
  garden_area_sqm numeric(12,2) NOT NULL DEFAULT 0 CHECK (garden_area_sqm >= 0),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','HIDDEN','ARCHIVED')),
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (project_id, tenant_id)
    REFERENCES projects(id, tenant_id) ON DELETE CASCADE,
  UNIQUE (project_id, code),
  UNIQUE (id, project_id),
  UNIQUE (id, tenant_id, project_id)
);

CREATE INDEX IF NOT EXISTS catalog_unit_types_project_status
  ON catalog_unit_types(project_id, status, sort_order, name);

CREATE TABLE IF NOT EXISTS pricing_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  version_number integer NOT NULL CHECK (version_number > 0),
  label text NOT NULL,
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','SCHEDULED','PUBLISHED','SUPERSEDED','CANCELLED')),
  effective_at timestamptz NOT NULL,
  published_at timestamptz,
  published_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (project_id, tenant_id)
    REFERENCES projects(id, tenant_id) ON DELETE CASCADE,
  UNIQUE (project_id, version_number),
  CHECK (
    (status IN ('PUBLISHED','SUPERSEDED') AND published_at IS NOT NULL)
    OR status NOT IN ('PUBLISHED','SUPERSEDED')
  )
);

CREATE INDEX IF NOT EXISTS pricing_versions_project_effective
  ON pricing_versions(project_id, effective_at DESC, version_number DESC)
  WHERE status IN ('SCHEDULED','PUBLISHED');

CREATE TABLE IF NOT EXISTS pricing_rates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pricing_version_id uuid NOT NULL REFERENCES pricing_versions(id) ON DELETE CASCADE,
  unit_type_id uuid NOT NULL REFERENCES catalog_unit_types(id) ON DELETE CASCADE,
  component text NOT NULL CHECK (component IN ('INDOOR','ROOF','GARDEN')),
  rate_per_sqm numeric(18,2) NOT NULL CHECK (rate_per_sqm >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (pricing_version_id, unit_type_id, component)
);

CREATE INDEX IF NOT EXISTS pricing_rates_unit_type
  ON pricing_rates(unit_type_id, pricing_version_id);

-- Inventory is intentionally anonymous at selling time. A slot represents one
-- saleable capacity position for a unit type, not a public apartment number.
CREATE TABLE IF NOT EXISTS inventory_slots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  unit_type_id uuid NOT NULL,
  state text NOT NULL DEFAULT 'AVAILABLE' CHECK (state IN ('AVAILABLE','RESERVED','SOLD','WITHDRAWN')),
  internal_reference text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (unit_type_id, tenant_id, project_id)
    REFERENCES catalog_unit_types(id, tenant_id, project_id) ON DELETE CASCADE,
  UNIQUE (project_id, internal_reference)
);

CREATE INDEX IF NOT EXISTS inventory_slots_type_state
  ON inventory_slots(project_id, unit_type_id, state);

CREATE TABLE IF NOT EXISTS inventory_locks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  unit_type_id uuid NOT NULL,
  inventory_slot_id uuid NOT NULL REFERENCES inventory_slots(id) ON DELETE RESTRICT,
  buyer_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  locked_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','RELEASED','EXPIRED','CONVERTED')),
  expires_at timestamptz NOT NULL,
  released_at timestamptz,
  converted_at timestamptz,
  release_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (unit_type_id, tenant_id, project_id)
    REFERENCES catalog_unit_types(id, tenant_id, project_id) ON DELETE RESTRICT,
  CHECK (expires_at > created_at),
  CHECK (
    (status = 'ACTIVE' AND released_at IS NULL AND converted_at IS NULL)
    OR (status IN ('RELEASED','EXPIRED') AND released_at IS NOT NULL AND converted_at IS NULL)
    OR (status = 'CONVERTED' AND converted_at IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS inventory_locks_one_active_per_slot
  ON inventory_locks(inventory_slot_id)
  WHERE status = 'ACTIVE';

CREATE INDEX IF NOT EXISTS inventory_locks_project_active
  ON inventory_locks(project_id, unit_type_id, expires_at)
  WHERE status = 'ACTIVE';

CREATE INDEX IF NOT EXISTS inventory_locks_buyer_active
  ON inventory_locks(buyer_user_id, project_id, expires_at)
  WHERE status = 'ACTIVE' AND buyer_user_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS domain_outbox_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES tenants(id) ON DELETE CASCADE,
  project_id uuid REFERENCES projects(id) ON DELETE CASCADE,
  aggregate_type text NOT NULL,
  aggregate_id uuid NOT NULL,
  event_type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0)
);

CREATE INDEX IF NOT EXISTS domain_outbox_unpublished
  ON domain_outbox_events(occurred_at, id)
  WHERE published_at IS NULL;

COMMIT;
