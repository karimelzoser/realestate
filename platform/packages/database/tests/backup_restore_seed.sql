\set ON_ERROR_STOP on

BEGIN;

INSERT INTO users (id, display_name, status) VALUES
  ('00000000-0000-0000-0000-000000000001', 'Backup Buyer', 'ACTIVE'),
  ('00000000-0000-0000-0000-000000000002', 'Backup Company Signer', 'ACTIVE'),
  ('00000000-0000-0000-0000-000000000003', 'Backup Broker Agent', 'ACTIVE');

INSERT INTO tenants (id, code, name, status, default_currency, default_timezone)
VALUES ('00000000-0000-0000-0000-000000001000', 'BACKUP', 'Backup Certification Tenant', 'ACTIVE', 'EGP', 'Africa/Cairo');

INSERT INTO projects (id, tenant_id, code, name, status, currency, timezone)
VALUES (
  '00000000-0000-0000-0000-000000002000',
  '00000000-0000-0000-0000-000000001000',
  'BACKUP-PROJECT', 'Backup Certification Project', 'ACTIVE', 'EGP', 'Africa/Cairo'
);

INSERT INTO broker_companies (id, tenant_id, code, name, status)
VALUES (
  '00000000-0000-0000-0000-000000003000',
  '00000000-0000-0000-0000-000000001000',
  'BACKUP-BROKER', 'Backup Broker Company', 'ACTIVE'
);

INSERT INTO broker_project_access (broker_company_id, tenant_id, project_id, status, effective_from)
VALUES (
  '00000000-0000-0000-0000-000000003000',
  '00000000-0000-0000-0000-000000001000',
  '00000000-0000-0000-0000-000000002000',
  'ACTIVE', '2026-01-01T00:00:00+00'
);

INSERT INTO catalog_unit_types (
  id, tenant_id, project_id, code, name, indoor_area_sqm, roof_area_sqm,
  garden_area_sqm, status, sort_order
) VALUES (
  '00000000-0000-0000-0000-000000004000',
  '00000000-0000-0000-0000-000000001000',
  '00000000-0000-0000-0000-000000002000',
  'BACKUP-A', 'Backup Type A', 100, 20, 30, 'ACTIVE', 1
);

INSERT INTO pricing_versions (
  id, tenant_id, project_id, version_number, label, status, effective_at,
  published_at, published_by, created_by
) VALUES (
  '00000000-0000-0000-0000-000000005000',
  '00000000-0000-0000-0000-000000001000',
  '00000000-0000-0000-0000-000000002000',
  1, 'Backup Price', 'PUBLISHED', '2026-01-01T00:00:00+00',
  '2026-01-01T00:00:00+00', '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000001'
);

INSERT INTO pricing_rates (
  tenant_id, project_id, pricing_version_id, unit_type_id, component, rate_per_sqm
) VALUES
  ('00000000-0000-0000-0000-000000001000','00000000-0000-0000-0000-000000002000','00000000-0000-0000-0000-000000005000','00000000-0000-0000-0000-000000004000','INDOOR',2000),
  ('00000000-0000-0000-0000-000000001000','00000000-0000-0000-0000-000000002000','00000000-0000-0000-0000-000000005000','00000000-0000-0000-0000-000000004000','ROOF',500),
  ('00000000-0000-0000-0000-000000001000','00000000-0000-0000-0000-000000002000','00000000-0000-0000-0000-000000005000','00000000-0000-0000-0000-000000004000','GARDEN',750);

INSERT INTO buyer_profiles (id, tenant_id, user_id, status, source, created_by)
VALUES (
  '00000000-0000-0000-0000-000000006000',
  '00000000-0000-0000-0000-000000001000',
  '00000000-0000-0000-0000-000000000001',
  'ACTIVE', 'DIRECT', '00000000-0000-0000-0000-000000000001'
);

INSERT INTO eoi_refund_policies (
  id, tenant_id, project_id, version_number, name, status, eoi_amount, currency,
  effective_at, published_at, created_by, published_by
) VALUES (
  '00000000-0000-0000-0000-000000007000',
  '00000000-0000-0000-0000-000000001000',
  '00000000-0000-0000-0000-000000002000',
  1, 'Backup EOI', 'ACTIVE', 1000, 'EGP',
  '2025-12-01T00:00:00+00', '2025-12-01T00:00:00+00',
  '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001'
);

