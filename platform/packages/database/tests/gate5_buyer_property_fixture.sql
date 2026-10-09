\set ON_ERROR_STOP on

-- Deterministic Gate 5 fixture: two buyers share one project but own separate transactions.
INSERT INTO users (id, display_name, status) VALUES
  ('11111111-1111-4111-8111-111111111111', 'Gate 5 Buyer A', 'ACTIVE'),
  ('22222222-2222-4222-8222-222222222222', 'Gate 5 Buyer B', 'ACTIVE');

INSERT INTO tenants (id, code, name, status, default_currency, default_timezone)
VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'G5-BUYER', 'Gate 5 Buyer Tenant', 'ACTIVE', 'EGP', 'Africa/Cairo');

INSERT INTO projects (id, tenant_id, code, name, status, currency, timezone)
VALUES (
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'G5-PROPERTY', 'Gate 5 Buyer Property Project', 'ACTIVE', 'EGP', 'Africa/Cairo'
);

INSERT INTO tenant_memberships (tenant_id, user_id, status) VALUES
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '11111111-1111-4111-8111-111111111111', 'ACTIVE'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '22222222-2222-4222-8222-222222222222', 'ACTIVE');

INSERT INTO access_role_assignments (
  id, user_id, role_code, scope_type, tenant_id, project_id, status, granted_by
) VALUES
  (
    '11111111-aaaa-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111',
    'BUYER', 'PROJECT', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'ACTIVE', '11111111-1111-4111-8111-111111111111'
  ),
  (
    '22222222-aaaa-4222-8222-222222222222', '22222222-2222-4222-8222-222222222222',
    'BUYER', 'PROJECT', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'ACTIVE', '22222222-2222-4222-8222-222222222222'
  );

INSERT INTO catalog_unit_types (
  id, tenant_id, project_id, code, name, indoor_area_sqm, roof_area_sqm,
  garden_area_sqm, status, sort_order
) VALUES (
  'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  'TYPE-A', 'Type A', 1, 0, 0, 'ACTIVE', 1
);

INSERT INTO pricing_versions (
  id, tenant_id, project_id, version_number, label, status, effective_at,
  published_at, published_by, created_by
) VALUES (
  'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  1, 'Gate 5 price', 'DRAFT', '2026-01-01T00:00:00+00',
  NULL, NULL, '11111111-1111-4111-8111-111111111111'
);

INSERT INTO pricing_rates (
  tenant_id, project_id, pricing_version_id, unit_type_id, component, rate_per_sqm
) VALUES
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','dddddddd-dddd-4ddd-8ddd-dddddddddddd','cccccccc-cccc-4ccc-8ccc-cccccccccccc','INDOOR',300),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','dddddddd-dddd-4ddd-8ddd-dddddddddddd','cccccccc-cccc-4ccc-8ccc-cccccccccccc','ROOF',0),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','dddddddd-dddd-4ddd-8ddd-dddddddddddd','cccccccc-cccc-4ccc-8ccc-cccccccccccc','GARDEN',0);

UPDATE pricing_versions
SET status = 'PUBLISHED',
    published_at = '2026-01-01T00:00:00+00',
    published_by = '11111111-1111-4111-8111-111111111111',
    updated_at = '2026-01-01T00:00:00+00'
WHERE id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

INSERT INTO buyer_profiles (id, tenant_id, user_id, status, source, created_by) VALUES
  ('10000000-0000-4000-8000-000000000001','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11111111-1111-4111-8111-111111111111','ACTIVE','DIRECT','11111111-1111-4111-8111-111111111111'),
  ('20000000-0000-4000-8000-000000000002','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','22222222-2222-4222-8222-222222222222','ACTIVE','DIRECT','22222222-2222-4222-8222-222222222222');

INSERT INTO eoi_refund_policies (
  id, tenant_id, project_id, version_number, name, status, eoi_amount, currency,
  effective_at, published_at, created_by, published_by
) VALUES (
  'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  1,'Gate 5 EOI','ACTIVE',10,'EGP','2026-01-01T00:00:00+00','2026-01-01T00:00:00+00',
  '11111111-1111-4111-8111-111111111111','11111111-1111-4111-8111-111111111111'
);

INSERT INTO buyer_eois (
  id, tenant_id, project_id, buyer_profile_id, refund_policy_id, amount, currency, status, created_by
) VALUES
  ('10000000-0000-4000-8000-000000000011','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','10000000-0000-4000-8000-000000000001','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',10,'EGP','PAYMENT_PENDING','11111111-1111-4111-8111-111111111111'),
  ('20000000-0000-4000-8000-000000000012','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','20000000-0000-4000-8000-000000000002','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',10,'EGP','PAYMENT_PENDING','22222222-2222-4222-8222-222222222222');

SELECT preneura_post_eoi_payment(
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  '10000000-0000-4000-8000-000000000011','G5-EOI-A','11111111-1111-4111-8111-111111111111',
  '2026-01-02T00:00:00+00','MANUAL',NULL,NULL
);
SELECT preneura_post_eoi_payment(
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  '20000000-0000-4000-8000-000000000012','G5-EOI-B','22222222-2222-4222-8222-222222222222',
  '2026-01-02T00:00:00+00','MANUAL',NULL,NULL
);

INSERT INTO queue_entries (
  id, tenant_id, project_id, buyer_profile_id, eoi_id, channel, priority_group,
  priority_score, status, checked_in_at, created_by
) VALUES
  ('10000000-0000-4000-8000-000000000021','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000011','ONLINE','STANDARD',0,'WAITING','2026-01-03T00:00:00+00','11111111-1111-4111-8111-111111111111'),
  ('20000000-0000-4000-8000-000000000022','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','20000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000012','ONLINE','STANDARD',0,'WAITING','2026-01-03T00:01:00+00','22222222-2222-4222-8222-222222222222');

