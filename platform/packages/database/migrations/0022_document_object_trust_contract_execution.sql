BEGIN;

CREATE TABLE storage_object_trust (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  project_id uuid,
  purpose text NOT NULL CHECK (purpose IN (
    'DOCUMENT_TEMPLATE','TRANSACTION_DOCUMENT','SIGNATURE','PROJECT_ASSET'
  )),
  object_key text NOT NULL UNIQUE,
  declared_mime_type text NOT NULL,
  detected_mime_type text,
  byte_size bigint NOT NULL CHECK (byte_size > 0),
  sha256_hex text NOT NULL CHECK (sha256_hex ~ '^[0-9a-f]{64}$'),
  status text NOT NULL CHECK (status IN (
    'PENDING_SCAN','CLEAN','REJECTED','SCAN_FAILED','LEGACY_UNSCANNED'
  )),
  scanner_provider text,
  scanner_reference text,
  scanner_signature text,
  last_error_code text,
  scanned_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (project_id, tenant_id)
    REFERENCES projects(id, tenant_id) ON DELETE RESTRICT,
  UNIQUE (id, tenant_id),
  CHECK (status <> 'CLEAN' OR (detected_mime_type IS NOT NULL AND scanned_at IS NOT NULL)),
  CHECK (status <> 'REJECTED' OR scanned_at IS NOT NULL)
);

CREATE INDEX storage_object_trust_pending
  ON storage_object_trust(status, created_at)
  WHERE status IN ('PENDING_SCAN','SCAN_FAILED','LEGACY_UNSCANNED');

CREATE INDEX storage_object_trust_project
  ON storage_object_trust(project_id, purpose, status, created_at DESC)
  WHERE project_id IS NOT NULL;

CREATE TABLE storage_object_scan_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  object_trust_id uuid NOT NULL REFERENCES storage_object_trust(id) ON DELETE RESTRICT,
  attempt_number integer NOT NULL CHECK (attempt_number > 0),
  provider text NOT NULL,
  result text NOT NULL CHECK (result IN ('CLEAN','INFECTED','MIME_MISMATCH','ERROR')),
  detected_mime_type text,
  engine_version text,
  provider_reference text,
  malware_signature text,
  error_code text,
  started_at timestamptz NOT NULL,
  completed_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (object_trust_id, attempt_number),
  CHECK (completed_at >= started_at),
  CHECK (result <> 'CLEAN' OR detected_mime_type IS NOT NULL),
  CHECK (result <> 'INFECTED' OR malware_signature IS NOT NULL)
);

CREATE INDEX storage_object_scan_attempts_history
  ON storage_object_scan_attempts(object_trust_id, attempt_number DESC);

ALTER TABLE document_templates
  ADD COLUMN object_trust_id uuid REFERENCES storage_object_trust(id) ON DELETE RESTRICT;

ALTER TABLE transaction_documents
  ADD COLUMN object_trust_id uuid REFERENCES storage_object_trust(id) ON DELETE RESTRICT,
  ADD COLUMN stamped_by uuid REFERENCES users(id) ON DELETE RESTRICT,
  ADD COLUMN stamped_at timestamptz;

ALTER TABLE document_signatures
  ADD COLUMN object_trust_id uuid REFERENCES storage_object_trust(id) ON DELETE RESTRICT;

ALTER TABLE project_master_plan_assets
  ADD COLUMN object_trust_id uuid REFERENCES storage_object_trust(id) ON DELETE RESTRICT;

-- Existing objects are never silently declared safe. They require an explicit
-- rescan/remediation path before they can be used for a new trust-sensitive action.
INSERT INTO storage_object_trust (
  tenant_id, project_id, purpose, object_key, declared_mime_type,
  detected_mime_type, byte_size, sha256_hex, status, created_at, updated_at
)
SELECT
  t.tenant_id,
  t.project_id,
  'DOCUMENT_TEMPLATE',
  t.storage_object_key,
  t.mime_type,
  NULL,
  1,
  lower(t.sha256_hex),
  'LEGACY_UNSCANNED',
  t.created_at,
  now()
