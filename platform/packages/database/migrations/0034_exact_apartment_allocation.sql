BEGIN;

-- EOI is explicitly a unit-type commitment. Historical applied EOIs can be
-- backfilled through their reservation/queue relationship; unresolved legacy
-- EOIs remain nullable until remediated, but every new EOI must carry a type.
ALTER TABLE buyer_eois
  ADD COLUMN unit_type_id uuid;

ALTER TABLE buyer_eois
  ADD CONSTRAINT buyer_eois_unit_type_fk
  FOREIGN KEY (unit_type_id, tenant_id, project_id)
  REFERENCES catalog_unit_types(id, tenant_id, project_id)
  ON DELETE RESTRICT;

UPDATE buyer_eois e
SET unit_type_id = r.unit_type_id,
    updated_at = now()
FROM queue_entries q
JOIN reservations r
  ON r.queue_entry_id = q.id
 AND r.tenant_id = q.tenant_id
 AND r.project_id = q.project_id
WHERE q.eoi_id = e.id
  AND q.tenant_id = e.tenant_id
  AND q.project_id = e.project_id
  AND e.unit_type_id IS NULL;

CREATE INDEX buyer_eois_project_unit_type_status
  ON buyer_eois(project_id, unit_type_id, status, created_at)
  WHERE unit_type_id IS NOT NULL;

CREATE OR REPLACE FUNCTION enforce_buyer_eoi_unit_type()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.unit_type_id IS NULL THEN
    RAISE EXCEPTION 'New EOI must select a unit type';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF OLD.unit_type_id IS NOT NULL AND NEW.unit_type_id IS DISTINCT FROM OLD.unit_type_id THEN
      RAISE EXCEPTION 'EOI unit type is immutable once selected';
    END IF;
    IF OLD.unit_type_id IS NULL AND NEW.unit_type_id IS NULL THEN
      RETURN NEW;
    END IF;
  END IF;

  IF NEW.unit_type_id IS NOT NULL AND (
    TG_OP = 'INSERT' OR OLD.unit_type_id IS DISTINCT FROM NEW.unit_type_id
  ) THEN
    IF NOT EXISTS (
      SELECT 1
      FROM catalog_unit_types ut
      WHERE ut.id = NEW.unit_type_id
        AND ut.tenant_id = NEW.tenant_id
        AND ut.project_id = NEW.project_id
        AND ut.status = 'ACTIVE'
    ) THEN
      RAISE EXCEPTION 'EOI unit type is not active in this project';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_buyer_eoi_unit_type
BEFORE INSERT OR UPDATE OF unit_type_id
ON buyer_eois
FOR EACH ROW
EXECUTE FUNCTION enforce_buyer_eoi_unit_type();

-- Exact physical unit identity is copied onto the lock itself. The slot remains
-- the availability projection, while physical_unit_id is the human/product
-- commitment boundary selected during allocation.
ALTER TABLE inventory_locks
  ADD COLUMN physical_unit_id uuid;

UPDATE inventory_locks l
SET physical_unit_id = s.physical_unit_id
FROM inventory_slots s
WHERE s.id = l.inventory_slot_id
  AND s.tenant_id = l.tenant_id
  AND s.project_id = l.project_id
  AND s.unit_type_id = l.unit_type_id
  AND l.physical_unit_id IS NULL
  AND s.physical_unit_id IS NOT NULL;

ALTER TABLE inventory_locks
  ADD CONSTRAINT inventory_locks_physical_unit_fk
  FOREIGN KEY (physical_unit_id, tenant_id, project_id, unit_type_id)
  REFERENCES physical_units(id, tenant_id, project_id, unit_type_id)
  ON DELETE RESTRICT;

CREATE UNIQUE INDEX inventory_locks_one_active_per_physical_unit
  ON inventory_locks(physical_unit_id)
  WHERE status = 'ACTIVE' AND physical_unit_id IS NOT NULL;

CREATE UNIQUE INDEX inventory_locks_one_active_per_buyer_project
  ON inventory_locks(project_id, buyer_user_id)
  WHERE status = 'ACTIVE' AND buyer_user_id IS NOT NULL;

