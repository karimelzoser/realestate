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
  IF NEW.allocation_lock_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM inventory_locks l
    WHERE l.id = NEW.allocation_lock_id
      AND l.tenant_id = NEW.tenant_id
      AND l.project_id = NEW.project_id
      AND l.status IN ('ACTIVE', 'CONVERTED')
  ) THEN
    RAISE EXCEPTION 'queue allocation lock must belong to the same project and remain active/converted';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_queue_allocator_state ON queue_entries;
CREATE TRIGGER trg_queue_allocator_state
BEFORE INSERT OR UPDATE OF status, allocator_user_id, allocator_assigned_at, allocation_lock_id
ON queue_entries
FOR EACH ROW EXECUTE FUNCTION preneura_validate_queue_allocator_state();

CREATE OR REPLACE FUNCTION preneura_claim_called_queue_entry(
  p_tenant_id uuid,
  p_project_id uuid,
  p_allocator_user_id uuid,
  p_now timestamptz DEFAULT now()
)
RETURNS uuid
LANGUAGE plpgsql
AS $$
DECLARE v_queue_entry_id uuid;
BEGIN
  IF EXISTS (
    SELECT 1 FROM queue_entries
    WHERE tenant_id = p_tenant_id AND project_id = p_project_id
      AND allocator_user_id = p_allocator_user_id AND status IN ('CALLED', 'LOCKED')
  ) THEN
    RAISE EXCEPTION 'allocator already has an active session';
  END IF;

  SELECT q.id INTO v_queue_entry_id
  FROM queue_entries q
  WHERE q.tenant_id = p_tenant_id AND q.project_id = p_project_id
    AND q.status = 'CALLED' AND q.allocator_user_id IS NULL
  ORDER BY q.called_at ASC NULLS LAST, q.checked_in_at ASC, q.id ASC
  FOR UPDATE SKIP LOCKED
  LIMIT 1;

  IF v_queue_entry_id IS NULL THEN RETURN NULL; END IF;

  UPDATE queue_entries
  SET allocator_user_id = p_allocator_user_id,
      allocator_assigned_at = p_now,
      updated_at = p_now
  WHERE id = v_queue_entry_id;

  INSERT INTO domain_outbox_events (
    tenant_id, project_id, aggregate_type, aggregate_id, event_type, payload, published_at, attempts
  ) VALUES (
    p_tenant_id, p_project_id, 'QUEUE_ENTRY', v_queue_entry_id, 'queue.allocator.claimed',
    jsonb_build_object('allocatorUserId', p_allocator_user_id), NULL, 0
  );

  RETURN v_queue_entry_id;
END;
$$;

-- Guard every lock insertion path, including the generic catalog endpoint.
CREATE OR REPLACE FUNCTION preneura_validate_allocator_inventory_lock()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE v_is_allocator boolean; v_queue_id uuid;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM access_role_assignments a
    WHERE a.user_id = NEW.locked_by_user_id
      AND a.role_code = 'ALLOCATOR'
      AND a.scope_type = 'PROJECT'
      AND a.tenant_id = NEW.tenant_id
      AND a.project_id = NEW.project_id
      AND a.status = 'ACTIVE'
      AND a.revoked_at IS NULL
  ) INTO v_is_allocator;

  IF NOT v_is_allocator THEN RETURN NEW; END IF;
  IF NEW.buyer_user_id IS NULL THEN
    RAISE EXCEPTION 'allocator lock requires assigned buyer';
  END IF;

  SELECT q.id INTO v_queue_id
  FROM queue_entries q
  JOIN buyer_profiles b ON b.id = q.buyer_profile_id AND b.tenant_id = q.tenant_id
  WHERE q.tenant_id = NEW.tenant_id
    AND q.project_id = NEW.project_id
    AND q.allocator_user_id = NEW.locked_by_user_id
    AND q.status = 'CALLED'
    AND q.allocation_lock_id IS NULL
    AND b.user_id = NEW.buyer_user_id
  FOR UPDATE OF q
  LIMIT 1;

  IF v_queue_id IS NULL THEN
    RAISE EXCEPTION 'allocator may lock inventory only for the claimed called buyer';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_allocator_inventory_lock_guard ON inventory_locks;
CREATE TRIGGER trg_allocator_inventory_lock_guard
BEFORE INSERT ON inventory_locks
FOR EACH ROW EXECUTE FUNCTION preneura_validate_allocator_inventory_lock();

CREATE OR REPLACE FUNCTION preneura_sync_allocator_inventory_lock()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.status = 'ACTIVE' THEN
    UPDATE queue_entries q
    SET status = 'LOCKED', allocation_lock_id = NEW.id, updated_at = now()
    FROM buyer_profiles b
    WHERE q.buyer_profile_id = b.id
      AND q.tenant_id = NEW.tenant_id
      AND q.project_id = NEW.project_id
      AND q.allocator_user_id = NEW.locked_by_user_id
      AND q.status = 'CALLED'
      AND q.allocation_lock_id IS NULL
      AND b.user_id = NEW.buyer_user_id;
  ELSIF TG_OP = 'UPDATE' AND OLD.status = 'ACTIVE' AND NEW.status IN ('RELEASED','EXPIRED') THEN
    UPDATE queue_entries
    SET status = 'CALLED', allocation_lock_id = NULL, updated_at = now()
    WHERE allocation_lock_id = NEW.id AND status = 'LOCKED';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_allocator_inventory_lock_sync_insert ON inventory_locks;
