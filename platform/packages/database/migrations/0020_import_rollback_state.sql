BEGIN;

ALTER TABLE project_import_jobs
  DROP CONSTRAINT project_import_jobs_status_check;

ALTER TABLE project_import_jobs
  ADD CONSTRAINT project_import_jobs_status_check
  CHECK (status IN ('DRAFT','VALIDATING','VALIDATED','PUBLISHING','PUBLISHED','ROLLED_BACK','FAILED','CANCELLED'));

CREATE OR REPLACE FUNCTION sync_import_rollback_state()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.rollback_status = 'ROLLED_BACK' AND OLD.rollback_status IS DISTINCT FROM NEW.rollback_status THEN
    NEW.status := 'ROLLED_BACK';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_sync_import_rollback_state
BEFORE UPDATE OF rollback_status ON project_import_jobs
FOR EACH ROW EXECUTE FUNCTION sync_import_rollback_state();

COMMIT;
