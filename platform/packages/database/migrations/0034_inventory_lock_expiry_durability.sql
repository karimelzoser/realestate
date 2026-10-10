BEGIN;

CREATE INDEX IF NOT EXISTS inventory_locks_expiry_scan
  ON inventory_locks(expires_at, id)
  WHERE status = 'ACTIVE';

CREATE OR REPLACE FUNCTION preneura_expire_inventory_locks(
  p_limit integer DEFAULT 500,
  p_now timestamptz DEFAULT now()
)
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  v_expired integer := 0;
BEGIN
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 5000 THEN
    RAISE EXCEPTION 'p_limit must be between 1 and 5000';
  END IF;

  WITH candidates AS (
    SELECT l.id
    FROM inventory_locks l
    WHERE l.status = 'ACTIVE'
      AND l.expires_at <= p_now
    ORDER BY l.expires_at ASC, l.id ASC
    FOR UPDATE SKIP LOCKED
    LIMIT p_limit
  ), expired AS (
    UPDATE inventory_locks l
    SET
      status = 'EXPIRED',
      released_at = p_now,
      release_reason = 'TTL_EXPIRED',
      updated_at = p_now
    FROM candidates c
    WHERE l.id = c.id
      AND l.status = 'ACTIVE'
      AND l.expires_at <= p_now
    RETURNING
      l.id,
      l.tenant_id,
      l.project_id,
      l.unit_type_id,
      l.inventory_slot_id,
      l.buyer_user_id,
      l.locked_by_user_id,
      l.expires_at
  ), events AS (
    INSERT INTO domain_outbox_events (
      tenant_id,
      project_id,
      aggregate_type,
      aggregate_id,
      event_type,
      payload,
      occurred_at,
      published_at,
      attempts
    )
    SELECT
      e.tenant_id,
      e.project_id,
      'INVENTORY_LOCK',
      e.id,
      'inventory.lock.expired',
      jsonb_build_object(
        'unitTypeId', e.unit_type_id,
        'inventorySlotId', e.inventory_slot_id,
        'buyerUserId', e.buyer_user_id,
        'lockedByUserId', e.locked_by_user_id,
        'expiresAt', e.expires_at,
        'expiredAt', p_now,
        'reason', 'TTL_EXPIRED'
      ),
      p_now,
      NULL,
      0
    FROM expired e
    RETURNING 1
  )
  SELECT count(*) INTO v_expired FROM events;

  RETURN v_expired;
END;
$$;

COMMENT ON FUNCTION preneura_expire_inventory_locks(integer, timestamptz) IS
  'Atomically expires overdue ACTIVE inventory locks in bounded SKIP LOCKED batches and emits one durable outbox event per transition.';

UPDATE platform_runtime_contract
SET
  schema_version = 34,
  minimum_runtime_version = 33,
  migration_marker = '0034_inventory_lock_expiry_durability',
  updated_at = now()
WHERE singleton_key = 'production';

COMMIT;