FROM document_templates t
ON CONFLICT (object_key) DO NOTHING;

UPDATE document_templates t
SET object_trust_id = trust.id
FROM storage_object_trust trust
WHERE trust.object_key = t.storage_object_key;

INSERT INTO storage_object_trust (
  tenant_id, project_id, purpose, object_key, declared_mime_type,
  detected_mime_type, byte_size, sha256_hex, status, created_at, updated_at
)
SELECT
  d.tenant_id,
  d.project_id,
  'TRANSACTION_DOCUMENT',
  d.storage_object_key,
  COALESCE(d.mime_type, 'application/octet-stream'),
  NULL,
  GREATEST(COALESCE(d.byte_size, 1), 1),
  lower(d.sha256_hex),
  'LEGACY_UNSCANNED',
  d.created_at,
  now()
FROM transaction_documents d
WHERE d.storage_object_key IS NOT NULL
  AND d.sha256_hex IS NOT NULL
ON CONFLICT (object_key) DO NOTHING;

UPDATE transaction_documents d
SET object_trust_id = trust.id
FROM storage_object_trust trust
WHERE d.storage_object_key = trust.object_key;

INSERT INTO storage_object_trust (
  tenant_id, project_id, purpose, object_key, declared_mime_type,
  detected_mime_type, byte_size, sha256_hex, status, created_at, updated_at
)
SELECT
  d.tenant_id,
  d.project_id,
  'SIGNATURE',
  s.signature_object_key,
  COALESCE(s.metadata->>'mimeType', 'application/octet-stream'),
  NULL,
  1,
  lower(s.signature_sha256_hex),
  'LEGACY_UNSCANNED',
  s.created_at,
  now()
FROM document_signatures s
JOIN transaction_documents d ON d.id = s.document_id
WHERE s.signature_object_key IS NOT NULL
  AND s.signature_sha256_hex IS NOT NULL
ON CONFLICT (object_key) DO NOTHING;

UPDATE document_signatures s
SET object_trust_id = trust.id
FROM storage_object_trust trust
WHERE s.signature_object_key = trust.object_key;

INSERT INTO storage_object_trust (
  tenant_id, project_id, purpose, object_key, declared_mime_type,
  detected_mime_type, byte_size, sha256_hex, status, created_at, updated_at
)
SELECT
  a.tenant_id,
  a.project_id,
  'PROJECT_ASSET',
  a.storage_object_key,
  a.mime_type,
  NULL,
  1,
  lower(a.sha256_hex),
  'LEGACY_UNSCANNED',
  a.created_at,
  now()
FROM project_master_plan_assets a
ON CONFLICT (object_key) DO NOTHING;

UPDATE project_master_plan_assets a
SET object_trust_id = trust.id
FROM storage_object_trust trust
WHERE a.storage_object_key = trust.object_key;

UPDATE transaction_documents
SET stamped_at = COALESCE(verified_at, updated_at),
    stamped_by = verified_by
WHERE status = 'STAMPED'
  AND stamped_at IS NULL;

CREATE UNIQUE INDEX document_signatures_one_role_per_document
  ON document_signatures(document_id, signer_role);

