\set ON_ERROR_STOP on

INSERT INTO users (id, display_name, status)
VALUES
  ('34000000-0000-0000-0000-000000000001', 'Lock Operator', 'ACTIVE'),
  ('34000000-0000-0000-0000-000000000002', 'Lock Buyer', 'ACTIVE'),
  ('34000000-0000-0000-0000-000000000003', 'Assigned Allocator', 'ACTIVE');

INSERT INTO tenants (id, code, name, status, default_currency, default_timezone)
VALUES ('34000000-0000-0000-0000-000000000010', 'LOCKCERT', 'Lock Certification', 'ACTIVE', 'EGP', 'Africa/Cairo');

INSERT INTO projects (id, tenant_id, code, name, status, currency, timezone)
VALUES (
  '34000000-0000-0000-0000-000000000020',
  '34000000-0000-0000-0000-000000000010',
  'LOCKCERT', 'Lock Certification Project', 'ACTIVE', 'EGP', 'Africa/Cairo'
);

INSERT INTO tenant_memberships (tenant_id, user_id, status)
VALUES
  ('34000000-0000-0000-0000-000000000010', '34000000-0000-0000-0000-000000000002', 'ACTIVE'),
  ('34000000-0000-0000-0000-000000000010', '34000000-0000-0000-0000-000000000003', 'ACTIVE');

INSERT INTO access_role_assignments (
  user_id, role_code, scope_type, tenant_id, project_id, broker_company_id, status
) VALUES (
  '34000000-0000-0000-0000-000000000003', 'ALLOCATOR', 'PROJECT',
  '34000000-0000-0000-0000-000000000010', '34000000-0000-0000-0000-000000000020', NULL, 'ACTIVE'
);

INSERT INTO catalog_unit_types (
  id, tenant_id, project_id, code, name, indoor_area_sqm, roof_area_sqm, garden_area_sqm, status
) VALUES (
  '34000000-0000-0000-0000-000000000030',
  '34000000-0000-0000-0000-000000000010',
  '34000000-0000-0000-0000-000000000020',
  'LOCK-TYPE', 'Lock Type', 100, 0, 0, 'ACTIVE'
);

INSERT INTO inventory_slots (id, tenant_id, project_id, unit_type_id, state, internal_reference)
SELECT
  ('34000000-0000-0000-0001-' || lpad(gs::text, 12, '0'))::uuid,
  '34000000-0000-0000-0000-000000000010'::uuid,
  '34000000-0000-0000-0000-000000000020'::uuid,
  '34000000-0000-0000-0000-000000000030'::uuid,
  'AVAILABLE',
  'CERT-' || gs
FROM generate_series(1, 5) gs;

-- Generic/non-allocator locks still follow the same lifecycle authority.
INSERT INTO inventory_locks (
  id, tenant_id, project_id, unit_type_id, inventory_slot_id,
  buyer_user_id, locked_by_user_id, status, expires_at, released_at, converted_at
) VALUES
(
  '34000000-0000-0000-0002-000000000001',
  '34000000-0000-0000-0000-000000000010',
  '34000000-0000-0000-0000-000000000020',
  '34000000-0000-0000-0000-000000000030',
  '34000000-0000-0000-0001-000000000001',
  '34000000-0000-0000-0000-000000000002',
  '34000000-0000-0000-0000-000000000001',
  'ACTIVE', now() + interval '1 minute', NULL, NULL
),
(
  '34000000-0000-0000-0002-000000000002',
  '34000000-0000-0000-0000-000000000010',
  '34000000-0000-0000-0000-000000000020',
  '34000000-0000-0000-0000-000000000030',
  '34000000-0000-0000-0001-000000000002',
  '34000000-0000-0000-0000-000000000002',
  '34000000-0000-0000-0000-000000000001',
  'ACTIVE', now() + interval '2 minutes', NULL, NULL
),
(
  '34000000-0000-0000-0002-000000000003',
  '34000000-0000-0000-0000-000000000010',
  '34000000-0000-0000-0000-000000000020',
  '34000000-0000-0000-0000-000000000030',
  '34000000-0000-0000-0001-000000000003',
  '34000000-0000-0000-0000-000000000002',
  '34000000-0000-0000-0000-000000000001',
  'ACTIVE', now() + interval '20 minutes', NULL, NULL
),
(
  '34000000-0000-0000-0002-000000000004',
  '34000000-0000-0000-0000-000000000010',
  '34000000-0000-0000-0000-000000000020',
  '34000000-0000-0000-0000-000000000030',
  '34000000-0000-0000-0001-000000000004',
  '34000000-0000-0000-0000-000000000002',
  '34000000-0000-0000-0000-000000000001',
  'CONVERTED', now() + interval '3 minutes', NULL, now()
);

