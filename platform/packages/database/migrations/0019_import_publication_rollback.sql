BEGIN;

ALTER TABLE project_import_jobs
  ADD COLUMN rollback_status text NOT NULL DEFAULT 'NONE'
    CHECK (rollback_status IN ('NONE','ROLLED_BACK','ROLLBACK_FAILED')),
  ADD COLUMN rolled_back_at timestamptz,
  ADD COLUMN rolled_back_by uuid REFERENCES users(id) ON DELETE SET NULL;

CREATE TABLE project_import_published_entities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  import_job_id uuid NOT NULL REFERENCES project_import_jobs(id) ON DELETE CASCADE,
  publication_order integer NOT NULL CHECK (publication_order > 0),
  entity_type text NOT NULL CHECK (entity_type IN (
    'PHASE','BUILDING','FLOOR','UNIT_TYPE','PHYSICAL_UNIT','INVENTORY_SLOT','PRICING_VERSION','PRICING_RATE','PAYMENT_PLAN'
  )),
  entity_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (import_job_id, publication_order),
  UNIQUE (import_job_id, entity_type, entity_id)
);

CREATE INDEX project_import_published_entities_rollback
  ON project_import_published_entities(import_job_id, publication_order DESC);

COMMIT;