CREATE TABLE contract_execution_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  transaction_id uuid NOT NULL,
  reservation_id uuid NOT NULL,
  document_id uuid NOT NULL,
  document_sha256_hex text NOT NULL CHECK (document_sha256_hex ~ '^[0-9a-f]{64}$'),
  object_trust_status text NOT NULL CHECK (object_trust_status IN ('CLEAN','LEGACY_UNSCANNED')),
  template_id uuid NOT NULL,
  template_version_number integer NOT NULL CHECK (template_version_number > 0),
  template_sha256_hex text NOT NULL CHECK (template_sha256_hex ~ '^[0-9a-f]{64}$'),
  pricing_version_id uuid NOT NULL,
  quoted_total numeric(18,2) NOT NULL CHECK (quoted_total >= 0),
  currency char(3) NOT NULL,
  price_components jsonb NOT NULL,
  signatures jsonb NOT NULL,
  manifest jsonb NOT NULL,
  manifest_sha256_hex text NOT NULL CHECK (manifest_sha256_hex ~ '^[0-9a-f]{64}$'),
  executed_at timestamptz NOT NULL,
  executed_by uuid REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (transaction_id, tenant_id, project_id)
    REFERENCES transactions(id, tenant_id, project_id) ON DELETE RESTRICT,
  FOREIGN KEY (reservation_id, tenant_id, project_id)
    REFERENCES reservations(id, tenant_id, project_id) ON DELETE RESTRICT,
  FOREIGN KEY (document_id, transaction_id)
    REFERENCES transaction_documents(id, transaction_id) ON DELETE RESTRICT,
  FOREIGN KEY (template_id, tenant_id)
    REFERENCES document_templates(id, tenant_id) ON DELETE RESTRICT,
  FOREIGN KEY (pricing_version_id, tenant_id, project_id)
    REFERENCES pricing_versions(id, tenant_id, project_id) ON DELETE RESTRICT,
  UNIQUE (transaction_id),
  UNIQUE (document_id)
);

CREATE INDEX contract_execution_snapshots_project
  ON contract_execution_snapshots(project_id, executed_at DESC);

CREATE OR REPLACE FUNCTION preneura_storage_trust_identity_immutable()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     OR NEW.project_id IS DISTINCT FROM OLD.project_id
     OR NEW.purpose IS DISTINCT FROM OLD.purpose
     OR NEW.object_key IS DISTINCT FROM OLD.object_key
     OR NEW.declared_mime_type IS DISTINCT FROM OLD.declared_mime_type
     OR NEW.byte_size IS DISTINCT FROM OLD.byte_size
     OR NEW.sha256_hex IS DISTINCT FROM OLD.sha256_hex THEN
    RAISE EXCEPTION 'storage object trust identity is immutable';
  END IF;

  IF OLD.status IN ('CLEAN','REJECTED') AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'final storage object trust verdict is immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_storage_object_trust_identity_immutable
BEFORE UPDATE ON storage_object_trust
FOR EACH ROW EXECUTE FUNCTION preneura_storage_trust_identity_immutable();

CREATE OR REPLACE FUNCTION preneura_storage_scan_attempt_immutable()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'storage scan attempts are immutable audit records';
END;
$$;

CREATE TRIGGER trg_storage_object_scan_attempts_immutable
BEFORE UPDATE OR DELETE ON storage_object_scan_attempts
FOR EACH ROW EXECUTE FUNCTION preneura_storage_scan_attempt_immutable();

CREATE OR REPLACE FUNCTION preneura_document_template_trust_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_status text;
BEGIN
  IF NEW.status = 'ACTIVE' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM NEW.status OR OLD.object_trust_id IS DISTINCT FROM NEW.object_trust_id) THEN
    SELECT status INTO v_status FROM storage_object_trust WHERE id = NEW.object_trust_id;
    IF v_status IS DISTINCT FROM 'CLEAN' THEN
      RAISE EXCEPTION 'active document template requires a CLEAN trusted object';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_document_templates_trust_guard
BEFORE INSERT OR UPDATE ON document_templates
FOR EACH ROW EXECUTE FUNCTION preneura_document_template_trust_guard();