DO $$
DECLARE
  v_count integer;
  v_sweep_time timestamptz := now() + interval '10 minutes';
BEGIN
  SELECT preneura_expire_inventory_locks(1, v_sweep_time) INTO v_count;
  IF v_count <> 1 THEN RAISE EXCEPTION 'expected first bounded sweep=1, got %', v_count; END IF;
  SELECT preneura_expire_inventory_locks(1, v_sweep_time) INTO v_count;
  IF v_count <> 1 THEN RAISE EXCEPTION 'expected second bounded sweep=1, got %', v_count; END IF;
  SELECT preneura_expire_inventory_locks(100, v_sweep_time) INTO v_count;
  IF v_count <> 0 THEN RAISE EXCEPTION 'idempotent sweep expired unexpected locks: %', v_count; END IF;
END $$;

DO $$
DECLARE
  v_count integer;
BEGIN
  SELECT count(*) INTO v_count FROM inventory_locks
  WHERE id IN (
    '34000000-0000-0000-0002-000000000001'::uuid,
    '34000000-0000-0000-0002-000000000002'::uuid
  ) AND status='EXPIRED' AND release_reason='TTL_EXPIRED' AND released_at IS NOT NULL;
  IF v_count <> 2 THEN RAISE EXCEPTION 'expected 2 canonical expiries, got %', v_count; END IF;

  SELECT count(*) INTO v_count FROM domain_outbox_events
  WHERE aggregate_type='INVENTORY_LOCK'
    AND aggregate_id IN (
      '34000000-0000-0000-0002-000000000001'::uuid,
      '34000000-0000-0000-0002-000000000002'::uuid
    )
    AND event_type='inventory.lock.expired';
  IF v_count <> 2 THEN RAISE EXCEPTION 'expected exactly 2 expiry events, got %', v_count; END IF;

  IF (SELECT status FROM inventory_locks WHERE id='34000000-0000-0000-0002-000000000003') <> 'ACTIVE' THEN
    RAISE EXCEPTION 'future lock was expired unexpectedly';
  END IF;
  IF (SELECT status FROM inventory_locks WHERE id='34000000-0000-0000-0002-000000000004') <> 'CONVERTED' THEN
    RAISE EXCEPTION 'converted lock was altered unexpectedly';
  END IF;
END $$;

DO $$
BEGIN
  BEGIN
    UPDATE inventory_locks SET release_reason='tampered'
    WHERE id='34000000-0000-0000-0002-000000000001';
    RAISE EXCEPTION 'terminal expired row was mutable';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'terminal expired row was mutable' THEN RAISE; END IF;
  END;

  BEGIN
    UPDATE inventory_locks SET status='ACTIVE', converted_at=NULL
    WHERE id='34000000-0000-0000-0002-000000000004';
    RAISE EXCEPTION 'terminal converted lock was reopened';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'terminal converted lock was reopened' THEN RAISE; END IF;
  END;
END $$;

-- Canonical migration-0040 compatibility: an assigned allocator lock expiry must
-- reopen the same buyer session rather than losing the allocator/buyer context.
INSERT INTO buyer_profiles (
  id, tenant_id, user_id, status, source, created_by
) VALUES (
  '34000000-0000-0000-0003-000000000001',
  '34000000-0000-0000-0000-000000000010',
  '34000000-0000-0000-0000-000000000002',
  'ACTIVE', 'DIRECT', '34000000-0000-0000-0000-000000000003'
);

INSERT INTO eoi_refund_policies (
  id, tenant_id, project_id, version_number, name, status, eoi_amount, currency,
  before_reservation_refund_percent, after_reservation_before_contract_refund_percent,
  after_contract_refund_percent, processing_fee, effective_at, published_at
) VALUES (
  '34000000-0000-0000-0004-000000000001',
  '34000000-0000-0000-0000-000000000010',
  '34000000-0000-0000-0000-000000000020',
  1, 'Lock certification EOI', 'ACTIVE', 1000, 'EGP', 100, 100, 0, 0, now() - interval '1 day', now() - interval '1 day'
);

