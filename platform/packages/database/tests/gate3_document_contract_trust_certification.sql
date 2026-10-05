\set ON_ERROR_STOP on

BEGIN;

DO $$
DECLARE
  v_user uuid;
  v_company_user uuid;
  v_tenant uuid;
  v_project uuid;
  v_unit_type uuid;
  v_pricing uuid;
  v_buyer uuid;
  v_policy uuid;
  v_eoi uuid;
  v_queue uuid;
  v_slot uuid;
  v_lock uuid;
  v_reservation uuid;
  v_transaction uuid;
  v_template_trust uuid;
  v_template uuid;
  v_doc_trust uuid;
  v_document uuid;
  v_signature_trust uuid;
  v_snapshot uuid;
  v_rejected boolean;
  v_manifest_hash text;
BEGIN
  INSERT INTO users (display_name, status)
  VALUES ('Gate 3 Buyer', 'ACTIVE') RETURNING id INTO v_user;
  INSERT INTO users (display_name, status)
  VALUES ('Gate 3 Company Signer', 'ACTIVE') RETURNING id INTO v_company_user;

  INSERT INTO tenants (code, name, status, default_currency, default_timezone)
  VALUES ('GATE3-DOC', 'Gate 3 Document Tenant', 'ACTIVE', 'EGP', 'Africa/Cairo')
  RETURNING id INTO v_tenant;

  INSERT INTO projects (tenant_id, code, name, status, currency, timezone)
  VALUES (v_tenant, 'GATE3-DOC', 'Gate 3 Document Project', 'ACTIVE', 'EGP', 'Africa/Cairo')
  RETURNING id INTO v_project;

  INSERT INTO catalog_unit_types (
    tenant_id, project_id, code, name, indoor_area_sqm, roof_area_sqm,
    garden_area_sqm, status, sort_order
  ) VALUES (
    v_tenant, v_project, 'TYPE-A', 'Type A', 100, 20, 30, 'ACTIVE', 1
  ) RETURNING id INTO v_unit_type;

  INSERT INTO pricing_versions (
    tenant_id, project_id, version_number, label, status, effective_at, created_by
  ) VALUES (
    v_tenant, v_project, 1, 'Gate 3 Price', 'DRAFT', '2026-01-01T00:00:00+00', v_user
  ) RETURNING id INTO v_pricing;

  INSERT INTO pricing_rates (
    tenant_id, project_id, pricing_version_id, unit_type_id, component, rate_per_sqm
  ) VALUES
    (v_tenant, v_project, v_pricing, v_unit_type, 'INDOOR', 2000),
    (v_tenant, v_project, v_pricing, v_unit_type, 'ROOF', 500),
    (v_tenant, v_project, v_pricing, v_unit_type, 'GARDEN', 750);

  UPDATE pricing_versions
  SET status = 'PUBLISHED', published_at = '2026-01-01T00:00:00+00',
      published_by = v_user, updated_at = '2026-01-01T00:00:00+00'
  WHERE id = v_pricing;

  INSERT INTO buyer_profiles (tenant_id, user_id, status, source, created_by)
  VALUES (v_tenant, v_user, 'ACTIVE', 'DIRECT', v_user)
  RETURNING id INTO v_buyer;

  INSERT INTO eoi_refund_policies (
    tenant_id, project_id, version_number, name, status, eoi_amount, currency,
    effective_at, published_at, created_by, published_by
  ) VALUES (
    v_tenant, v_project, 1, 'Gate 3 EOI', 'ACTIVE', 1000, 'EGP',
    '2025-12-01T00:00:00+00', '2025-12-01T00:00:00+00', v_user, v_user
  ) RETURNING id INTO v_policy;

  INSERT INTO buyer_eois (
    tenant_id, project_id, buyer_profile_id, refund_policy_id,
    amount, currency, status, payment_reference, paid_at, created_by
  ) VALUES (
    v_tenant, v_project, v_buyer, v_policy, 1000, 'EGP', 'PAID',
    'GATE3-EOI', '2025-12-15T00:00:00+00', v_user
  ) RETURNING id INTO v_eoi;

  INSERT INTO queue_entries (
    tenant_id, project_id, buyer_profile_id, eoi_id, channel,
    priority_group, priority_score, status, checked_in_at, created_by
  ) VALUES (
    v_tenant, v_project, v_buyer, v_eoi, 'ONLINE',
    'STANDARD', 0, 'WAITING', '2026-01-02T00:00:00+00', v_user
  ) RETURNING id INTO v_queue;

  INSERT INTO inventory_slots (tenant_id, project_id, unit_type_id, state, internal_reference)
  VALUES (v_tenant, v_project, v_unit_type, 'AVAILABLE', 'GATE3-SLOT')
  RETURNING id INTO v_slot;

  INSERT INTO inventory_locks (
    tenant_id, project_id, unit_type_id, inventory_slot_id, buyer_user_id,
    locked_by_user_id, status, expires_at, created_at, updated_at
  ) VALUES (
    v_tenant, v_project, v_unit_type, v_slot, v_user,
    v_user, 'ACTIVE', '2026-01-03T00:00:00+00',
    '2026-01-02T00:00:00+00', '2026-01-02T00:00:00+00'
  ) RETURNING id INTO v_lock;

  INSERT INTO reservations (
    tenant_id, project_id, buyer_profile_id, queue_entry_id, inventory_lock_id,
    inventory_slot_id, unit_type_id, pricing_version_id, quoted_total, currency,
    status, reserved_by, reserved_at, created_at, updated_at
  ) VALUES (
    v_tenant, v_project, v_buyer, v_queue, v_lock,
    v_slot, v_unit_type, v_pricing, 232500, 'EGP',
    'ACTIVE', v_user, '2026-01-02T00:00:00+00',
    '2026-01-02T00:00:00+00', '2026-01-02T00:00:00+00'
  ) RETURNING id INTO v_reservation;

  INSERT INTO transactions (
    tenant_id, project_id, reservation_id, buyer_profile_id, status, opened_at
  ) VALUES (
    v_tenant, v_project, v_reservation, v_buyer, 'IN_PROGRESS', '2026-01-02T00:05:00+00'
  ) RETURNING id INTO v_transaction;

  INSERT INTO transaction_milestones (transaction_id, code, label, weight_percent, status)
  VALUES
    (v_transaction, 'CONTRACT_GENERATED', 'Contract generated', 20, 'PENDING'),
    (v_transaction, 'CONTRACT_SIGNED', 'Contract signed', 30, 'PENDING'),
    (v_transaction, 'CONTRACT_STAMPED', 'Contract executed', 50, 'PENDING');

  -- Trust cannot be forged without immutable scan evidence.
  INSERT INTO storage_object_trust (
    tenant_id, project_id, purpose, object_key, declared_mime_type,
    byte_size, sha256_hex, status
  ) VALUES (
    v_tenant, v_project, 'DOCUMENT_TEMPLATE', 'gate3/template.pdf', 'application/pdf',
    1200, repeat('a', 64), 'PENDING_SCAN'
  ) RETURNING id INTO v_template_trust;

  v_rejected := false;
  BEGIN
    UPDATE storage_object_trust
    SET status = 'CLEAN', detected_mime_type = 'application/pdf',
        scanner_provider = 'FORGED', scanned_at = '2026-01-02T00:10:00+00'
    WHERE id = v_template_trust;
  EXCEPTION WHEN OTHERS THEN
    v_rejected := position('requires immutable scan evidence' in SQLERRM) > 0;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'database allowed CLEAN trust without scan evidence';
  END IF;

  -- An ACTIVE template cannot bind to a pending/untrusted object.
  v_rejected := false;
  BEGIN
    INSERT INTO document_templates (
      tenant_id, project_id, code, name, category, version_number, status,
      storage_object_key, sha256_hex, mime_type, requires_signature,
      created_by, activated_at
    ) VALUES (
      v_tenant, v_project, 'CONTRACT', 'Gate 3 Contract', 'CONTRACT', 1, 'ACTIVE',
      'gate3/template.pdf', repeat('a', 64), 'application/pdf', true,
      v_user, '2026-01-02T00:10:00+00'
    );
  EXCEPTION WHEN OTHERS THEN
    v_rejected := position('CLEAN trusted object' in SQLERRM) > 0;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'database activated a template without CLEAN trust';
  END IF;

  INSERT INTO storage_object_scan_attempts (
    object_trust_id, attempt_number, provider, result, detected_mime_type,
    engine_version, provider_reference, started_at, completed_at
  ) VALUES (
    v_template_trust, 1, 'CLAMAV_TEST', 'CLEAN', 'application/pdf',
    '1.0', 'template-scan-1', '2026-01-02T00:10:00+00', '2026-01-02T00:10:01+00'
  );

  UPDATE storage_object_trust
  SET status = 'CLEAN', detected_mime_type = 'application/pdf',
      scanner_provider = 'CLAMAV_TEST', scanner_reference = 'template-scan-1',
      scanner_signature = NULL, last_error_code = NULL,
      scanned_at = '2026-01-02T00:10:01+00', updated_at = '2026-01-02T00:10:01+00'
  WHERE id = v_template_trust;

  INSERT INTO document_templates (
    tenant_id, project_id, code, name, category, version_number, status,
    storage_object_key, sha256_hex, mime_type, requires_signature,
    created_by, activated_at
  ) VALUES (
    v_tenant, v_project, 'CONTRACT', 'Gate 3 Contract', 'CONTRACT', 1, 'ACTIVE',
    'gate3/template.pdf', repeat('a', 64), 'application/pdf', true,
    v_user, '2026-01-02T00:11:00+00'
  ) RETURNING id INTO v_template;

  IF (SELECT object_trust_id FROM document_templates WHERE id = v_template) IS DISTINCT FROM v_template_trust THEN
    RAISE EXCEPTION 'template did not bind to matching CLEAN trust record';
  END IF;

  INSERT INTO document_template_signer_requirements (
    template_id, signer_role, signing_order, required
  ) VALUES
    (v_template, 'BUYER', 1, true),
    (v_template, 'COMPANY', 2, true);

  INSERT INTO storage_object_trust (
    tenant_id, project_id, purpose, object_key, declared_mime_type,
    byte_size, sha256_hex, status
  ) VALUES (
    v_tenant, v_project, 'TRANSACTION_DOCUMENT', 'gate3/contract.pdf', 'application/pdf',
    5000, repeat('b', 64), 'PENDING_SCAN'
  ) RETURNING id INTO v_doc_trust;

  INSERT INTO transaction_documents (
    tenant_id, project_id, transaction_id, template_id, category,
    revision_number, status, storage_object_key, original_filename,
    mime_type, byte_size, sha256_hex, uploaded_by, uploaded_at,
    verified_by, verified_at
  ) VALUES (
    v_tenant, v_project, v_transaction, v_template, 'CONTRACT',
    1, 'UPLOADED', 'gate3/contract.pdf', 'contract.pdf',
    'application/pdf', 5000, repeat('b', 64), v_user,
    '2026-01-02T00:12:00+00', NULL, NULL
  ) RETURNING id INTO v_document;

  v_rejected := false;
  BEGIN
    UPDATE transaction_documents
    SET status = 'VERIFIED', verified_by = v_user,
        verified_at = '2026-01-02T00:13:00+00', updated_at = '2026-01-02T00:13:00+00'
    WHERE id = v_document;
  EXCEPTION WHEN OTHERS THEN
    v_rejected := position('CLEAN object trust' in SQLERRM) > 0;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'database verified an untrusted transaction document';
  END IF;

  INSERT INTO storage_object_scan_attempts (
    object_trust_id, attempt_number, provider, result, detected_mime_type,
    engine_version, provider_reference, started_at, completed_at
  ) VALUES (
    v_doc_trust, 1, 'CLAMAV_TEST', 'CLEAN', 'application/pdf',
    '1.0', 'contract-scan-1', '2026-01-02T00:12:30+00', '2026-01-02T00:12:31+00'
  );
  UPDATE storage_object_trust
  SET status = 'CLEAN', detected_mime_type = 'application/pdf',
      scanner_provider = 'CLAMAV_TEST', scanner_reference = 'contract-scan-1',
      scanner_signature = NULL, last_error_code = NULL,
      scanned_at = '2026-01-02T00:12:31+00', updated_at = '2026-01-02T00:12:31+00'
  WHERE id = v_doc_trust;

  UPDATE transaction_documents
  SET status = 'VERIFIED', verified_by = v_user,
      verified_at = '2026-01-02T00:13:00+00', updated_at = '2026-01-02T00:13:00+00'
  WHERE id = v_document;

  IF (SELECT object_trust_id FROM transaction_documents WHERE id = v_document) IS DISTINCT FROM v_doc_trust THEN
    RAISE EXCEPTION 'verified document did not bind to matching CLEAN trust';
  END IF;

  -- Required signing order is enforced.
  v_rejected := false;
  BEGIN
    INSERT INTO document_signatures (
      document_id, signer_role, signer_user_id, method, typed_name, signed_at
    ) VALUES (
      v_document, 'COMPANY', v_company_user, 'TYPED', 'Gate 3 Company', '2026-01-02T00:14:00+00'
    );
  EXCEPTION WHEN OTHERS THEN
    v_rejected := position('earlier contract signers' in SQLERRM) > 0;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'database allowed COMPANY signature before required BUYER signature';
  END IF;

  INSERT INTO storage_object_trust (
    tenant_id, project_id, purpose, object_key, declared_mime_type,
    byte_size, sha256_hex, status
  ) VALUES (
    v_tenant, v_project, 'SIGNATURE', 'gate3/buyer-signature.png', 'image/png',
    800, repeat('c', 64), 'PENDING_SCAN'
  ) RETURNING id INTO v_signature_trust;

  v_rejected := false;
  BEGIN
    INSERT INTO document_signatures (
      document_id, signer_role, signer_user_id, method,
      signature_object_key, signature_sha256_hex, signed_at
    ) VALUES (
      v_document, 'BUYER', v_user, 'DRAWN',
      'gate3/buyer-signature.png', repeat('c', 64), '2026-01-02T00:14:10+00'
    );
  EXCEPTION WHEN OTHERS THEN
    v_rejected := position('CLEAN trusted object' in SQLERRM) > 0;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'database accepted an untrusted uploaded signature';
  END IF;

  INSERT INTO storage_object_scan_attempts (
    object_trust_id, attempt_number, provider, result, detected_mime_type,
    engine_version, provider_reference, started_at, completed_at
  ) VALUES (
    v_signature_trust, 1, 'CLAMAV_TEST', 'CLEAN', 'image/png',
    '1.0', 'signature-scan-1', '2026-01-02T00:14:11+00', '2026-01-02T00:14:12+00'
  );
  UPDATE storage_object_trust
  SET status = 'CLEAN', detected_mime_type = 'image/png',
      scanner_provider = 'CLAMAV_TEST', scanner_reference = 'signature-scan-1',
      scanner_signature = NULL, last_error_code = NULL,
      scanned_at = '2026-01-02T00:14:12+00', updated_at = '2026-01-02T00:14:12+00'
  WHERE id = v_signature_trust;

  INSERT INTO document_signatures (
    document_id, signer_role, signer_user_id, method,
    signature_object_key, signature_sha256_hex, signed_at
  ) VALUES (
    v_document, 'BUYER', v_user, 'DRAWN',
    'gate3/buyer-signature.png', repeat('c', 64), '2026-01-02T00:14:20+00'
  );

  IF (SELECT object_trust_id FROM document_signatures WHERE document_id = v_document AND signer_role = 'BUYER')
       IS DISTINCT FROM v_signature_trust THEN
    RAISE EXCEPTION 'uploaded signature did not bind to matching CLEAN trust';
  END IF;

  INSERT INTO document_signatures (
    document_id, signer_role, signer_user_id, method, typed_name, signed_at
  ) VALUES (
    v_document, 'COMPANY', v_company_user, 'TYPED', 'Gate 3 Company', '2026-01-02T00:15:00+00'
  );

  UPDATE transaction_documents
  SET status = 'SIGNED', updated_at = '2026-01-02T00:15:01+00'
  WHERE id = v_document;

  -- Once signatures exist, the contract cannot be replaced/superseded.
  v_rejected := false;
  BEGIN
    UPDATE transaction_documents
    SET status = 'SUPERSEDED', updated_at = '2026-01-02T00:15:02+00'
    WHERE id = v_document;
  EXCEPTION WHEN OTHERS THEN
    v_rejected := true;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'database allowed a signed contract to be superseded';
  END IF;

  -- Execution requires actor and timestamp.
  v_rejected := false;
  BEGIN
    UPDATE transaction_documents
    SET status = 'STAMPED', updated_at = '2026-01-02T00:16:00+00'
    WHERE id = v_document;
  EXCEPTION WHEN OTHERS THEN
    v_rejected := position('timestamp and executing actor' in SQLERRM) > 0;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'database executed contract without actor/timestamp';
  END IF;

  UPDATE transaction_documents
  SET status = 'STAMPED', stamped_by = v_company_user,
      stamped_at = '2026-01-02T00:16:00+00', updated_at = '2026-01-02T00:16:00+00'
  WHERE id = v_document;

  SELECT id INTO v_snapshot
  FROM contract_execution_snapshots
  WHERE document_id = v_document;
  IF v_snapshot IS NULL THEN
    RAISE EXCEPTION 'contract execution did not create immutable snapshot';
  END IF;

  IF (SELECT jsonb_array_length(price_components) FROM contract_execution_snapshots WHERE id = v_snapshot) <> 3 THEN
    RAISE EXCEPTION 'execution snapshot does not contain all certified price components';
  END IF;
  IF (SELECT jsonb_array_length(signatures) FROM contract_execution_snapshots WHERE id = v_snapshot) <> 2 THEN
    RAISE EXCEPTION 'execution snapshot does not contain all signer evidence';
  END IF;
  IF (SELECT quoted_total FROM contract_execution_snapshots WHERE id = v_snapshot) IS DISTINCT FROM 232500::numeric THEN
    RAISE EXCEPTION 'execution snapshot does not carry certified reservation total';
  END IF;

  SELECT encode(digest(convert_to(manifest::text, 'UTF8'), 'sha256'), 'hex')
  INTO v_manifest_hash
  FROM contract_execution_snapshots WHERE id = v_snapshot;
  IF v_manifest_hash IS DISTINCT FROM (
    SELECT manifest_sha256_hex FROM contract_execution_snapshots WHERE id = v_snapshot
  ) THEN
    RAISE EXCEPTION 'execution manifest hash does not verify';
  END IF;

  -- Executed evidence is immutable at every layer.
  v_rejected := false;
  BEGIN
    UPDATE contract_execution_snapshots
    SET quoted_total = quoted_total + 1 WHERE id = v_snapshot;
  EXCEPTION WHEN OTHERS THEN
    v_rejected := position('immutable legal evidence' in SQLERRM) > 0;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'database allowed execution snapshot mutation';
  END IF;

  v_rejected := false;
  BEGIN
    UPDATE transaction_documents SET original_filename = 'changed.pdf' WHERE id = v_document;
  EXCEPTION WHEN OTHERS THEN
    v_rejected := position('executed contract document is immutable' in SQLERRM) > 0;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'database allowed executed contract mutation';
  END IF;

  v_rejected := false;
  BEGIN
    DELETE FROM document_signatures WHERE document_id = v_document AND signer_role = 'BUYER';
  EXCEPTION WHEN OTHERS THEN
    v_rejected := position('immutable evidence' in SQLERRM) > 0;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'database allowed signature evidence deletion';
  END IF;

  v_rejected := false;
  BEGIN
    UPDATE storage_object_scan_attempts SET provider_reference = 'changed'
    WHERE object_trust_id = v_doc_trust AND attempt_number = 1;
  EXCEPTION WHEN OTHERS THEN
    v_rejected := position('immutable audit records' in SQLERRM) > 0;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'database allowed scan evidence mutation';
  END IF;
END $$;

ROLLBACK;