INSERT INTO buyer_eois (
  id, tenant_id, project_id, buyer_profile_id, refund_policy_id,
  amount, currency, status, payment_reference, paid_at, created_by
) VALUES (
  '00000000-0000-0000-0000-000000008000',
  '00000000-0000-0000-0000-000000001000',
  '00000000-0000-0000-0000-000000002000',
  '00000000-0000-0000-0000-000000006000',
  '00000000-0000-0000-0000-000000007000',
  1000, 'EGP', 'PAID', 'BACKUP-EOI', '2025-12-15T00:00:00+00',
  '00000000-0000-0000-0000-000000000001'
);

INSERT INTO queue_entries (
  id, tenant_id, project_id, buyer_profile_id, eoi_id, channel,
  priority_group, priority_score, status, checked_in_at, created_by
) VALUES (
  '00000000-0000-0000-0000-000000009000',
  '00000000-0000-0000-0000-000000001000',
  '00000000-0000-0000-0000-000000002000',
  '00000000-0000-0000-0000-000000006000',
  '00000000-0000-0000-0000-000000008000',
  'ONLINE', 'STANDARD', 0, 'WAITING', '2026-01-02T00:00:00+00',
  '00000000-0000-0000-0000-000000000001'
);

INSERT INTO inventory_slots (id, tenant_id, project_id, unit_type_id, state, internal_reference)
VALUES (
  '00000000-0000-0000-0000-000000010000',
  '00000000-0000-0000-0000-000000001000',
  '00000000-0000-0000-0000-000000002000',
  '00000000-0000-0000-0000-000000004000',
  'AVAILABLE', 'BACKUP-SLOT-001'
);

INSERT INTO inventory_locks (
  id, tenant_id, project_id, unit_type_id, inventory_slot_id, buyer_user_id,
  locked_by_user_id, status, expires_at, created_at, updated_at
) VALUES (
  '00000000-0000-0000-0000-000000011000',
  '00000000-0000-0000-0000-000000001000',
  '00000000-0000-0000-0000-000000002000',
  '00000000-0000-0000-0000-000000004000',
  '00000000-0000-0000-0000-000000010000',
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000001',
  'ACTIVE', '2026-01-03T00:00:00+00', '2026-01-02T00:00:00+00', '2026-01-02T00:00:00+00'
);

INSERT INTO reservations (
  id, tenant_id, project_id, buyer_profile_id, queue_entry_id, inventory_lock_id,
  inventory_slot_id, unit_type_id, pricing_version_id, quoted_total, currency,
  status, reserved_by, reserved_at, created_at, updated_at
) VALUES (
  '00000000-0000-0000-0000-000000012000',
  '00000000-0000-0000-0000-000000001000',
  '00000000-0000-0000-0000-000000002000',
  '00000000-0000-0000-0000-000000006000',
  '00000000-0000-0000-0000-000000009000',
  '00000000-0000-0000-0000-000000011000',
  '00000000-0000-0000-0000-000000010000',
  '00000000-0000-0000-0000-000000004000',
  '00000000-0000-0000-0000-000000005000',
  232500, 'EGP', 'ACTIVE', '00000000-0000-0000-0000-000000000001',
  '2026-01-02T00:00:00+00', '2026-01-02T00:00:00+00', '2026-01-02T00:00:00+00'
);

INSERT INTO transactions (id, tenant_id, project_id, reservation_id, buyer_profile_id, status, opened_at)
VALUES (
  '00000000-0000-0000-0000-000000013000',
  '00000000-0000-0000-0000-000000001000',
  '00000000-0000-0000-0000-000000002000',
  '00000000-0000-0000-0000-000000012000',
  '00000000-0000-0000-0000-000000006000',
  'IN_PROGRESS', '2026-01-02T00:05:00+00'
);

