BEGIN;

ALTER TABLE buyer_eois
  ADD CONSTRAINT buyer_eois_finance_scope_identity
  UNIQUE (id, tenant_id, project_id);

COMMIT;
