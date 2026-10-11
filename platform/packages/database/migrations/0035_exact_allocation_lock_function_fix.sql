BEGIN;

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

  UPDATE inventory_locks AS stale_lock
  SET status = 'EXPIRED',
      released_at = p_now,
      release_reason = 'TTL expired',
      updated_at = p_now
  WHERE stale_lock.tenant_id = p_tenant_id
    AND stale_lock.project_id = p_project_id
    AND stale_lock.status = 'ACTIVE'
    AND stale_lock.expires_at <= p_now;

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

UPDATE platform_runtime_contract
SET schema_version = 35,
    minimum_runtime_version = 34,
    migration_marker = '0035_exact_allocation_lock_function_fix',
    updated_at = now()
WHERE singleton_key = 'production';

COMMIT;
