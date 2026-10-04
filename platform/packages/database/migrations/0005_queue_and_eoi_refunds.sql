BEGIN;

ALTER TABLE buyer_eois
  ADD CONSTRAINT buyer_eois_scoped_identity
  UNIQUE (id, tenant_id, project_id, buyer_profile_id);

ALTER TABLE queue_entries
  ADD CONSTRAINT queue_entries_eoi_scope_fk
  FOREIGN KEY (eoi_id, tenant_id, project_id, buyer_profile_id)
  REFERENCES buyer_eois(id, tenant_id, project_id, buyer_profile_id)
  ON DELETE RESTRICT;

ALTER TABLE inventory_locks
  ADD CONSTRAINT inventory_locks_scoped_identity
  UNIQUE (id, tenant_id, project_id, unit_type_id, inventory_slot_id);

ALTER TABLE reservations
  ADD CONSTRAINT reservations_lock_scope_fk
  FOREIGN KEY (inventory_lock_id, tenant_id, project_id, unit_type_id, inventory_slot_id)
  REFERENCES inventory_locks(id, tenant_id, project_id, unit_type_id, inventory_slot_id)
  ON DELETE RESTRICT;

CREATE TABLE IF NOT EXISTS eoi_refund_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  eoi_id uuid NOT NULL,
  buyer_profile_id uuid NOT NULL,
  refund_policy_id uuid NOT NULL,
  stage text NOT NULL CHECK (stage IN ('BEFORE_RESERVATION','AFTER_RESERVATION_BEFORE_CONTRACT','AFTER_CONTRACT')),
  eoi_status_at_request text NOT NULL CHECK (eoi_status_at_request IN ('PAID','APPLIED')),
  original_eoi_amount numeric(18,2) NOT NULL CHECK (original_eoi_amount >= 0),
  refund_percent numeric(5,2) NOT NULL CHECK (refund_percent BETWEEN 0 AND 100),
  processing_fee numeric(18,2) NOT NULL CHECK (processing_fee >= 0),
  requested_amount numeric(18,2) NOT NULL CHECK (requested_amount >= 0),
  currency char(3) NOT NULL,
  status text NOT NULL DEFAULT 'REQUESTED' CHECK (status IN ('REQUESTED','APPROVED','REJECTED','PAID','CANCELLED')),
  requested_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  requested_at timestamptz NOT NULL DEFAULT now(),
  reviewed_by uuid REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  paid_at timestamptz,
  decision_note text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (eoi_id, tenant_id, project_id, buyer_profile_id)
    REFERENCES buyer_eois(id, tenant_id, project_id, buyer_profile_id) ON DELETE RESTRICT,
  FOREIGN KEY (refund_policy_id, tenant_id, project_id)
    REFERENCES eoi_refund_policies(id, tenant_id, project_id) ON DELETE RESTRICT,
  CHECK (status NOT IN ('APPROVED','REJECTED') OR reviewed_at IS NOT NULL),
  CHECK (status <> 'PAID' OR paid_at IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS eoi_refund_requests_one_live
  ON eoi_refund_requests(eoi_id)
  WHERE status IN ('REQUESTED','APPROVED');

CREATE INDEX IF NOT EXISTS eoi_refund_requests_project_status
  ON eoi_refund_requests(project_id, status, requested_at);

COMMIT;