INSERT INTO transaction_milestones (transaction_id, code, label, weight_percent, status)
VALUES
  ('00000000-0000-0000-0000-000000013000','BUYER_DOCUMENTS_COMPLETE','Buyer documents complete',10,'PENDING'),
  ('00000000-0000-0000-0000-000000013000','DOWN_PAYMENT_RECEIVED','Down payment received',20,'PENDING'),
  ('00000000-0000-0000-0000-000000013000','CHEQUES_RECEIVED','Cheques received',20,'PENDING'),
  ('00000000-0000-0000-0000-000000013000','CONTRACT_GENERATED','Contract generated',10,'PENDING'),
  ('00000000-0000-0000-0000-000000013000','CONTRACT_SIGNED','Contract signed',20,'PENDING'),
  ('00000000-0000-0000-0000-000000013000','CONTRACT_STAMPED','Contract executed',20,'PENDING');

-- Trusted contract template object.
INSERT INTO storage_object_trust (
  id, tenant_id, project_id, purpose, object_key, declared_mime_type, byte_size, sha256_hex, status
) VALUES (
  '00000000-0000-0000-0000-000000014001',
  '00000000-0000-0000-0000-000000001000', '00000000-0000-0000-0000-000000002000',
  'DOCUMENT_TEMPLATE', 'backup/template.pdf', 'application/pdf', 1200, repeat('a',64), 'PENDING_SCAN'
);
INSERT INTO storage_object_scan_attempts (
  object_trust_id, attempt_number, provider, result, detected_mime_type,
  engine_version, provider_reference, started_at, completed_at
) VALUES (
  '00000000-0000-0000-0000-000000014001', 1, 'BACKUP_TEST', 'CLEAN', 'application/pdf',
  '1.0', 'backup-template-scan', '2026-01-02T00:10:00+00', '2026-01-02T00:10:01+00'
);
UPDATE storage_object_trust SET
  status='CLEAN', detected_mime_type='application/pdf', scanner_provider='BACKUP_TEST',
  scanner_reference='backup-template-scan', scanned_at='2026-01-02T00:10:01+00', updated_at='2026-01-02T00:10:01+00'
WHERE id='00000000-0000-0000-0000-000000014001';

INSERT INTO document_templates (
  id, tenant_id, project_id, code, name, category, version_number, status,
  storage_object_key, sha256_hex, mime_type, requires_signature, created_by, activated_at
) VALUES (
  '00000000-0000-0000-0000-000000014002',
  '00000000-0000-0000-0000-000000001000', '00000000-0000-0000-0000-000000002000',
  'CONTRACT', 'Backup Contract', 'CONTRACT', 1, 'ACTIVE', 'backup/template.pdf', repeat('a',64),
  'application/pdf', true, '00000000-0000-0000-0000-000000000001', '2026-01-02T00:11:00+00'
);
INSERT INTO document_template_signer_requirements (template_id, signer_role, signing_order, required)
VALUES
  ('00000000-0000-0000-0000-000000014002','BUYER',1,true),
  ('00000000-0000-0000-0000-000000014002','COMPANY',2,true);

-- Trusted transaction contract object.
INSERT INTO storage_object_trust (
  id, tenant_id, project_id, purpose, object_key, declared_mime_type, byte_size, sha256_hex, status
) VALUES (
  '00000000-0000-0000-0000-000000014003',
  '00000000-0000-0000-0000-000000001000', '00000000-0000-0000-0000-000000002000',
  'TRANSACTION_DOCUMENT', 'backup/contract.pdf', 'application/pdf', 5000, repeat('b',64), 'PENDING_SCAN'
);
INSERT INTO storage_object_scan_attempts (
  object_trust_id, attempt_number, provider, result, detected_mime_type,
  engine_version, provider_reference, started_at, completed_at
) VALUES (
  '00000000-0000-0000-0000-000000014003', 1, 'BACKUP_TEST', 'CLEAN', 'application/pdf',
  '1.0', 'backup-contract-scan', '2026-01-02T00:12:30+00', '2026-01-02T00:12:31+00'
);
UPDATE storage_object_trust SET
  status='CLEAN', detected_mime_type='application/pdf', scanner_provider='BACKUP_TEST',
  scanner_reference='backup-contract-scan', scanned_at='2026-01-02T00:12:31+00', updated_at='2026-01-02T00:12:31+00'
WHERE id='00000000-0000-0000-0000-000000014003';

