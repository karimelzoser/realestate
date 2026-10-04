BEGIN;

CREATE TABLE IF NOT EXISTS buyer_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE','BLOCKED')),
  source text NOT NULL DEFAULT 'DIRECT' CHECK (source IN ('DIRECT','BROKER','INTERNAL')),
  broker_company_id uuid,
  broker_agent_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (broker_company_id, tenant_id)
    REFERENCES broker_companies(id, tenant_id) ON DELETE SET NULL,
  UNIQUE (tenant_id, user_id),
  UNIQUE (id, tenant_id),
  CHECK (
    (source = 'BROKER' AND broker_company_id IS NOT NULL)
    OR (source <> 'BROKER')
  )
);

CREATE INDEX IF NOT EXISTS buyer_profiles_broker
  ON buyer_profiles(tenant_id, broker_company_id, broker_agent_user_id)
  WHERE source = 'BROKER' AND status = 'ACTIVE';

CREATE TABLE IF NOT EXISTS eoi_refund_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  version_number integer NOT NULL CHECK (version_number > 0),
  name text NOT NULL,
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','ACTIVE','RETIRED','CANCELLED')),
  eoi_amount numeric(18,2) NOT NULL CHECK (eoi_amount >= 0),
  currency char(3) NOT NULL DEFAULT 'EGP',
  before_reservation_refund_percent numeric(5,2) NOT NULL DEFAULT 100 CHECK (before_reservation_refund_percent BETWEEN 0 AND 100),
  after_reservation_before_contract_refund_percent numeric(5,2) NOT NULL DEFAULT 100 CHECK (after_reservation_before_contract_refund_percent BETWEEN 0 AND 100),
  after_contract_refund_percent numeric(5,2) NOT NULL DEFAULT 0 CHECK (after_contract_refund_percent BETWEEN 0 AND 100),
  processing_fee numeric(18,2) NOT NULL DEFAULT 0 CHECK (processing_fee >= 0),
  effective_at timestamptz NOT NULL,
  published_at timestamptz,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  published_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (project_id, tenant_id)
    REFERENCES projects(id, tenant_id) ON DELETE CASCADE,
  UNIQUE (project_id, version_number),
  UNIQUE (id, tenant_id, project_id),
  CHECK (status <> 'ACTIVE' OR published_at IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS eoi_refund_policies_active
  ON eoi_refund_policies(project_id, effective_at DESC)
  WHERE status = 'ACTIVE';

CREATE TABLE IF NOT EXISTS buyer_eois (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  buyer_profile_id uuid NOT NULL,
  refund_policy_id uuid NOT NULL,
  amount numeric(18,2) NOT NULL CHECK (amount >= 0),
  currency char(3) NOT NULL,
  status text NOT NULL DEFAULT 'PAYMENT_PENDING' CHECK (status IN (
    'PAYMENT_PENDING','PAID','APPLIED','REFUND_REQUESTED','REFUNDED','CANCELLED','EXPIRED'
  )),
  payment_reference text,
  paid_at timestamptz,
  applied_at timestamptz,
  refund_requested_at timestamptz,
  refunded_at timestamptz,
  expires_at timestamptz,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (buyer_profile_id, tenant_id)
    REFERENCES buyer_profiles(id, tenant_id) ON DELETE RESTRICT,
  FOREIGN KEY (refund_policy_id, tenant_id, project_id)
    REFERENCES eoi_refund_policies(id, tenant_id, project_id) ON DELETE RESTRICT,
  CHECK (status <> 'PAID' OR paid_at IS NOT NULL),
  CHECK (status <> 'APPLIED' OR applied_at IS NOT NULL),
  CHECK (status <> 'REFUND_REQUESTED' OR refund_requested_at IS NOT NULL),
  CHECK (status <> 'REFUNDED' OR refunded_at IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS buyer_eois_one_live_per_project
  ON buyer_eois(buyer_profile_id, project_id)
  WHERE status IN ('PAYMENT_PENDING','PAID','APPLIED','REFUND_REQUESTED');

CREATE INDEX IF NOT EXISTS buyer_eois_project_status
  ON buyer_eois(project_id, status, created_at);

CREATE TABLE IF NOT EXISTS queue_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  buyer_profile_id uuid NOT NULL,
  eoi_id uuid NOT NULL REFERENCES buyer_eois(id) ON DELETE RESTRICT,
  channel text NOT NULL DEFAULT 'ONSITE' CHECK (channel IN ('ONSITE','ONLINE','BROKER')),
  priority_group text NOT NULL DEFAULT 'STANDARD' CHECK (priority_group IN ('STANDARD','VIP','RECOVERY')),
  priority_score integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'WAITING' CHECK (status IN ('WAITING','CALLED','LOCKED','COMPLETED','LEFT','CANCELLED')),
  checked_in_at timestamptz NOT NULL DEFAULT now(),
  called_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (buyer_profile_id, tenant_id)
    REFERENCES buyer_profiles(id, tenant_id) ON DELETE RESTRICT,
  FOREIGN KEY (project_id, tenant_id)
    REFERENCES projects(id, tenant_id) ON DELETE CASCADE,
  UNIQUE (id, tenant_id, project_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS queue_entries_one_live_per_buyer
  ON queue_entries(buyer_profile_id, project_id)
  WHERE status IN ('WAITING','CALLED','LOCKED');

CREATE INDEX IF NOT EXISTS queue_entries_dispatch
  ON queue_entries(project_id, priority_group DESC, priority_score DESC, checked_in_at ASC, id ASC)
  WHERE status = 'WAITING';

CREATE TABLE IF NOT EXISTS reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  buyer_profile_id uuid NOT NULL,
  queue_entry_id uuid NOT NULL,
  inventory_lock_id uuid NOT NULL UNIQUE REFERENCES inventory_locks(id) ON DELETE RESTRICT,
  inventory_slot_id uuid NOT NULL,
  unit_type_id uuid NOT NULL,
  pricing_version_id uuid,
  quoted_total numeric(18,2),
  currency char(3) NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','CANCELLED','COMPLETED')),
  reserved_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  reserved_at timestamptz NOT NULL DEFAULT now(),
  cancelled_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (buyer_profile_id, tenant_id)
    REFERENCES buyer_profiles(id, tenant_id) ON DELETE RESTRICT,
  FOREIGN KEY (queue_entry_id, tenant_id, project_id)
    REFERENCES queue_entries(id, tenant_id, project_id) ON DELETE RESTRICT,
  FOREIGN KEY (inventory_slot_id, tenant_id, project_id, unit_type_id)
    REFERENCES inventory_slots(id, tenant_id, project_id, unit_type_id) ON DELETE RESTRICT,
  FOREIGN KEY (pricing_version_id, tenant_id, project_id)
    REFERENCES pricing_versions(id, tenant_id, project_id) ON DELETE RESTRICT,
  UNIQUE (id, tenant_id, project_id),
  CHECK (status <> 'CANCELLED' OR cancelled_at IS NOT NULL),
  CHECK (status <> 'COMPLETED' OR completed_at IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS reservations_one_active_per_slot
  ON reservations(inventory_slot_id)
  WHERE status = 'ACTIVE';

CREATE INDEX IF NOT EXISTS reservations_buyer_project
  ON reservations(buyer_profile_id, project_id, reserved_at DESC);

CREATE TABLE IF NOT EXISTS transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  reservation_id uuid NOT NULL UNIQUE,
  buyer_profile_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'IN_PROGRESS' CHECK (status IN ('IN_PROGRESS','READY_FOR_COMPLETION','COMPLETED','CANCELLED')),
  opened_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (reservation_id, tenant_id, project_id)
    REFERENCES reservations(id, tenant_id, project_id) ON DELETE RESTRICT,
  FOREIGN KEY (buyer_profile_id, tenant_id)
    REFERENCES buyer_profiles(id, tenant_id) ON DELETE RESTRICT,
  UNIQUE (id, tenant_id, project_id),
  CHECK (status <> 'COMPLETED' OR completed_at IS NOT NULL),
  CHECK (status <> 'CANCELLED' OR cancelled_at IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS transactions_project_status
  ON transactions(project_id, status, opened_at);

CREATE TABLE IF NOT EXISTS transaction_milestones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id uuid NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  code text NOT NULL CHECK (code IN (
    'BUYER_DOCUMENTS_COMPLETE',
    'DOWN_PAYMENT_RECEIVED',
    'CHEQUES_RECEIVED',
    'CONTRACT_GENERATED',
    'CONTRACT_SIGNED',
    'CONTRACT_STAMPED'
  )),
  label text NOT NULL,
  weight_percent numeric(5,2) NOT NULL CHECK (weight_percent > 0 AND weight_percent <= 100),
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','COMPLETED','WAIVED','BLOCKED')),
  completed_at timestamptz,
  completed_by uuid REFERENCES users(id) ON DELETE SET NULL,
  evidence_document_id uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (transaction_id, code),
  CHECK (status <> 'COMPLETED' OR completed_at IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS transaction_milestones_progress
  ON transaction_milestones(transaction_id, status);

CREATE TABLE IF NOT EXISTS transaction_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id uuid NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  event_type text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS transaction_events_timeline
  ON transaction_events(transaction_id, created_at ASC, id ASC);

COMMIT;