INSERT INTO inventory_slots (id, tenant_id, project_id, unit_type_id, state, internal_reference) VALUES
  ('10000000-0000-4000-8000-000000000031','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','cccccccc-cccc-4ccc-8ccc-cccccccccccc','AVAILABLE','PRIVATE-SLOT-A'),
  ('20000000-0000-4000-8000-000000000032','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','cccccccc-cccc-4ccc-8ccc-cccccccccccc','AVAILABLE','PRIVATE-SLOT-B');

INSERT INTO inventory_locks (
  id, tenant_id, project_id, unit_type_id, inventory_slot_id, buyer_user_id,
  locked_by_user_id, status, expires_at, created_at, updated_at
) VALUES
  ('10000000-0000-4000-8000-000000000041','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','cccccccc-cccc-4ccc-8ccc-cccccccccccc','10000000-0000-4000-8000-000000000031','11111111-1111-4111-8111-111111111111','11111111-1111-4111-8111-111111111111','ACTIVE','2027-01-01T00:00:00+00','2026-01-03T00:00:00+00','2026-01-03T00:00:00+00'),
  ('20000000-0000-4000-8000-000000000042','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','cccccccc-cccc-4ccc-8ccc-cccccccccccc','20000000-0000-4000-8000-000000000032','22222222-2222-4222-8222-222222222222','22222222-2222-4222-8222-222222222222','ACTIVE','2027-01-01T00:01:00+00','2026-01-03T00:01:00+00','2026-01-03T00:01:00+00');

INSERT INTO reservations (
  id, tenant_id, project_id, buyer_profile_id, queue_entry_id, inventory_lock_id,
  inventory_slot_id, unit_type_id, pricing_version_id, quoted_total, currency,
  status, reserved_by, reserved_at, created_at, updated_at
) VALUES
  ('10000000-0000-4000-8000-000000000051','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000021','10000000-0000-4000-8000-000000000041','10000000-0000-4000-8000-000000000031','cccccccc-cccc-4ccc-8ccc-cccccccccccc','dddddddd-dddd-4ddd-8ddd-dddddddddddd',300,'EGP','ACTIVE','11111111-1111-4111-8111-111111111111','2026-01-03T00:05:00+00','2026-01-03T00:05:00+00','2026-01-03T00:05:00+00'),
  ('20000000-0000-4000-8000-000000000052','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','20000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000022','20000000-0000-4000-8000-000000000042','20000000-0000-4000-8000-000000000032','cccccccc-cccc-4ccc-8ccc-cccccccccccc','dddddddd-dddd-4ddd-8ddd-dddddddddddd',300,'EGP','ACTIVE','22222222-2222-4222-8222-222222222222','2026-01-03T00:06:00+00','2026-01-03T00:06:00+00','2026-01-03T00:06:00+00');

INSERT INTO transactions (
  id, tenant_id, project_id, reservation_id, buyer_profile_id, status, opened_at
) VALUES
  ('10000000-0000-4000-8000-000000000061','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','10000000-0000-4000-8000-000000000051','10000000-0000-4000-8000-000000000001','IN_PROGRESS','2026-01-03T00:10:00+00'),
  ('20000000-0000-4000-8000-000000000062','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','20000000-0000-4000-8000-000000000052','20000000-0000-4000-8000-000000000002','IN_PROGRESS','2026-01-03T00:11:00+00');

INSERT INTO payment_schedules (
  id, tenant_id, project_id, transaction_id, currency, total_contract_amount,
  status, created_by, activated_at
) VALUES
  ('10000000-0000-4000-8000-000000000071','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','10000000-0000-4000-8000-000000000061','EGP',300,'ACTIVE','11111111-1111-4111-8111-111111111111','2026-01-03T00:12:00+00'),
  ('20000000-0000-4000-8000-000000000072','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','20000000-0000-4000-8000-000000000062','EGP',300,'ACTIVE','22222222-2222-4222-8222-222222222222','2026-01-03T00:12:00+00');

INSERT INTO payment_schedule_items (
  id, payment_schedule_id, sequence_number, item_type, amount, due_at, status, updated_at
) VALUES
  ('10000000-0000-4000-8000-000000000081','10000000-0000-4000-8000-000000000071',1,'DOWN_PAYMENT',100,'2026-01-10T00:00:00+00','UPCOMING','2026-01-03T00:12:00+00'),
  ('10000000-0000-4000-8000-000000000082','10000000-0000-4000-8000-000000000071',2,'INSTALLMENT',200,'2027-02-10T00:00:00+00','UPCOMING','2026-01-03T00:12:00+00'),
  ('20000000-0000-4000-8000-000000000083','20000000-0000-4000-8000-000000000072',1,'DOWN_PAYMENT',100,'2026-01-10T00:00:00+00','UPCOMING','2026-01-03T00:12:00+00'),
  ('20000000-0000-4000-8000-000000000084','20000000-0000-4000-8000-000000000072',2,'INSTALLMENT',200,'2027-02-10T00:00:00+00','UPCOMING','2026-01-03T00:12:00+00');

SELECT preneura_post_finance_event(
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  '10000000-0000-4000-8000-000000000061','PAYMENT_RECEIVED',100,'EGP','MANUAL','G5-PAY-A',
  '11111111-1111-4111-8111-111111111111','2026-01-05T00:00:00+00',
  jsonb_build_array(jsonb_build_object('paymentItemId','10000000-0000-4000-8000-000000000081','amount',100)),
  NULL,NULL,NULL,'{}'::jsonb
);