INSERT INTO transaction_documents (
  id, tenant_id, project_id, transaction_id, template_id, category, revision_number, status,
  storage_object_key, original_filename, mime_type, byte_size, sha256_hex,
  uploaded_by, uploaded_at, verified_by, verified_at
) VALUES (
  '00000000-0000-0000-0000-000000014004',
  '00000000-0000-0000-0000-000000001000', '00000000-0000-0000-0000-000000002000',
  '00000000-0000-0000-0000-000000013000', '00000000-0000-0000-0000-000000014002',
  'CONTRACT', 1, 'VERIFIED', 'backup/contract.pdf', 'backup-contract.pdf', 'application/pdf', 5000,
  repeat('b',64), '00000000-0000-0000-0000-000000000001', '2026-01-02T00:12:00+00',
  '00000000-0000-0000-0000-000000000001', '2026-01-02T00:13:00+00'
);

-- Trusted buyer signature object, then ordered buyer/company signatures.
INSERT INTO storage_object_trust (
  id, tenant_id, project_id, purpose, object_key, declared_mime_type, byte_size, sha256_hex, status
) VALUES (
  '00000000-0000-0000-0000-000000014005',
  '00000000-0000-0000-0000-000000001000', '00000000-0000-0000-0000-000000002000',
  'SIGNATURE', 'backup/buyer-signature.png', 'image/png', 800, repeat('c',64), 'PENDING_SCAN'
);
INSERT INTO storage_object_scan_attempts (
  object_trust_id, attempt_number, provider, result, detected_mime_type,
  engine_version, provider_reference, started_at, completed_at
) VALUES (
  '00000000-0000-0000-0000-000000014005', 1, 'BACKUP_TEST', 'CLEAN', 'image/png',
  '1.0', 'backup-signature-scan', '2026-01-02T00:14:11+00', '2026-01-02T00:14:12+00'
);
UPDATE storage_object_trust SET
  status='CLEAN', detected_mime_type='image/png', scanner_provider='BACKUP_TEST',
  scanner_reference='backup-signature-scan', scanned_at='2026-01-02T00:14:12+00', updated_at='2026-01-02T00:14:12+00'
WHERE id='00000000-0000-0000-0000-000000014005';

INSERT INTO document_signatures (
  document_id, signer_role, signer_user_id, method, signature_object_key, signature_sha256_hex, signed_at
) VALUES (
  '00000000-0000-0000-0000-000000014004', 'BUYER', '00000000-0000-0000-0000-000000000001',
  'DRAWN', 'backup/buyer-signature.png', repeat('c',64), '2026-01-02T00:14:20+00'
);
INSERT INTO document_signatures (document_id, signer_role, signer_user_id, method, typed_name, signed_at)
VALUES (
  '00000000-0000-0000-0000-000000014004', 'COMPANY', '00000000-0000-0000-0000-000000000002',
  'TYPED', 'Backup Company', '2026-01-02T00:15:00+00'
);
UPDATE transaction_documents SET status='SIGNED', updated_at='2026-01-02T00:15:01+00'
WHERE id='00000000-0000-0000-0000-000000014004';
UPDATE transaction_documents SET
  status='STAMPED', stamped_by='00000000-0000-0000-0000-000000000002',
  stamped_at='2026-01-02T00:16:00+00', updated_at='2026-01-02T00:16:00+00'
WHERE id='00000000-0000-0000-0000-000000014004';

-- Financial evidence: one fully allocated down payment and immutable cheque replacement history.
INSERT INTO payment_schedules (
  id, tenant_id, project_id, transaction_id, currency, total_contract_amount, status, created_by, activated_at
) VALUES (
  '00000000-0000-0000-0000-000000015000',
  '00000000-0000-0000-0000-000000001000', '00000000-0000-0000-0000-000000002000',
  '00000000-0000-0000-0000-000000013000', 'EGP', 232500, 'ACTIVE',
  '00000000-0000-0000-0000-000000000001', '2026-01-02T00:20:00+00'
);
INSERT INTO payment_schedule_items (
  id, payment_schedule_id, sequence_number, item_type, amount, due_at, status, updated_at
) VALUES
  ('00000000-0000-0000-0000-000000015001','00000000-0000-0000-0000-000000015000',1,'DOWN_PAYMENT',100000,'2026-01-10T00:00:00+00','UPCOMING','2026-01-02T00:20:00+00'),
  ('00000000-0000-0000-0000-000000015002','00000000-0000-0000-0000-000000015000',2,'INSTALLMENT',132500,'2026-02-10T00:00:00+00','UPCOMING','2026-01-02T00:20:00+00');

