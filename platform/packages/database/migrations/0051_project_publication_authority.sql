BEGIN;

--50 was already applied in disposable qualification. Preserve its checksum and
--append the final write-authority defense instead of rewriting applied history.
CREATE OR REPLACE FUNCTION preneura_publication_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM projects p JOIN tenants t ON t.id=p.tenant_id
    WHERE p.id=NEW.project_id AND p.tenant_id=NEW.tenant_id
      AND (NEW.status='UNPUBLISHED' OR (p.status='ACTIVE' AND t.status='ACTIVE'))) THEN
    RAISE EXCEPTION 'Publication requires matching scope and active tenant/project';
  END IF;
  IF TG_OP='UPDATE' AND (NEW.project_id<>OLD.project_id OR NEW.tenant_id<>OLD.tenant_id OR NEW.created_at<>OLD.created_at) THEN
    RAISE EXCEPTION 'Publication ownership is immutable';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM users u JOIN access_role_assignments a ON a.user_id=u.id
    WHERE u.id=NEW.updated_by AND u.status='ACTIVE' AND a.status='ACTIVE' AND a.revoked_at IS NULL
      AND ((a.role_code='PRENEURA_SUPER_ADMIN' AND a.scope_type='PLATFORM')
        OR (a.role_code IN ('OPERATIONS_DIRECTOR','MANAGER') AND a.tenant_id=NEW.tenant_id
          AND (a.scope_type='TENANT' OR (a.scope_type='PROJECT' AND a.project_id=NEW.project_id))
          AND EXISTS (SELECT 1 FROM tenant_memberships m WHERE m.user_id=u.id AND m.tenant_id=NEW.tenant_id AND m.status='ACTIVE')))
  ) THEN RAISE EXCEPTION 'Publication requires current scoped manager authority'; END IF;
  NEW.updated_at:=now();
  RETURN NEW;
END $$;
CREATE FUNCTION preneura_publication_no_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Unpublish projects through an audited status change'; END $$;
CREATE TRIGGER trg_publication_no_delete BEFORE DELETE ON project_publications FOR EACH ROW EXECUTE FUNCTION preneura_publication_no_delete();

UPDATE platform_runtime_contract SET schema_version=51,
  minimum_runtime_version=LEAST(minimum_runtime_version,49),
  migration_marker='0051_project_publication_authority',updated_at=now() WHERE singleton_key='production';
COMMIT;
