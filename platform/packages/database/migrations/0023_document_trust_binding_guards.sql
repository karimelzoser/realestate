BEGIN;

-- New business rows bind themselves to the immutable trust record by object
-- identity. Application callers do not get to choose an arbitrary CLEAN row.
CREATE OR REPLACE FUNCTION preneura_document_template_trust_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_trust_id uuid;
  v_status text;
BEGIN
  IF NEW.status = 'ACTIVE' AND (
    TG_OP = 'INSERT'
    OR OLD.status IS DISTINCT FROM NEW.status
    OR OLD.object_trust_id IS DISTINCT FROM NEW.object_trust_id
  ) THEN
    IF NEW.object_trust_id IS NULL THEN
      SELECT id, status INTO v_trust_id, v_status
      FROM storage_object_trust
      WHERE tenant_id = NEW.tenant_id
        AND project_id IS NOT DISTINCT FROM NEW.project_id
        AND purpose = 'DOCUMENT_TEMPLATE'
        AND object_key = NEW.storage_object_key
        AND sha256_hex = lower(NEW.sha256_hex)
      LIMIT 1;
      NEW.object_trust_id := v_trust_id;
    ELSE
      SELECT id, status INTO v_trust_id, v_status
      FROM storage_object_trust
      WHERE id = NEW.object_trust_id
        AND tenant_id = NEW.tenant_id
        AND project_id IS NOT DISTINCT FROM NEW.project_id
        AND purpose = 'DOCUMENT_TEMPLATE'
        AND object_key = NEW.storage_object_key
        AND sha256_hex = lower(NEW.sha256_hex)
      LIMIT 1;
    END IF;

    IF v_trust_id IS NULL OR v_status IS DISTINCT FROM 'CLEAN' THEN
      RAISE EXCEPTION 'active document template requires its matching CLEAN trusted object';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION preneura_transaction_document_execution_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_trust_id uuid;
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
    IF NEW.object_trust_id IS NULL THEN
      SELECT id, status INTO v_trust_id, v_trust
      FROM storage_object_trust
      WHERE tenant_id = NEW.tenant_id
        AND project_id = NEW.project_id
        AND purpose = 'TRANSACTION_DOCUMENT'
        AND object_key = NEW.storage_object_key
        AND sha256_hex = lower(NEW.sha256_hex)
      LIMIT 1;
      NEW.object_trust_id := v_trust_id;
    ELSE
      SELECT id, status INTO v_trust_id, v_trust
      FROM storage_object_trust
      WHERE id = NEW.object_trust_id
        AND tenant_id = NEW.tenant_id
        AND project_id = NEW.project_id
        AND purpose = 'TRANSACTION_DOCUMENT'
        AND object_key = NEW.storage_object_key
        AND sha256_hex = lower(NEW.sha256_hex)
      LIMIT 1;
    END IF;

    IF v_trust_id IS NULL OR v_trust IS DISTINCT FROM 'CLEAN' THEN
      RAISE EXCEPTION 'matching CLEAN object trust is required before document verification/signing/execution';
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

CREATE OR REPLACE FUNCTION preneura_document_signature_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_document_status text;
  v_document_category text;
  v_contract_trust text;
  v_signature_trust_id uuid;
  v_signature_trust text;
  v_template_id uuid;
  v_signing_order integer;
  v_missing_earlier integer;
  v_tenant_id uuid;
  v_project_id uuid;
BEGIN
  IF TG_OP IN ('UPDATE','DELETE') THEN
    RAISE EXCEPTION 'contract signatures are immutable evidence';
  END IF;

  SELECT d.status, d.category, d.template_id, trust.status, d.tenant_id, d.project_id
  INTO v_document_status, v_document_category, v_template_id, v_contract_trust, v_tenant_id, v_project_id
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
    IF NEW.object_trust_id IS NULL THEN
      SELECT id, status INTO v_signature_trust_id, v_signature_trust
      FROM storage_object_trust
      WHERE tenant_id = v_tenant_id
        AND project_id = v_project_id
        AND purpose = 'SIGNATURE'
        AND object_key = NEW.signature_object_key
        AND sha256_hex = lower(NEW.signature_sha256_hex)
      LIMIT 1;
      NEW.object_trust_id := v_signature_trust_id;
    ELSE
      SELECT id, status INTO v_signature_trust_id, v_signature_trust
      FROM storage_object_trust
      WHERE id = NEW.object_trust_id
        AND tenant_id = v_tenant_id
        AND project_id = v_project_id
        AND purpose = 'SIGNATURE'
        AND object_key = NEW.signature_object_key
        AND sha256_hex = lower(NEW.signature_sha256_hex)
      LIMIT 1;
    END IF;

    IF v_signature_trust_id IS NULL OR v_signature_trust IS DISTINCT FROM 'CLEAN' THEN
      RAISE EXCEPTION 'uploaded signature requires its matching CLEAN trusted object';
    END IF;
  ELSIF NEW.object_trust_id IS NOT NULL THEN
    RAISE EXCEPTION 'non-object signature must not reference object trust';
  END IF;

  RETURN NEW;
END;
$$;

COMMIT;