CREATE OR REPLACE FUNCTION preneura_transaction_document_execution_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_trust text;
  v_missing integer;
  v_required integer;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status IN ('SIGNED','STAMPED') OR EXISTS (
      SELECT 1 FROM document_signatures s WHERE s.document_id = OLD.id
    ) THEN
      RAISE EXCEPTION 'signed/executed contract evidence cannot be deleted';
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.status = 'STAMPED' THEN
    RAISE EXCEPTION 'executed contract document is immutable';
  END IF;

  IF OLD.status = 'SIGNED' AND NEW.status <> 'STAMPED' THEN
    RAISE EXCEPTION 'signed contract can only transition to stamped execution';
  END IF;

  IF NEW.status = 'SUPERSEDED' AND EXISTS (
    SELECT 1 FROM document_signatures s WHERE s.document_id = OLD.id
  ) THEN
    RAISE EXCEPTION 'a contract with signatures cannot be superseded';
  END IF;

  IF NEW.status IN ('VERIFIED','SIGNED','STAMPED') THEN
    SELECT status INTO v_trust FROM storage_object_trust WHERE id = NEW.object_trust_id;
    IF v_trust IS DISTINCT FROM 'CLEAN' THEN
      RAISE EXCEPTION 'trusted CLEAN object is required before document verification/signing/execution';
    END IF;
  END IF;

  IF NEW.status IN ('SIGNED','STAMPED') THEN
    IF NEW.category <> 'CONTRACT' OR NEW.template_id IS NULL THEN
      RAISE EXCEPTION 'signed contract requires a versioned contract template';
    END IF;

    SELECT count(*)::int INTO v_required
    FROM document_template_signer_requirements r
    WHERE r.template_id = NEW.template_id AND r.required = true;

    SELECT count(*)::int INTO v_missing
    FROM document_template_signer_requirements r
    WHERE r.template_id = NEW.template_id
      AND r.required = true
      AND NOT EXISTS (
        SELECT 1 FROM document_signatures s
        WHERE s.document_id = NEW.id AND s.signer_role = r.signer_role
      );

    IF v_required = 0 OR v_missing <> 0 THEN
      RAISE EXCEPTION 'all required contract signers must be present before signing/execution';
    END IF;
  END IF;

  IF NEW.status = 'STAMPED' THEN
    IF OLD.status <> 'SIGNED' OR NEW.stamped_at IS NULL OR NEW.stamped_by IS NULL THEN
      RAISE EXCEPTION 'contract execution requires signed state, timestamp and executing actor';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_transaction_documents_execution_guard
BEFORE UPDATE OR DELETE ON transaction_documents
FOR EACH ROW EXECUTE FUNCTION preneura_transaction_document_execution_guard();

CREATE OR REPLACE FUNCTION preneura_document_signature_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_document_status text;
  v_document_category text;
  v_contract_trust text;
  v_signature_trust text;
  v_template_id uuid;
  v_signing_order integer;
  v_missing_earlier integer;
BEGIN
  IF TG_OP IN ('UPDATE','DELETE') THEN
    RAISE EXCEPTION 'contract signatures are immutable evidence';
  END IF;

  SELECT d.status, d.category, d.template_id, trust.status
  INTO v_document_status, v_document_category, v_template_id, v_contract_trust
  FROM transaction_documents d
  LEFT JOIN storage_object_trust trust ON trust.id = d.object_trust_id
  WHERE d.id = NEW.document_id;

  IF v_document_category IS DISTINCT FROM 'CONTRACT'
     OR v_document_status NOT IN ('VERIFIED','SIGNED')
     OR v_contract_trust IS DISTINCT FROM 'CLEAN' THEN
    RAISE EXCEPTION 'signature requires a CLEAN verified contract';
  END IF;

  IF v_template_id IS NULL THEN
    RAISE EXCEPTION 'signature requires a versioned contract template';
  END IF;

  SELECT signing_order INTO v_signing_order
  FROM document_template_signer_requirements
  WHERE template_id = v_template_id AND signer_role = NEW.signer_role;
  IF v_signing_order IS NULL THEN
    RAISE EXCEPTION 'signer role is not permitted by the contract template';
  END IF;

  SELECT count(*)::int INTO v_missing_earlier
  FROM document_template_signer_requirements r
  WHERE r.template_id = v_template_id
    AND r.required = true
    AND r.signing_order < v_signing_order
    AND NOT EXISTS (
      SELECT 1 FROM document_signatures s
      WHERE s.document_id = NEW.document_id AND s.signer_role = r.signer_role
    );
  IF v_missing_earlier <> 0 THEN
    RAISE EXCEPTION 'required earlier contract signers must sign first';
  END IF;

  IF NEW.method IN ('DRAWN','UPLOAD') THEN
    SELECT status INTO v_signature_trust
    FROM storage_object_trust
    WHERE id = NEW.object_trust_id
      AND object_key = NEW.signature_object_key
      AND sha256_hex = lower(NEW.signature_sha256_hex);
    IF v_signature_trust IS DISTINCT FROM 'CLEAN' THEN
      RAISE EXCEPTION 'uploaded signature requires a CLEAN trusted object';
    END IF;
  ELSIF NEW.object_trust_id IS NOT NULL THEN
    RAISE EXCEPTION 'non-object signature must not reference object trust';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_document_signatures_guard