CREATE INDEX inventory_locks_physical_unit_history
  ON inventory_locks(project_id, physical_unit_id, created_at DESC)
  WHERE physical_unit_id IS NOT NULL;

CREATE OR REPLACE FUNCTION enforce_exact_inventory_lock()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  slot_physical_unit_id uuid;
  slot_unit_type_id uuid;
  unit_status text;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
       OR NEW.project_id IS DISTINCT FROM OLD.project_id
       OR NEW.unit_type_id IS DISTINCT FROM OLD.unit_type_id
       OR NEW.inventory_slot_id IS DISTINCT FROM OLD.inventory_slot_id
       OR NEW.physical_unit_id IS DISTINCT FROM OLD.physical_unit_id
       OR NEW.buyer_user_id IS DISTINCT FROM OLD.buyer_user_id THEN
      RAISE EXCEPTION 'Inventory lock identity is immutable';
    END IF;
    -- Legacy anonymous locks may still be expired/released during migration.
    RETURN NEW;
  END IF;

  IF NEW.physical_unit_id IS NULL THEN
    RAISE EXCEPTION 'New inventory lock must select an exact physical unit';
  END IF;

  SELECT s.physical_unit_id, s.unit_type_id
  INTO slot_physical_unit_id, slot_unit_type_id
  FROM inventory_slots s
  WHERE s.id = NEW.inventory_slot_id
    AND s.tenant_id = NEW.tenant_id
    AND s.project_id = NEW.project_id;

  IF NOT FOUND OR slot_physical_unit_id IS DISTINCT FROM NEW.physical_unit_id THEN
    RAISE EXCEPTION 'Inventory slot is not mapped to the selected physical unit';
  END IF;

  IF slot_unit_type_id IS DISTINCT FROM NEW.unit_type_id THEN
    RAISE EXCEPTION 'Inventory slot unit type does not match lock unit type';
  END IF;

  SELECT u.status
  INTO unit_status
  FROM physical_units u
  JOIN project_buildings b
    ON b.id = u.building_id
   AND b.tenant_id = u.tenant_id
   AND b.project_id = u.project_id
  JOIN project_floors f
    ON f.id = u.floor_id
   AND f.tenant_id = u.tenant_id
   AND f.project_id = u.project_id
   AND f.building_id = u.building_id
  WHERE u.id = NEW.physical_unit_id
    AND u.tenant_id = NEW.tenant_id
    AND u.project_id = NEW.project_id
    AND u.unit_type_id = NEW.unit_type_id
    AND b.status = 'ACTIVE'
    AND f.status = 'ACTIVE';

  IF unit_status IS DISTINCT FROM 'ACTIVE' THEN
    RAISE EXCEPTION 'Selected physical unit is not active for allocation';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_exact_inventory_lock
BEFORE INSERT OR UPDATE OF tenant_id, project_id, unit_type_id, inventory_slot_id, physical_unit_id, buyer_user_id
ON inventory_locks
FOR EACH ROW
EXECUTE FUNCTION enforce_exact_inventory_lock();

-- Reservation snapshots the exact physical apartment independently of future
-- hierarchy display changes. Historical rows are backfilled where a slot map is
-- already known.
ALTER TABLE reservations
  ADD COLUMN physical_unit_id uuid;

UPDATE reservations r
SET physical_unit_id = s.physical_unit_id,
    updated_at = now()
FROM inventory_slots s
WHERE s.id = r.inventory_slot_id
  AND s.tenant_id = r.tenant_id
  AND s.project_id = r.project_id
  AND s.unit_type_id = r.unit_type_id
  AND r.physical_unit_id IS NULL
  AND s.physical_unit_id IS NOT NULL;

ALTER TABLE reservations
  ADD CONSTRAINT reservations_physical_unit_fk
  FOREIGN KEY (physical_unit_id, tenant_id, project_id, unit_type_id)
  REFERENCES physical_units(id, tenant_id, project_id, unit_type_id)
  ON DELETE RESTRICT;

CREATE UNIQUE INDEX reservations_one_active_per_physical_unit
  ON reservations(physical_unit_id)
  WHERE status = 'ACTIVE' AND physical_unit_id IS NOT NULL;

