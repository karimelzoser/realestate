BEGIN;

-- Allocation UX and recovery assume one active commercial choice per buyer/project.
-- Fail the migration instead of silently discarding conflicting live locks.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM inventory_locks
    WHERE status = 'ACTIVE'
      AND buyer_user_id IS NOT NULL
    GROUP BY tenant_id, project_id, buyer_user_id
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'cannot enforce one active buyer lock: duplicate active buyer/project locks exist';
  END IF;
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS inventory_locks_one_active_per_buyer_project
  ON inventory_locks(tenant_id, project_id, buyer_user_id)
  WHERE status = 'ACTIVE' AND buyer_user_id IS NOT NULL;

-- Schema 34 is additive for runtime 33, so old instances may continue during the
-- migration-first deployment window. Runtime 34 itself requires this invariant.
UPDATE platform_runtime_contract
SET schema_version = 34,
    minimum_runtime_version = 33,
    migration_marker = '0034_single_active_buyer_allocation_lock',
    updated_at = now()
WHERE singleton_key = 'production'
  AND schema_version < 34;

COMMIT;
