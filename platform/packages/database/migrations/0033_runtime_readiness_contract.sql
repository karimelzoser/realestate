BEGIN;

CREATE TABLE IF NOT EXISTS platform_runtime_contract (
  singleton_key text PRIMARY KEY CHECK (singleton_key = 'production'),
  schema_version integer NOT NULL CHECK (schema_version > 0),
  migration_marker text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO platform_runtime_contract (
  singleton_key,
  schema_version,
  migration_marker,
  updated_at
) VALUES (
  'production',
  33,
  '0033_runtime_readiness_contract',
  now()
)
ON CONFLICT (singleton_key) DO UPDATE
SET schema_version = EXCLUDED.schema_version,
    migration_marker = EXCLUDED.migration_marker,
    updated_at = EXCLUDED.updated_at
WHERE platform_runtime_contract.schema_version < EXCLUDED.schema_version;

CREATE OR REPLACE FUNCTION protect_platform_runtime_contract()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'platform runtime contract cannot be deleted';
  END IF;

  IF NEW.singleton_key IS DISTINCT FROM OLD.singleton_key THEN
    RAISE EXCEPTION 'platform runtime contract identity is immutable';
  END IF;

  IF NEW.schema_version < OLD.schema_version THEN
    RAISE EXCEPTION 'platform runtime contract cannot move backwards';
  END IF;

  IF NEW.schema_version = OLD.schema_version
     AND NEW.migration_marker IS DISTINCT FROM OLD.migration_marker THEN
    RAISE EXCEPTION 'runtime migration marker cannot change without a schema-version increment';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_platform_runtime_contract ON platform_runtime_contract;
CREATE TRIGGER trg_protect_platform_runtime_contract
BEFORE UPDATE OR DELETE ON platform_runtime_contract
FOR EACH ROW
EXECUTE FUNCTION protect_platform_runtime_contract();

COMMIT;
