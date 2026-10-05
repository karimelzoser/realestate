BEGIN;

CREATE TABLE project_phases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  code text NOT NULL,
  name text NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','HIDDEN','ARCHIVED')),
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (project_id, tenant_id) REFERENCES projects(id, tenant_id) ON DELETE CASCADE,
  UNIQUE (project_id, code),
  UNIQUE (id, tenant_id, project_id)
);

CREATE INDEX project_phases_project_status
  ON project_phases(project_id, status, sort_order, name);

CREATE TABLE project_buildings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  phase_id uuid,
  code text NOT NULL,
  name text NOT NULL,
  cluster_name text,
  master_plan_geometry jsonb,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','HIDDEN','ARCHIVED')),
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (project_id, tenant_id) REFERENCES projects(id, tenant_id) ON DELETE CASCADE,
  FOREIGN KEY (phase_id, tenant_id, project_id)
    REFERENCES project_phases(id, tenant_id, project_id) ON DELETE RESTRICT,
  UNIQUE (project_id, code),
  UNIQUE (id, tenant_id, project_id),
  UNIQUE (id, tenant_id, project_id, phase_id)
);

CREATE INDEX project_buildings_project_phase
  ON project_buildings(project_id, phase_id, status, sort_order, name);

CREATE TABLE project_floors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  building_id uuid NOT NULL,
  code text NOT NULL,
  name text NOT NULL,
  level_number integer,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','HIDDEN','ARCHIVED')),
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (building_id, tenant_id, project_id)
    REFERENCES project_buildings(id, tenant_id, project_id) ON DELETE CASCADE,
  UNIQUE (building_id, code),
  UNIQUE (id, tenant_id, project_id, building_id)
);

CREATE INDEX project_floors_building_status
  ON project_floors(building_id, status, sort_order, level_number, name);

CREATE TABLE physical_units (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  building_id uuid NOT NULL,
  floor_id uuid NOT NULL,
  unit_type_id uuid NOT NULL,
  internal_reference text NOT NULL,
  display_reference text,
  orientation text,
  view_code text,
  corner_position text,
  master_plan_geometry jsonb,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','WITHDRAWN','ARCHIVED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (floor_id, tenant_id, project_id, building_id)
    REFERENCES project_floors(id, tenant_id, project_id, building_id) ON DELETE RESTRICT,
  FOREIGN KEY (unit_type_id, tenant_id, project_id)
    REFERENCES catalog_unit_types(id, tenant_id, project_id) ON DELETE RESTRICT,
  UNIQUE (project_id, internal_reference),
  UNIQUE (id, tenant_id, project_id, unit_type_id)
);

CREATE INDEX physical_units_hierarchy
  ON physical_units(project_id, building_id, floor_id, unit_type_id, status);

ALTER TABLE inventory_slots
  ADD COLUMN physical_unit_id uuid;

ALTER TABLE inventory_slots
  ADD CONSTRAINT inventory_slots_physical_unit_fk
  FOREIGN KEY (physical_unit_id, tenant_id, project_id, unit_type_id)
  REFERENCES physical_units(id, tenant_id, project_id, unit_type_id) ON DELETE RESTRICT;

CREATE UNIQUE INDEX inventory_slots_one_physical_unit
  ON inventory_slots(physical_unit_id)
  WHERE physical_unit_id IS NOT NULL;

CREATE TABLE project_master_plan_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  phase_id uuid,
  building_id uuid,
  asset_type text NOT NULL CHECK (asset_type IN ('MASTER_PLAN_IMAGE','MASTER_PLAN_3D','BUILDING_MODEL','FLOOR_PLAN','UNIT_MODEL','OTHER')),
  label text NOT NULL,
  storage_object_key text NOT NULL,
  mime_type text NOT NULL,
  sha256_hex text NOT NULL CHECK (sha256_hex ~ '^[0-9a-fA-F]{64}$'),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','RETIRED')),
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  retired_at timestamptz,
  FOREIGN KEY (project_id, tenant_id) REFERENCES projects(id, tenant_id) ON DELETE CASCADE,
  FOREIGN KEY (phase_id, tenant_id, project_id)
    REFERENCES project_phases(id, tenant_id, project_id) ON DELETE RESTRICT,
  FOREIGN KEY (building_id, tenant_id, project_id)
    REFERENCES project_buildings(id, tenant_id, project_id) ON DELETE RESTRICT,
  CHECK (building_id IS NULL OR phase_id IS NULL OR EXISTS (
    SELECT 1 FROM project_buildings b WHERE b.id = building_id AND b.phase_id = phase_id
  ))
);

