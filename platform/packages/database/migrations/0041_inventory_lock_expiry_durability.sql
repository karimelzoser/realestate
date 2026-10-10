BEGIN;

-- Durable inventory lock expiry for the canonical migration-40 production line.
-- Lock expiry is PostgreSQL-authoritative and safe across concurrent worker replicas.
CREATE INDEX IF NOT EXISTS inventory_locks_expiry_scan
  ON inventory_locks(expires_at, id)
  WHERE status = 'ACTIVE';

CREATE OR REPLACE FUNCTION preneura_guard_inventory_lock_transition()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status <> 'ACTIVE' THEN
    RAISE EXCEPTION 'inventory lock % is terminal in status %', OLD.id, OLD.status;
  END IF;

  IF OLD.status <> NEW.status
     AND NEW.status NOT IN ('RELEASED', 'EXPIRED', 'CONVERTED') THEN
    RAISE EXCEPTION 'invalid inventory lock transition % -> % for %', OLD.status, NEW.status, OLD.id;
  END IF;

  IF NEW.status = 'EXPIRED' THEN
    IF NEW.released_at IS NULL OR NEW.converted_at IS NOT NULL THEN
      RAISE EXCEPTION 'expired inventory lock % requires released_at and no converted_at', OLD.id;
    END IF;
    NEW.release_reason := 'TTL_EXPIRED';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS inventory_locks_transition_guard ON inventory_locks;
CREATE TRIGGER inventory_locks_transition_guard
BEFORE UPDATE ON inventory_locks
FOR EACH ROW
EXECUTE FUNCTION preneura_guard_inventory_lock_transition();

CREATE OR REPLACE FUNCTION preneura_emit_inventory_lock_expired()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status = 'ACTIVE' AND NEW.status = 'EXPIRED' THEN
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
    VALUES (
      NEW.tenant_id,
      NEW.project_id,
      'INVENTORY_LOCK',
      NEW.id,
      'inventory.lock.expired',
      jsonb_build_object(
        'unitTypeId', NEW.unit_type_id,
        'inventorySlotId', NEW.inventory_slot_id,
        'buyerUserId', NEW.buyer_user_id,
        'lockedByUserId', NEW.locked_by_user_id,
        'expiresAt', NEW.expires_at,
        'expiredAt', NEW.released_at,
        'reason', NEW.release_reason
      ),
      COALESCE(NEW.released_at, now()),
      NULL,
      0
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS inventory_locks_expired_outbox ON inventory_locks;
CREATE TRIGGER inventory_locks_expired_outbox
AFTER UPDATE OF status ON inventory_locks
FOR EACH ROW
WHEN (OLD.status = 'ACTIVE' AND NEW.status = 'EXPIRED')
EXECUTE FUNCTION preneura_emit_inventory_lock_expired();

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
    RETURNING l.id
  )
  SELECT count(*) INTO v_expired FROM expired;

  RETURN v_expired;
END;
$$;

COMMENT ON FUNCTION preneura_expire_inventory_locks(integer, timestamptz) IS
  'Atomically expires overdue ACTIVE inventory locks in bounded SKIP LOCKED batches. Allocator queue reopening remains owned by the migration-0040 queue/lock sync trigger.';

UPDATE platform_runtime_contract
SET
  schema_version = 41,
  minimum_runtime_version = LEAST(minimum_runtime_version, 40),
  migration_marker = '0041_inventory_lock_expiry_durability',
  updated_at = now()
WHERE singleton_key = 'production';

COMMIT;