SELECT preneura_post_finance_event(
  '00000000-0000-0000-0000-000000001000',
  '00000000-0000-0000-0000-000000002000',
  '00000000-0000-0000-0000-000000013000',
  'PAYMENT_RECEIVED', 100000, 'EGP', 'MANUAL', 'BACKUP-PAYMENT-001',
  '00000000-0000-0000-0000-000000000001', '2026-01-05T00:00:00+00',
  jsonb_build_array(jsonb_build_object('paymentItemId','00000000-0000-0000-0000-000000015001'::uuid,'amount',100000))
);

INSERT INTO transaction_cheques (
  id, tenant_id, project_id, transaction_id, sequence_number, amount, due_at, status, verified_by, updated_at
) VALUES (
  '00000000-0000-0000-0000-000000015003',
  '00000000-0000-0000-0000-000000001000', '00000000-0000-0000-0000-000000002000',
  '00000000-0000-0000-0000-000000013000', 1, 132500, '2026-03-01T00:00:00+00',
  'EXPECTED', '00000000-0000-0000-0000-000000000001', '2026-01-06T00:00:00+00'
);
SELECT preneura_record_cheque_event(
  '00000000-0000-0000-0000-000000015003', 'RECEIVED',
  '00000000-0000-0000-0000-000000000001', '2026-01-07T00:00:00+00', 'BACKUP-CHK-001', 'Backup Bank'
);
SELECT preneura_record_cheque_event(
  '00000000-0000-0000-0000-000000015003', 'DEPOSITED',
  '00000000-0000-0000-0000-000000000001', '2026-01-08T00:00:00+00', NULL, NULL
);
SELECT preneura_record_cheque_event(
  '00000000-0000-0000-0000-000000015003', 'RETURNED',
  '00000000-0000-0000-0000-000000000001', '2026-01-09T00:00:00+00', NULL, NULL
);
SELECT preneura_replace_returned_cheque(
  '00000000-0000-0000-0000-000000015003',
  '00000000-0000-0000-0000-000000000001', 132500, '2026-03-15T00:00:00+00',
  'BACKUP-CHK-002', 'Backup Bank', '2026-01-10T00:00:00+00'
);
SELECT preneura_record_cheque_event(
  (SELECT id FROM transaction_cheques WHERE root_cheque_id='00000000-0000-0000-0000-000000015003' AND generation=2),
  'RECEIVED', '00000000-0000-0000-0000-000000000001', '2026-01-11T00:00:00+00', NULL, NULL
);

-- Representative commission evidence linked to the same transaction.
INSERT INTO broker_commission_plans (
  id, tenant_id, project_id, broker_company_id, version_number, status,
  rate_percent, due_days_after_eligibility, effective_at, activated_at, created_by
) VALUES (
  '00000000-0000-0000-0000-000000015004',
  '00000000-0000-0000-0000-000000001000', '00000000-0000-0000-0000-000000002000',
  '00000000-0000-0000-0000-000000003000', 1, 'ACTIVE', 5.0000, 30,
  '2026-01-01T00:00:00+00', '2026-01-01T00:00:00+00', '00000000-0000-0000-0000-000000000002'
);
INSERT INTO broker_commission_cases (
  id, tenant_id, project_id, transaction_id, broker_company_id, broker_agent_user_id,
  commission_plan_id, basis_amount, rate_percent, commission_amount, status,
  completion_percent_snapshot, eligible_at, due_at
) VALUES (
  '00000000-0000-0000-0000-000000015005',
  '00000000-0000-0000-0000-000000001000', '00000000-0000-0000-0000-000000002000',
  '00000000-0000-0000-0000-000000013000', '00000000-0000-0000-0000-000000003000',
  '00000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000015004',
  232500, 5.0000, 11625, 'ELIGIBLE', 90, '2026-01-11T00:05:00+00', '2026-02-10T00:05:00+00'
);

COMMIT;