BEFORE INSERT OR UPDATE OR DELETE ON document_signatures
FOR EACH ROW EXECUTE FUNCTION preneura_document_signature_guard();

CREATE OR REPLACE FUNCTION preneura_capture_contract_execution(p_document_id uuid, p_allow_legacy boolean DEFAULT false)
RETURNS uuid
LANGUAGE plpgsql
AS $$
DECLARE
  v_doc record;
  v_prices jsonb;
  v_signatures jsonb;
  v_manifest jsonb;
  v_hash text;
  v_snapshot_id uuid;
BEGIN
  SELECT
    d.id AS document_id,
    d.tenant_id,
    d.project_id,
    d.transaction_id,
    d.sha256_hex AS document_sha256_hex,
    d.stamped_at,
    d.stamped_by,
    trust.status AS object_trust_status,
    d.template_id,
    tpl.version_number AS template_version_number,
    tpl.sha256_hex AS template_sha256_hex,
    t.reservation_id,
    r.pricing_version_id,
    r.quoted_total,
    r.currency
  INTO v_doc
  FROM transaction_documents d
  JOIN transactions t ON t.id = d.transaction_id
    AND t.tenant_id = d.tenant_id AND t.project_id = d.project_id
  JOIN reservations r ON r.id = t.reservation_id
    AND r.tenant_id = t.tenant_id AND r.project_id = t.project_id
  JOIN document_templates tpl ON tpl.id = d.template_id
  LEFT JOIN storage_object_trust trust ON trust.id = d.object_trust_id
  WHERE d.id = p_document_id
    AND d.category = 'CONTRACT'
    AND d.status = 'STAMPED';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'stamped contract not found for execution snapshot';
  END IF;
  IF v_doc.pricing_version_id IS NULL OR v_doc.quoted_total IS NULL THEN
    RAISE EXCEPTION 'executed contract requires certified reservation pricing';
  END IF;
  IF v_doc.object_trust_status <> 'CLEAN' AND NOT (p_allow_legacy AND v_doc.object_trust_status = 'LEGACY_UNSCANNED') THEN
    RAISE EXCEPTION 'executed contract requires CLEAN object trust';
  END IF;

  SELECT jsonb_agg(
    jsonb_build_object(
      'component', c.component,
      'areaSqm', c.area_sqm::text,
      'ratePerSqm', c.rate_per_sqm::text,
      'amount', c.amount::text
    ) ORDER BY CASE c.component WHEN 'INDOOR' THEN 1 WHEN 'ROOF' THEN 2 ELSE 3 END
  ) INTO v_prices
  FROM reservation_price_components c
  WHERE c.reservation_id = v_doc.reservation_id;

  IF jsonb_array_length(COALESCE(v_prices, '[]'::jsonb)) <> 3 THEN
    RAISE EXCEPTION 'executed contract requires complete certified price components';
  END IF;

  SELECT jsonb_agg(
    jsonb_build_object(
      'signerRole', s.signer_role,
      'signerUserId', s.signer_user_id,
      'method', s.method,
      'typedName', s.typed_name,
      'signatureSha256Hex', s.signature_sha256_hex,
      'provider', s.provider,
      'providerEnvelopeId', s.provider_envelope_id,
      'signedAt', s.signed_at
    ) ORDER BY req.signing_order, s.signer_role
  ) INTO v_signatures
  FROM document_signatures s
  JOIN document_template_signer_requirements req
    ON req.template_id = v_doc.template_id AND req.signer_role = s.signer_role
  WHERE s.document_id = v_doc.document_id;

  IF v_signatures IS NULL THEN
    RAISE EXCEPTION 'executed contract requires signature evidence';
  END IF;

  v_manifest := jsonb_build_object(
    'schemaVersion', 1,
    'tenantId', v_doc.tenant_id,
    'projectId', v_doc.project_id,
    'transactionId', v_doc.transaction_id,
    'reservationId', v_doc.reservation_id,
    'documentId', v_doc.document_id,
    'documentSha256Hex', v_doc.document_sha256_hex,
    'objectTrustStatus', v_doc.object_trust_status,
    'templateId', v_doc.template_id,
    'templateVersionNumber', v_doc.template_version_number,
    'templateSha256Hex', v_doc.template_sha256_hex,
    'pricingVersionId', v_doc.pricing_version_id,
    'quotedTotal', v_doc.quoted_total::text,
    'currency', v_doc.currency,
    'priceComponents', v_prices,
    'signatures', v_signatures,
    'executedAt', v_doc.stamped_at,
    'executedBy', v_doc.stamped_by
  );
  v_hash := encode(digest(convert_to(v_manifest::text, 'UTF8'), 'sha256'), 'hex');

  INSERT INTO contract_execution_snapshots (
    tenant_id, project_id, transaction_id, reservation_id, document_id,
    document_sha256_hex, object_trust_status, template_id, template_version_number,
    template_sha256_hex, pricing_version_id, quoted_total, currency,
    price_components, signatures, manifest, manifest_sha256_hex, executed_at, executed_by
  ) VALUES (
    v_doc.tenant_id, v_doc.project_id, v_doc.transaction_id, v_doc.reservation_id, v_doc.document_id,
    lower(v_doc.document_sha256_hex), v_doc.object_trust_status, v_doc.template_id, v_doc.template_version_number,
    lower(v_doc.template_sha256_hex), v_doc.pricing_version_id, v_doc.quoted_total, v_doc.currency,
    v_prices, v_signatures, v_manifest, v_hash, v_doc.stamped_at, v_doc.stamped_by
  )
  ON CONFLICT (document_id) DO NOTHING
  RETURNING id INTO v_snapshot_id;

  IF v_snapshot_id IS NULL THEN
    SELECT id INTO v_snapshot_id FROM contract_execution_snapshots WHERE document_id = p_document_id;
  END IF;
  RETURN v_snapshot_id;