CREATE TRIGGER trg_allocator_inventory_lock_sync_insert
AFTER INSERT ON inventory_locks
FOR EACH ROW EXECUTE FUNCTION preneura_sync_allocator_inventory_lock();
DROP TRIGGER IF EXISTS trg_allocator_inventory_lock_sync_update ON inventory_locks;
CREATE TRIGGER trg_allocator_inventory_lock_sync_update
AFTER UPDATE OF status ON inventory_locks
FOR EACH ROW EXECUTE FUNCTION preneura_sync_allocator_inventory_lock();

CREATE OR REPLACE FUNCTION preneura_create_assigned_inventory_lock(
  p_tenant_id uuid,
  p_project_id uuid,
  p_allocator_user_id uuid,
  p_unit_type_id uuid,
  p_ttl_seconds integer,
  p_now timestamptz DEFAULT now()
)
RETURNS TABLE(lock_id uuid, queue_entry_id uuid, buyer_user_id uuid, inventory_slot_id uuid, expires_at timestamptz)
LANGUAGE plpgsql
AS $$
DECLARE
  v_queue queue_entries%ROWTYPE;
  v_buyer_user_id uuid;
  v_slot_id uuid;
  v_lock_id uuid;
  v_expires_at timestamptz;
BEGIN
  IF p_ttl_seconds < 60 OR p_ttl_seconds > 3600 THEN
    RAISE EXCEPTION 'allocator lock TTL must be between 60 and 3600 seconds';
  END IF;

  SELECT q.* INTO v_queue
  FROM queue_entries q
  WHERE q.tenant_id = p_tenant_id AND q.project_id = p_project_id
    AND q.allocator_user_id = p_allocator_user_id AND q.status = 'CALLED'
  FOR UPDATE LIMIT 1;
  IF v_queue.id IS NULL THEN RAISE EXCEPTION 'allocator has no claimed called queue session'; END IF;

  SELECT b.user_id INTO v_buyer_user_id
  FROM buyer_profiles b
  WHERE b.id = v_queue.buyer_profile_id AND b.tenant_id = p_tenant_id AND b.status = 'ACTIVE';
  IF v_buyer_user_id IS NULL THEN RAISE EXCEPTION 'assigned buyer is not active'; END IF;

  UPDATE inventory_locks AS il
  SET status = 'EXPIRED', released_at = p_now, release_reason = 'TTL expired', updated_at = p_now
  WHERE il.tenant_id = p_tenant_id AND il.project_id = p_project_id
    AND il.status = 'ACTIVE' AND il.expires_at <= p_now;

  SELECT s.id INTO v_slot_id
  FROM inventory_slots s
  WHERE s.tenant_id = p_tenant_id AND s.project_id = p_project_id
    AND s.unit_type_id = p_unit_type_id AND s.state = 'AVAILABLE'
    AND NOT EXISTS (
      SELECT 1 FROM inventory_locks l
      WHERE l.inventory_slot_id = s.id AND l.status = 'ACTIVE' AND l.expires_at > p_now
    )
  ORDER BY s.created_at ASC, s.id ASC
  FOR UPDATE SKIP LOCKED LIMIT 1;
  IF v_slot_id IS NULL THEN RETURN; END IF;

  v_expires_at := p_now + make_interval(secs => p_ttl_seconds);
  INSERT INTO inventory_locks (
    tenant_id, project_id, unit_type_id, inventory_slot_id, buyer_user_id,
    locked_by_user_id, status, expires_at, released_at, converted_at, release_reason
  ) VALUES (
    p_tenant_id, p_project_id, p_unit_type_id, v_slot_id, v_buyer_user_id,
    p_allocator_user_id, 'ACTIVE', v_expires_at, NULL, NULL, NULL
  ) RETURNING id INTO v_lock_id;

  INSERT INTO domain_outbox_events (
    tenant_id, project_id, aggregate_type, aggregate_id, event_type, payload, published_at, attempts
  ) VALUES (
    p_tenant_id, p_project_id, 'INVENTORY_LOCK', v_lock_id, 'inventory.allocator_lock.created',
    jsonb_build_object('unitTypeId', p_unit_type_id, 'buyerUserId', v_buyer_user_id,
      'allocatorUserId', p_allocator_user_id, 'queueEntryId', v_queue.id, 'expiresAt', v_expires_at),
    NULL, 0
  );

  RETURN QUERY SELECT v_lock_id, v_queue.id, v_buyer_user_id, v_slot_id, v_expires_at;
END;
$$;

CREATE OR REPLACE FUNCTION preneura_validate_reservation_allocator_ownership()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE v_queue queue_entries%ROWTYPE;
BEGIN
  SELECT q.* INTO v_queue
  FROM queue_entries q
  WHERE q.id = NEW.queue_entry_id AND q.tenant_id = NEW.tenant_id AND q.project_id = NEW.project_id;
  IF v_queue.id IS NULL THEN RAISE EXCEPTION 'reservation queue entry is not in the same project'; END IF;

  IF v_queue.allocator_user_id IS NOT NULL THEN
    IF NEW.reserved_by <> v_queue.allocator_user_id THEN
      RAISE EXCEPTION 'reservation must be completed by the assigned allocator';
    END IF;
    IF v_queue.allocation_lock_id IS NULL OR NEW.inventory_lock_id <> v_queue.allocation_lock_id THEN
      RAISE EXCEPTION 'reservation must use the assigned allocator queue lock';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_reservation_allocator_ownership ON reservations;
CREATE TRIGGER trg_reservation_allocator_ownership
BEFORE INSERT ON reservations
FOR EACH ROW EXECUTE FUNCTION preneura_validate_reservation_allocator_ownership();

UPDATE platform_runtime_contract
SET schema_version = 40,
    minimum_runtime_version = LEAST(minimum_runtime_version, 39),
    migration_marker = '0040_allocator_assignment_authority',
    updated_at = now()
WHERE singleton_key = 'production';