CREATE INDEX project_master_plan_assets_lookup
  ON project_master_plan_assets(project_id, phase_id, building_id, asset_type, created_at DESC)
  WHERE status = 'ACTIVE';

CREATE TABLE project_payment_plan_definitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  code text NOT NULL,
  name text NOT NULL,
  version_number integer NOT NULL CHECK (version_number > 0),
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','ACTIVE','RETIRED','CANCELLED')),
  definition jsonb NOT NULL,
  effective_at timestamptz NOT NULL,
  activated_at timestamptz,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (project_id, tenant_id) REFERENCES projects(id, tenant_id) ON DELETE CASCADE,
  UNIQUE (project_id, code, version_number),
  UNIQUE (id, tenant_id, project_id),
  CHECK (status <> 'ACTIVE' OR activated_at IS NOT NULL)
);

CREATE UNIQUE INDEX project_payment_plan_active_version
  ON project_payment_plan_definitions(project_id, code)
  WHERE status = 'ACTIVE';

CREATE TABLE project_sales_windows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  phase_id uuid,
  label text NOT NULL,
  opens_at timestamptz NOT NULL,
  closes_at timestamptz,
  channels jsonb NOT NULL DEFAULT '["ONLINE","SALES_CENTER","BROKER"]'::jsonb,
  status text NOT NULL DEFAULT 'SCHEDULED' CHECK (status IN ('SCHEDULED','OPEN','CLOSED','CANCELLED')),
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (project_id, tenant_id) REFERENCES projects(id, tenant_id) ON DELETE CASCADE,
  FOREIGN KEY (phase_id, tenant_id, project_id)
    REFERENCES project_phases(id, tenant_id, project_id) ON DELETE RESTRICT,
  CHECK (closes_at IS NULL OR closes_at > opens_at)
);

CREATE INDEX project_sales_windows_schedule
  ON project_sales_windows(project_id, opens_at, closes_at, status);

CREATE TABLE project_import_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  import_type text NOT NULL CHECK (import_type IN ('HIERARCHY','UNIT_TYPES','PHYSICAL_UNITS','PRICING','PAYMENT_PLANS')),
  source_format text NOT NULL CHECK (source_format IN ('CSV','XLSX','JSON')),
  source_file_name text NOT NULL,
  source_sha256_hex text CHECK (source_sha256_hex IS NULL OR source_sha256_hex ~ '^[0-9a-fA-F]{64}$'),
  source_object_key text,
  mapping jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','VALIDATING','VALIDATED','PUBLISHING','PUBLISHED','FAILED','CANCELLED')),
  total_rows integer NOT NULL DEFAULT 0 CHECK (total_rows >= 0),
  valid_rows integer NOT NULL DEFAULT 0 CHECK (valid_rows >= 0),
  invalid_rows integer NOT NULL DEFAULT 0 CHECK (invalid_rows >= 0),
  created_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  validated_at timestamptz,
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (project_id, tenant_id) REFERENCES projects(id, tenant_id) ON DELETE CASCADE,
  UNIQUE (id, tenant_id, project_id),
  CHECK (valid_rows + invalid_rows <= total_rows),
  CHECK (status <> 'PUBLISHED' OR published_at IS NOT NULL)
);

CREATE INDEX project_import_jobs_project_created
  ON project_import_jobs(project_id, created_at DESC);

CREATE TABLE project_import_rows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  import_job_id uuid NOT NULL REFERENCES project_import_jobs(id) ON DELETE CASCADE,
  row_number integer NOT NULL CHECK (row_number > 0),
  raw_data jsonb NOT NULL,
  normalized_data jsonb,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','VALID','INVALID','PUBLISHED')),
  errors jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (import_job_id, row_number)
);

CREATE INDEX project_import_rows_review
  ON project_import_rows(import_job_id, status, row_number);

COMMIT;