INSERT INTO buyer_eois (
  id, tenant_id, project_id, buyer_profile_id, refund_policy_id, amount, currency,
  status, payment_reference, paid_at, expires_at, created_by
) VALUES (
  '34000000-0000-0000-0005-000000000001',
  '34000000-0000-0000-0000-000000000010',
  '34000000-0000-0000-0000-000000000020',
  '34000000-0000-0000-0003-000000000001',
  '34000000-0000-0000-0004-000000000001',
  1000, 'EGP', 'PAID', 'LOCK-CERT-PAID', now() - interval '1 hour', now() + interval '1 day',
  '34000000-0000-0000-0000-000000000003'
);

INSERT INTO queue_entries (
  id, tenant_id, project_id, buyer_profile_id, eoi_id, channel, priority_group,
  priority_score, status, checked_in_at, called_at, created_by,
  allocator_user_id, allocator_assigned_at
) VALUES (
  '34000000-0000-0000-0006-000000000001',
  '34000000-0000-0000-0000-000000000010',
  '34000000-0000-0000-0000-000000000020',
  '34000000-0000-0000-0003-000000000001',
  '34000000-0000-0000-0005-000000000001',
  'ONSITE', 'STANDARD', 0, 'CALLED', now() - interval '30 minutes', now() - interval '20 minutes',
  '34000000-0000-0000-0000-000000000003',
  '34000000-0000-0000-0000-000000000003', now() - interval '20 minutes'
);

INSERT INTO inventory_locks (
  id, tenant_id, project_id, unit_type_id, inventory_slot_id,
  buyer_user_id, locked_by_user_id, status, expires_at, released_at, converted_at
) VALUES (
  '34000000-0000-0000-0007-000000000001',
  '34000000-0000-0000-0000-000000000010',
  '34000000-0000-0000-0000-000000000020',
  '34000000-0000-0000-0000-000000000030',
  '34000000-0000-0000-0001-000000000005',
  '34000000-0000-0000-0000-000000000002',
  '34000000-0000-0000-0000-000000000003',
  'ACTIVE', now() + interval '1 minute', NULL, NULL
);

DO $$
DECLARE v_count integer;
BEGIN
  IF (SELECT status FROM queue_entries WHERE id='34000000-0000-0000-0006-000000000001') <> 'LOCKED' THEN
    RAISE EXCEPTION 'allocator lock did not bind queue session';
  END IF;
  IF (SELECT allocation_lock_id FROM queue_entries WHERE id='34000000-0000-0000-0006-000000000001')
     <> '34000000-0000-0000-0007-000000000001'::uuid THEN
    RAISE EXCEPTION 'allocator queue session did not retain assigned lock';
  END IF;

  SELECT preneura_expire_inventory_locks(100, now() + interval '2 minutes') INTO v_count;
  IF v_count <> 1 THEN RAISE EXCEPTION 'expected allocator expiry sweep=1, got %', v_count; END IF;

  IF (SELECT status FROM queue_entries WHERE id='34000000-0000-0000-0006-000000000001') <> 'CALLED' THEN
    RAISE EXCEPTION 'expired allocator lock did not reopen queue session';
  END IF;
  IF (SELECT allocation_lock_id FROM queue_entries WHERE id='34000000-0000-0000-0006-000000000001') IS NOT NULL THEN
    RAISE EXCEPTION 'expired allocator lock was not cleared from queue session';
  END IF;
  IF (SELECT allocator_user_id FROM queue_entries WHERE id='34000000-0000-0000-0006-000000000001')
     <> '34000000-0000-0000-0000-000000000003'::uuid THEN
    RAISE EXCEPTION 'allocator assignment was lost during lock expiry';
  END IF;
  IF (SELECT release_reason FROM inventory_locks WHERE id='34000000-0000-0000-0007-000000000001') <> 'TTL_EXPIRED' THEN
    RAISE EXCEPTION 'allocator lock expiry did not use canonical TTL reason';
  END IF;
END $$;

SELECT 'Gate 2 inventory lock durability certification: PASS' AS result;