END;
$$;

CREATE OR REPLACE FUNCTION preneura_contract_execution_snapshot_trigger()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status = 'STAMPED' AND OLD.status IS DISTINCT FROM 'STAMPED' THEN
    PERFORM preneura_capture_contract_execution(NEW.id, false);
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_capture_contract_execution_snapshot
AFTER UPDATE OF status ON transaction_documents
FOR EACH ROW EXECUTE FUNCTION preneura_contract_execution_snapshot_trigger();

CREATE OR REPLACE FUNCTION preneura_contract_execution_snapshot_immutable()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'contract execution snapshots are immutable legal evidence';
END;
$$;

CREATE TRIGGER trg_contract_execution_snapshots_immutable
BEFORE UPDATE OR DELETE ON contract_execution_snapshots
FOR EACH ROW EXECUTE FUNCTION preneura_contract_execution_snapshot_immutable();

-- Backfill historical executed contracts after all supporting structures exist.
DO $$
DECLARE
  v_document_id uuid;
BEGIN
  FOR v_document_id IN
    SELECT id FROM transaction_documents
    WHERE category = 'CONTRACT' AND status = 'STAMPED'
  LOOP
    PERFORM preneura_capture_contract_execution(v_document_id, true);
  END LOOP;
END $$;

COMMIT;
