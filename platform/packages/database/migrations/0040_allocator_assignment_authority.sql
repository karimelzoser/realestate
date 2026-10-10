-- Gate 5: Receptionist / Allocator role authority.
-- Queue dispatch remains Receptionist-owned; Allocators must atomically claim a CALLED entry
-- before they may lock inventory or convert that lock to a reservation.

ALTER TABLE queue_entries
  ADD COLUMN IF NOT EXISTS allocator_user_id uuid NULL REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS allocator_assigned_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS allocation_lock_id uuid NULL REFERENCES inventory_locks(id);

CREATE INDEX IF NOT EXISTS idx_queue_allocator_active
  ON queue_entries (tenant_id, project_id, allocator_user_id, status, called_at, id)
  WHERE allocator_user_id IS NOT NULL AND status IN ('CALLED', 'LOCKED');

CREATE UNIQUE INDEX IF NOT EXISTS uq_queue_allocator_one_active_session
  ON queue_entries (tenant_id, project_id, allocator_user_id)
  WHERE allocator_user_id IS NOT NULL AND status IN ('CALLED', 'LOCKED');

CREATE OR REPLACE FUNCTION preneura_validate_queue_allocator_state()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status = 'WAITING' AND (NEW.allocator_user_id IS NOT NULL OR NEW.allocation_lock_id IS NOT NULL) THEN
    RAISE EXCEPTION 'WAITING queue entries cannot have allocator assignment or allocation lock';
  END IF;

  IF NEW.allocator_user_id IS NULL AND NEW.allocator_assigned_at IS NOT NULL THEN
    RAISE EXCEPTION 'allocator_assigned_at requires allocator_user_id';
  END IF;

  IF NEW.allocator_user_id IS NOT NULL AND NEW.allocator_assigned_at IS NULL THEN
    RAISE EXCEPTION 'allocator_user_id requires allocator_assigned_at';
  END IF;

  IF NEW.status = 'LOCKED' AND (NEW.allocator_user_id IS NULL OR NEW.allocation_lock_id IS NULL) THEN
    RAISE EXCEPTION 'LOCKED queue entries require allocator assignment and inventory lock';
  END IF;

  IF NEW.allocation_lock_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1
      FROM inventory_locks l
      WHERE l.id = NEW.allocation_lock_id
        AND l.tenant_id = NEW.tenant_id
        AND l.project_id = NEW.project_id
        AND l.status IN ('ACTIVE', 'CONVERTED')
    ) THEN
      RAISE EXCEPTION 'queue allocation lock must belong to the same project and remain active/converted';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_queue_allocator_state ON queue_entries;
CREATE TRIGGER trg_queue_allocator_state
BEFORE INSERT OR UPDATE OF status, allocator_user_id, allocator_assigned_at, allocation_lock_id
ON queue_entries
FOR EACH ROW
EXECUTE FUNCTION preneura_validate_queue_allocator_state();

CREATE OR REPLACE FUNCTION preneura_claim_called_queue_entry(
  p_tenant_id uuid,
  p_project_id uuid,
  p_allocator_user_id uuid,
  p_now timestamptz DEFAULT now()
)
RETURNS uuid
LANGUAGE plpgsql
AS $$
DECLARE
  v_queue_entry_id uuid;
BEGIN
  IF EXISTS (
    SELECT 1 FROM queue_entries
    WHERE tenant_id = p_tenant_id
      AND project_id = p_project_id
      AND allocator_user_id = p_allocator_user_id
      AND status IN ('CALLED', 'LOCKED')
  ) THEN
    RAISE EXCEPTION 'allocator already has an active session';
  END IF;

  SELECT q.id
    INTO v_queue_entry_id
  FROM queue_entries q
  WHERE q.tenant_id = p_tenant_id
    AND q.project_id = p_project_id
    AND q.status = 'CALLED'
    AND q.allocator_user_id IS NULL
  ORDER BY q.called_at ASC NULLS LAST, q.checked_in_at ASC, q.id ASC
  FOR UPDATE SKIP LOCKED
  LIMIT 1;

  IF v_queue_entry_id IS NULL THEN
    RETURN NULL;
  END IF;

  UPDATE queue_entries
  SET allocator_user_id = p_allocator_user_id,
      allocator_assigned_at = p_now,
      updated_at = p_now
  WHERE id = v_queue_entry_id;

  RETURN v_queue_entry_id;
END;
$$;

CREATE OR REPLACE FUNCTION preneura_bind_allocator_lock(
  p_tenant_id uuid,
  p_project_id uuid,
  p_queue_entry_id uuid,
  p_allocator_user_id uuid,
  p_lock_id uuid,
  p_now timestamptz DEFAULT now()
)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE queue_entries q
  SET status = 'LOCKED',
      allocation_lock_id = p_lock_id,
      updated_at = p_now
  WHERE q.id = p_queue_entry_id
    AND q.tenant_id = p_tenant_id
    AND q.project_id = p_project_id
    AND q.status = 'CALLED'
    AND q.allocator_user_id = p_allocator_user_id
    AND EXISTS (
      SELECT 1
      FROM inventory_locks l
      JOIN buyer_profiles b
        ON b.user_id = l.buyer_user_id
       AND b.tenant_id = l.tenant_id
      WHERE l.id = p_lock_id
        AND l.tenant_id = p_tenant_id
        AND l.project_id = p_project_id
        AND l.locked_by_user_id = p_allocator_user_id
        AND l.status = 'ACTIVE'
        AND b.id = q.buyer_profile_id
    );

  IF NOT FOUND THEN
    RAISE EXCEPTION 'allocator lock does not match the assigned queue buyer';
  END IF;
END;
$$;

-- Advance the runtime compatibility contract. Schema 40 remains compatible with runtime 39
-- because this is additive until application runtime 40 is deployed.
UPDATE platform_runtime_contract
SET schema_version = 40,
    minimum_runtime_version = LEAST(minimum_runtime_version, 39),
    migration_marker = '0040_allocator_assignment_authority',
    updated_at = now()
WHERE singleton_key = 'production';