CREATE INDEX reservations_physical_unit_history
  ON reservations(project_id, physical_unit_id, reserved_at DESC)
  WHERE physical_unit_id IS NOT NULL;

CREATE OR REPLACE FUNCTION enforce_exact_reservation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  lock_row record;
  eoi_unit_type_id uuid;
  slot_physical_unit_id uuid;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
       OR NEW.project_id IS DISTINCT FROM OLD.project_id
       OR NEW.unit_type_id IS DISTINCT FROM OLD.unit_type_id
       OR NEW.inventory_slot_id IS DISTINCT FROM OLD.inventory_slot_id
       OR NEW.inventory_lock_id IS DISTINCT FROM OLD.inventory_lock_id
       OR NEW.physical_unit_id IS DISTINCT FROM OLD.physical_unit_id
       OR NEW.queue_entry_id IS DISTINCT FROM OLD.queue_entry_id
       OR NEW.buyer_profile_id IS DISTINCT FROM OLD.buyer_profile_id THEN
      RAISE EXCEPTION 'Reservation allocation identity is immutable';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.physical_unit_id IS NULL THEN
    RAISE EXCEPTION 'New reservation must reference an exact physical unit';
  END IF;

  SELECT l.physical_unit_id, l.inventory_slot_id, l.unit_type_id, l.status
  INTO lock_row
  FROM inventory_locks l
  WHERE l.id = NEW.inventory_lock_id
    AND l.tenant_id = NEW.tenant_id
    AND l.project_id = NEW.project_id;

  IF NOT FOUND
     OR lock_row.physical_unit_id IS DISTINCT FROM NEW.physical_unit_id
     OR lock_row.inventory_slot_id IS DISTINCT FROM NEW.inventory_slot_id
     OR lock_row.unit_type_id IS DISTINCT FROM NEW.unit_type_id
     OR lock_row.status <> 'CONVERTED' THEN
    RAISE EXCEPTION 'Reservation must match the converted exact-unit lock';
  END IF;

  SELECT s.physical_unit_id
  INTO slot_physical_unit_id
  FROM inventory_slots s
  WHERE s.id = NEW.inventory_slot_id
    AND s.tenant_id = NEW.tenant_id
    AND s.project_id = NEW.project_id
    AND s.unit_type_id = NEW.unit_type_id;

  IF slot_physical_unit_id IS DISTINCT FROM NEW.physical_unit_id THEN
    RAISE EXCEPTION 'Reservation slot does not match selected physical unit';
  END IF;

  SELECT e.unit_type_id
  INTO eoi_unit_type_id
  FROM queue_entries q
  JOIN buyer_eois e
    ON e.id = q.eoi_id
   AND e.tenant_id = q.tenant_id
   AND e.project_id = q.project_id
  WHERE q.id = NEW.queue_entry_id
    AND q.tenant_id = NEW.tenant_id
    AND q.project_id = NEW.project_id
    AND q.buyer_profile_id = NEW.buyer_profile_id;

  IF eoi_unit_type_id IS NULL OR eoi_unit_type_id IS DISTINCT FROM NEW.unit_type_id THEN
    RAISE EXCEPTION 'Reservation exact unit does not match EOI unit type';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_exact_reservation
BEFORE INSERT OR UPDATE OF tenant_id, project_id, buyer_profile_id, queue_entry_id,
  inventory_lock_id, inventory_slot_id, unit_type_id, physical_unit_id
ON reservations
FOR EACH ROW
EXECUTE FUNCTION enforce_exact_reservation();

