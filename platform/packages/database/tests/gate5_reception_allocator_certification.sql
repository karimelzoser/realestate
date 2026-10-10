\set ON_ERROR_STOP on

BEGIN;

DO $$
DECLARE
  v_tenant uuid;
  v_project uuid;
  v_allocator_1 uuid := '51000000-0000-4000-8000-000000000001';
  v_allocator_2 uuid := '51000000-0000-4000-8000-000000000002';
  v_buyer_user_1 uuid := '51000000-0000-4000-8000-000000000011';
  v_buyer_user_2 uuid := '51000000-0000-4000-8000-000000000012';
  v_buyer_1 uuid;
  v_buyer_2 uuid;
  v_policy uuid;
  v_eoi_1 uuid;
  v_eoi_2 uuid;
  v_queue_1 uuid;
  v_queue_2 uuid;
  v_claimed uuid;
  v_unit_type uuid;
  v_pricing uuid;
  v_slot_1 uuid;
  v_slot_2 uuid;
  v_lock_1 uuid;
  v_lock_2 uuid;
  v_reservation uuid;
  v_rejected boolean;
BEGIN
  INSERT INTO users (id, display_name, status) VALUES
    (v_allocator_1, 'Gate5 Allocator One', 'ACTIVE'),
    (v_allocator_2, 'Gate5 Allocator Two', 'ACTIVE'),
    (v_buyer_user_1, 'Gate5 Buyer One', 'ACTIVE'),
    (v_buyer_user_2, 'Gate5 Buyer Two', 'ACTIVE');

  INSERT INTO tenants (code, name, status, default_currency, default_timezone)
  VALUES ('G5-ALLOC', 'Gate 5 Allocation Tenant', 'ACTIVE', 'EGP', 'Africa/Cairo')
  RETURNING id INTO v_tenant;

  INSERT INTO projects (tenant_id, code, name, status, currency, timezone)
  VALUES (v_tenant, 'G5-ALLOC-PROJECT', 'Gate 5 Allocation Project', 'ACTIVE', 'EGP', 'Africa/Cairo')
  RETURNING id INTO v_project;

  INSERT INTO tenant_memberships (tenant_id, user_id, status) VALUES
    (v_tenant, v_allocator_1, 'ACTIVE'),
    (v_tenant, v_allocator_2, 'ACTIVE'),
    (v_tenant, v_buyer_user_1, 'ACTIVE'),
    (v_tenant, v_buyer_user_2, 'ACTIVE');

  INSERT INTO access_role_assignments (
    user_id, role_code, scope_type, tenant_id, project_id, status, granted_by
  ) VALUES
    (v_allocator_1, 'ALLOCATOR', 'PROJECT', v_tenant, v_project, 'ACTIVE', v_allocator_1),
    (v_allocator_2, 'ALLOCATOR', 'PROJECT', v_tenant, v_project, 'ACTIVE', v_allocator_1),
    (v_buyer_user_1, 'BUYER', 'PROJECT', v_tenant, v_project, 'ACTIVE', v_allocator_1),
    (v_buyer_user_2, 'BUYER', 'PROJECT', v_tenant, v_project, 'ACTIVE', v_allocator_1);

  INSERT INTO buyer_profiles (tenant_id, user_id, status, source, created_by)
  VALUES (v_tenant, v_buyer_user_1, 'ACTIVE', 'DIRECT', v_allocator_1)
  RETURNING id INTO v_buyer_1;
  INSERT INTO buyer_profiles (tenant_id, user_id, status, source, created_by)
  VALUES (v_tenant, v_buyer_user_2, 'ACTIVE', 'DIRECT', v_allocator_1)
  RETURNING id INTO v_buyer_2;

  INSERT INTO eoi_refund_policies (
    tenant_id, project_id, version_number, name, status, eoi_amount, currency,
    effective_at, published_at, created_by, published_by
  ) VALUES (
    v_tenant, v_project, 1, 'Gate 5 Allocation EOI', 'ACTIVE', 25000, 'EGP',
    '2026-01-01T00:00:00+00', '2026-01-01T00:00:00+00', v_allocator_1, v_allocator_1
  ) RETURNING id INTO v_policy;

  INSERT INTO buyer_eois (
    tenant_id, project_id, buyer_profile_id, refund_policy_id,
    amount, currency, status, created_by
  ) VALUES (v_tenant, v_project, v_buyer_1, v_policy, 25000, 'EGP', 'PAYMENT_PENDING', v_allocator_1)
  RETURNING id INTO v_eoi_1;
  INSERT INTO buyer_eois (
    tenant_id, project_id, buyer_profile_id, refund_policy_id,
    amount, currency, status, created_by
  ) VALUES (v_tenant, v_project, v_buyer_2, v_policy, 25000, 'EGP', 'PAYMENT_PENDING', v_allocator_1)
  RETURNING id INTO v_eoi_2;

  INSERT INTO queue_entries (
    tenant_id, project_id, buyer_profile_id, eoi_id, channel, priority_group,
    priority_score, status, checked_in_at, called_at, created_by
  ) VALUES (
    v_tenant, v_project, v_buyer_1, v_eoi_1, 'ONSITE', 'VIP', 100,
    'CALLED', '2026-01-02T09:00:00+00', '2026-01-02T09:05:00+00', v_allocator_1
  ) RETURNING id INTO v_queue_1;
  INSERT INTO queue_entries (
    tenant_id, project_id, buyer_profile_id, eoi_id, channel, priority_group,
    priority_score, status, checked_in_at, called_at, created_by
  ) VALUES (
    v_tenant, v_project, v_buyer_2, v_eoi_2, 'ONSITE', 'STANDARD', 0,
    'CALLED', '2026-01-02T09:01:00+00', '2026-01-02T09:06:00+00', v_allocator_1
  ) RETURNING id INTO v_queue_2;

  SELECT preneura_claim_called_queue_entry(v_tenant, v_project, v_allocator_1, '2026-01-02T09:07:00+00')
    INTO v_claimed;
  IF v_claimed IS DISTINCT FROM v_queue_1 THEN
    RAISE EXCEPTION 'allocator one did not claim the oldest called buyer';
  END IF;

  v_rejected := false;
  BEGIN
    PERFORM preneura_claim_called_queue_entry(v_tenant, v_project, v_allocator_1, '2026-01-02T09:07:01+00');
  EXCEPTION WHEN OTHERS THEN
    v_rejected := true;
  END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'allocator second active session was not rejected'; END IF;

  SELECT preneura_claim_called_queue_entry(v_tenant, v_project, v_allocator_2, '2026-01-02T09:08:00+00')
    INTO v_claimed;
  IF v_claimed IS DISTINCT FROM v_queue_2 THEN
    RAISE EXCEPTION 'allocator two did not claim the remaining called buyer';
  END IF;

  INSERT INTO catalog_unit_types (
    tenant_id, project_id, code, name, indoor_area_sqm, roof_area_sqm, garden_area_sqm, status, sort_order
  ) VALUES (v_tenant, v_project, 'TYPE-A', 'Type A', 50, 0, 0, 'ACTIVE', 1)
  RETURNING id INTO v_unit_type;

  INSERT INTO pricing_versions (
    tenant_id, project_id, version_number, label, status, effective_at, created_by
  ) VALUES (v_tenant, v_project, 1, 'Gate5 Allocation Price', 'DRAFT', '2026-01-01T00:00:00+00', v_allocator_1)
  RETURNING id INTO v_pricing;
  INSERT INTO pricing_rates (
    tenant_id, project_id, pricing_version_id, unit_type_id, component, rate_per_sqm
  ) VALUES
    (v_tenant, v_project, v_pricing, v_unit_type, 'INDOOR', 2000),
    (v_tenant, v_project, v_pricing, v_unit_type, 'ROOF', 100),
    (v_tenant, v_project, v_pricing, v_unit_type, 'GARDEN', 100);
  UPDATE pricing_versions
  SET status='PUBLISHED', published_at='2026-01-01T00:00:00+00', published_by=v_allocator_1
  WHERE id=v_pricing;

  INSERT INTO inventory_slots (tenant_id, project_id, unit_type_id, state, internal_reference)
  VALUES (v_tenant, v_project, v_unit_type, 'AVAILABLE', 'G5-A1') RETURNING id INTO v_slot_1;
  INSERT INTO inventory_slots (tenant_id, project_id, unit_type_id, state, internal_reference)
  VALUES (v_tenant, v_project, v_unit_type, 'AVAILABLE', 'G5-A2') RETURNING id INTO v_slot_2;

  v_rejected := false;
  BEGIN
    INSERT INTO inventory_locks (
      tenant_id, project_id, unit_type_id, inventory_slot_id, buyer_user_id,
      locked_by_user_id, status, expires_at
    ) VALUES (
      v_tenant, v_project, v_unit_type, v_slot_1, v_buyer_user_2,
      v_allocator_1, 'ACTIVE', '2026-01-02T09:20:00+00'
    );
  EXCEPTION WHEN OTHERS THEN
    v_rejected := true;
  END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'allocator cross-buyer lock was not rejected'; END IF;

  SELECT lock_id INTO v_lock_1
  FROM preneura_create_assigned_inventory_lock(
    v_tenant, v_project, v_allocator_1, v_unit_type, 900, '2026-01-02T09:10:00+00'
  );
  IF v_lock_1 IS NULL THEN RAISE EXCEPTION 'assigned allocator lock was not created'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM queue_entries
    WHERE id=v_queue_1 AND status='LOCKED' AND allocation_lock_id=v_lock_1
      AND allocator_user_id=v_allocator_1
  ) THEN RAISE EXCEPTION 'allocator lock was not bound to queue session'; END IF;

  UPDATE inventory_locks
  SET status='RELEASED', released_at='2026-01-02T09:11:00+00', release_reason='change selection'
  WHERE id=v_lock_1;
  IF NOT EXISTS (
    SELECT 1 FROM queue_entries WHERE id=v_queue_1 AND status='CALLED' AND allocation_lock_id IS NULL
  ) THEN RAISE EXCEPTION 'released allocator lock did not reopen the queue session'; END IF;

  SELECT lock_id INTO v_lock_2
  FROM preneura_create_assigned_inventory_lock(
    v_tenant, v_project, v_allocator_1, v_unit_type, 900, '2026-01-02T09:12:00+00'
  );
  IF v_lock_2 IS NULL THEN RAISE EXCEPTION 'second assigned allocator lock was not created'; END IF;

  v_rejected := false;
  BEGIN
    INSERT INTO reservations (
      tenant_id, project_id, buyer_profile_id, queue_entry_id, inventory_lock_id,
      inventory_slot_id, unit_type_id, pricing_version_id, quoted_total,
      currency, status, reserved_by, reserved_at
    )
    SELECT v_tenant, v_project, v_buyer_1, v_queue_1, l.id,
      l.inventory_slot_id, v_unit_type, v_pricing, 100000,
      'EGP', 'ACTIVE', v_allocator_2, '2026-01-02T09:13:00+00'
    FROM inventory_locks l WHERE l.id=v_lock_2;
  EXCEPTION WHEN OTHERS THEN
    v_rejected := true;
  END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'cross-allocator reservation conversion was not rejected'; END IF;

  INSERT INTO reservations (
    tenant_id, project_id, buyer_profile_id, queue_entry_id, inventory_lock_id,
    inventory_slot_id, unit_type_id, pricing_version_id, quoted_total,
    currency, status, reserved_by, reserved_at
  )
  SELECT v_tenant, v_project, v_buyer_1, v_queue_1, l.id,
    l.inventory_slot_id, v_unit_type, v_pricing, 100000,
    'EGP', 'ACTIVE', v_allocator_1, '2026-01-02T09:13:00+00'
  FROM inventory_locks l WHERE l.id=v_lock_2
  RETURNING id INTO v_reservation;

  IF v_reservation IS NULL THEN RAISE EXCEPTION 'assigned allocator reservation was not accepted'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM domain_outbox_events
    WHERE aggregate_id=v_queue_1 AND event_type='queue.allocator.claimed'
  ) THEN RAISE EXCEPTION 'allocator claim audit event missing'; END IF;
END $$;

ROLLBACK;

\echo 'Gate 5 Receptionist/Allocator authority certification: PASS'
