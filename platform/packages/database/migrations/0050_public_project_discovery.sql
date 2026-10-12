BEGIN;

-- ACTIVE is an operational lifecycle, not consent to publish. Existing projects
-- remain private until an authorized manager publishes explicit bilingual copy.
CREATE TABLE project_publications (
  project_id uuid PRIMARY KEY REFERENCES projects(id),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  slug text UNIQUE NOT NULL CHECK (length(slug) BETWEEN 3 AND 100 AND slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  title_en text NOT NULL CHECK (length(trim(title_en)) BETWEEN 2 AND 180),
  title_ar text NOT NULL CHECK (length(trim(title_ar)) BETWEEN 2 AND 180),
  description_en text NOT NULL CHECK (length(trim(description_en)) BETWEEN 10 AND 1500),
  description_ar text NOT NULL CHECK (length(trim(description_ar)) BETWEEN 10 AND 1500),
  location_en text NOT NULL CHECK (length(trim(location_en)) BETWEEN 2 AND 160),
  location_ar text NOT NULL CHECK (length(trim(location_ar)) BETWEEN 2 AND 160),
  status text NOT NULL CHECK (status IN ('PUBLISHED','UNPUBLISHED')),
  updated_by uuid NOT NULL REFERENCES users(id),
  change_reason text NOT NULL CHECK (length(trim(change_reason)) BETWEEN 10 AND 500),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE project_publication_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  project_id uuid NOT NULL REFERENCES projects(id),
  actor_user_id uuid NOT NULL REFERENCES users(id),
  status text NOT NULL,
  slug text NOT NULL,
  reason text NOT NULL,
  public_snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX project_publication_events_scope_time ON project_publication_events(tenant_id,project_id,created_at,id);
CREATE FUNCTION preneura_publication_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM projects p JOIN tenants t ON t.id=p.tenant_id
    WHERE p.id=NEW.project_id AND p.tenant_id=NEW.tenant_id
      AND (NEW.status='UNPUBLISHED' OR (p.status='ACTIVE' AND t.status='ACTIVE'))) THEN
    RAISE EXCEPTION 'Publication requires matching scope and active tenant/project';
  END IF;
  IF TG_OP='UPDATE' AND (NEW.project_id<>OLD.project_id OR NEW.tenant_id<>OLD.tenant_id OR NEW.created_at<>OLD.created_at) THEN
    RAISE EXCEPTION 'Publication ownership is immutable';
  END IF;
  NEW.updated_at:=now();
  RETURN NEW;
END $$;
CREATE TRIGGER trg_publication_guard BEFORE INSERT OR UPDATE ON project_publications FOR EACH ROW EXECUTE FUNCTION preneura_publication_guard();
CREATE FUNCTION preneura_publication_audit() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO project_publication_events(tenant_id,project_id,actor_user_id,status,slug,reason,public_snapshot)
  VALUES(NEW.tenant_id,NEW.project_id,NEW.updated_by,NEW.status,NEW.slug,NEW.change_reason,
    jsonb_build_object('titleEn',NEW.title_en,'titleAr',NEW.title_ar,'descriptionEn',NEW.description_en,
      'descriptionAr',NEW.description_ar,'locationEn',NEW.location_en,'locationAr',NEW.location_ar));
  RETURN NEW;
END $$;
CREATE TRIGGER trg_publication_audit AFTER INSERT OR UPDATE ON project_publications FOR EACH ROW EXECUTE FUNCTION preneura_publication_audit();
CREATE TRIGGER trg_publication_events_immutable BEFORE UPDATE OR DELETE ON project_publication_events
FOR EACH ROW EXECUTE FUNCTION preneura_developer_onboarding_event_immutable();

-- This additive read/publication module requires50; existing49 services remain
-- compatible while an exact-source rollout is rehearsed.
UPDATE platform_runtime_contract SET schema_version=50,
  minimum_runtime_version=LEAST(minimum_runtime_version,49),
  migration_marker='0050_public_project_discovery',updated_at=now() WHERE singleton_key='production';
COMMIT;