-- Atomic exact-apartment lock command. Authorization remains in the API; this
-- function owns the concurrency and business-state transition once authorized.
CREATE OR REPLACE FUNCTION preneura_lock_exact_physical_unit(
  p_tenant_id uuid,
  p_project_id uuid,
  p_queue_entry_id uuid,
  p_physical_unit_id uuid,
  p_locked_by_user_id uuid,
  p_ttl_seconds integer,
  p_now timestamptz DEFAULT now()
)
RETURNS TABLE (
  lock_id uuid,
  buyer_user_id uuid,
  unit_type_id uuid,
  physical_unit_id uuid,
  inventory_slot_id uuid,
  expires_at timestamptz,
  display_reference text,
  internal_reference text,
  building_id uuid,
  building_code text,
  building_name text,
  floor_id uuid,
  floor_code text,
  floor_name text
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_buyer_profile_id uuid;
  v_buyer_user_id uuid;
  v_eoi_id uuid;
  v_eoi_status text;
  v_eoi_unit_type_id uuid;
  v_queue_status text;
  v_slot_id uuid;
  v_unit_type_id uuid;
  v_display_reference text;
  v_internal_reference text;
  v_building_id uuid;
  v_building_code text;
  v_building_name text;
  v_floor_id uuid;
  v_floor_code text;
  v_floor_name text;
  v_lock_id uuid;
  v_expires_at timestamptz;
  v_existing record;
BEGIN
  IF p_ttl_seconds < 30 OR p_ttl_seconds > 900 THEN
    RAISE EXCEPTION 'Exact-unit lock TTL must be between 30 and 900 seconds';
  END IF;

  -- Expire stale locks before uniqueness checks. Historical evidence is kept.
  UPDATE inventory_locks
  SET status = 'EXPIRED',
      released_at = p_now,
      release_reason = 'TTL expired',
      updated_at = p_now
  WHERE tenant_id = p_tenant_id
    AND project_id = p_project_id
    AND status = 'ACTIVE'
    AND expires_at <= p_now;

  SELECT
    q.buyer_profile_id,
    b.user_id,
    q.eoi_id,
    q.status,
    e.status,
    e.unit_type_id
  INTO
    v_buyer_profile_id,
    v_buyer_user_id,
    v_eoi_id,
    v_queue_status,
    v_eoi_status,
    v_eoi_unit_type_id
  FROM queue_entries q
  JOIN buyer_profiles b
    ON b.id = q.buyer_profile_id
   AND b.tenant_id = q.tenant_id
   AND b.status = 'ACTIVE'
  JOIN buyer_eois e
    ON e.id = q.eoi_id
   AND e.tenant_id = q.tenant_id
   AND e.project_id = q.project_id
   AND e.buyer_profile_id = q.buyer_profile_id
  WHERE q.id = p_queue_entry_id
    AND q.tenant_id = p_tenant_id
    AND q.project_id = p_project_id
  FOR UPDATE OF q, e;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Allocation queue entry not found';
  END IF;
  IF v_queue_status NOT IN ('CALLED','LOCKED') THEN
    RAISE EXCEPTION 'Buyer must be called before exact-unit allocation';
  END IF;
  IF v_eoi_status <> 'PAID' THEN
    RAISE EXCEPTION 'A paid unapplied EOI is required for allocation';
  END IF;
  IF v_eoi_unit_type_id IS NULL THEN
    RAISE EXCEPTION 'EOI has no unit type and requires remediation before allocation';
  END IF;

  SELECT l.id, l.physical_unit_id, l.inventory_slot_id, l.unit_type_id, l.expires_at
  INTO v_existing
  FROM inventory_locks l
  WHERE l.tenant_id = p_tenant_id
    AND l.project_id = p_project_id
    AND l.buyer_user_id = v_buyer_user_id
    AND l.status = 'ACTIVE'
    AND l.expires_at > p_now
  FOR UPDATE;

  IF FOUND THEN
    IF v_existing.physical_unit_id = p_physical_unit_id THEN
      RETURN QUERY
      SELECT
        v_existing.id,
        v_buyer_user_id,
        v_existing.unit_type_id,
        v_existing.physical_unit_id,
        v_existing.inventory_slot_id,
        v_existing.expires_at,
        u.display_reference,
        u.internal_reference,
        bld.id,
        bld.code,
        bld.name,
        fl.id,
        fl.code,
        fl.name
      FROM physical_units u
      JOIN project_buildings bld ON bld.id = u.building_id
      JOIN project_floors fl ON fl.id = u.floor_id
      WHERE u.id = v_existing.physical_unit_id;
      RETURN;
    END IF;
    RAISE EXCEPTION 'Buyer already holds another active exact-unit lock';
  END IF;

  SELECT
    s.id,
    u.unit_type_id,
    u.display_reference,
    u.internal_reference,
    bld.id,
    bld.code,
    bld.name,
    fl.id,
    fl.code,
    fl.name
  INTO
    v_slot_id,
    v_unit_type_id,
    v_display_reference,
    v_internal_reference,
    v_building_id,
    v_building_code,
    v_building_name,
    v_floor_id,
    v_floor_code,
    v_floor_name
  FROM physical_units u
  JOIN project_buildings bld
    ON bld.id = u.building_id
   AND bld.tenant_id = u.tenant_id
   AND bld.project_id = u.project_id
  JOIN project_floors fl
    ON fl.id = u.floor_id
   AND fl.tenant_id = u.tenant_id
   AND fl.project_id = u.project_id
   AND fl.building_id = u.building_id
  JOIN inventory_slots s
    ON s.physical_unit_id = u.id
   AND s.tenant_id = u.tenant_id
   AND s.project_id = u.project_id
   AND s.unit_type_id = u.unit_type_id
  WHERE u.id = p_physical_unit_id
    AND u.tenant_id = p_tenant_id
    AND u.project_id = p_project_id
    AND u.unit_type_id = v_eoi_unit_type_id
    AND u.status = 'ACTIVE'
    AND bld.status = 'ACTIVE'
    AND fl.status = 'ACTIVE'
    AND s.state = 'AVAILABLE'
  FOR UPDATE OF s;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Selected exact unit is unavailable or does not match the EOI type';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM inventory_locks l
    WHERE l.physical_unit_id = p_physical_unit_id
      AND l.status = 'ACTIVE'
      AND l.expires_at > p_now
  ) THEN
    RAISE EXCEPTION 'Selected exact unit is already locked';
  END IF;

  v_expires_at := p_now + make_interval(secs => p_ttl_seconds);

  INSERT INTO inventory_locks (
    tenant_id,
    project_id,
    unit_type_id,
    inventory_slot_id,
    physical_unit_id,
    buyer_user_id,
    locked_by_user_id,
    status,
    expires_at,
    released_at,
    converted_at,
    release_reason,
    created_at,
    updated_at
  ) VALUES (
    p_tenant_id,
    p_project_id,
    v_unit_type_id,
    v_slot_id,
    p_physical_unit_id,
    v_buyer_user_id,
    p_locked_by_user_id,
    'ACTIVE',
    v_expires_at,
    NULL,
    NULL,
    NULL,
    p_now,
    p_now
  )
  RETURNING id INTO v_lock_id;

  UPDATE queue_entries
  SET status = 'LOCKED', updated_at = p_now
  WHERE id = p_queue_entry_id;

  INSERT INTO domain_outbox_events (
    tenant_id, project_id, aggregate_type, aggregate_id, event_type, payload
  ) VALUES (
    p_tenant_id,
    p_project_id,
    'INVENTORY_LOCK',
    v_lock_id,
    'allocation.exact_unit_locked',
    jsonb_build_object(
      'queueEntryId', p_queue_entry_id,
      'buyerProfileId', v_buyer_profile_id,
      'buyerUserId', v_buyer_user_id,
      'eoiId', v_eoi_id,
      'unitTypeId', v_unit_type_id,
      'physicalUnitId', p_physical_unit_id,
      'inventorySlotId', v_slot_id,
      'expiresAt', v_expires_at,
      'lockedByUserId', p_locked_by_user_id
    )
  );

  RETURN QUERY SELECT
    v_lock_id,
    v_buyer_user_id,
    v_unit_type_id,
    p_physical_unit_id,
    v_slot_id,
    v_expires_at,
    v_display_reference,
    v_internal_reference,
    v_building_id,
    v_building_code,
    v_building_name,
    v_floor_id,
    v_floor_code,
    v_floor_name;
END;
$$;

-- This is a breaking commercial-authority migration. Runtime 33 must be drained
-- before applying it because runtime 33 can still attempt anonymous locks.
UPDATE platform_runtime_contract
SET schema_version = 34,
    minimum_runtime_version = 34,
    migration_marker = '0034_exact_apartment_allocation',
    updated_at = now()
WHERE singleton_key = 'production';

COMMIT;
