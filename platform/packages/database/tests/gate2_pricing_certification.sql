\set ON_ERROR_STOP on

BEGIN;

DO $$
DECLARE
  v_user uuid;
  v_tenant uuid;
  v_project uuid;
  v_unit_type uuid;
  v_pricing_v1 uuid;
  v_pricing_v2 uuid;
  v_property_version uuid;
  v_buyer uuid;
  v_policy uuid;
  v_eoi uuid;
  v_queue uuid;
  v_slot uuid;
  v_lock uuid;
  v_reservation uuid;
  v_bad_slot uuid;
  v_bad_lock uuid;
  v_total numeric(18,2);
  v_expected numeric(18,2);
  v_snapshot_total numeric(18,2);
  v_snapshot_count integer;
  v_old_total numeric(18,2);
  v_rejected boolean;
  v_i integer;
  v_property_unit uuid;
BEGIN
  INSERT INTO users (display_name, status)
  VALUES ('Gate 2 Pricing Certification', 'ACTIVE')
  RETURNING id INTO v_user;

  INSERT INTO tenants (code, name, status, default_currency, default_timezone)
  VALUES ('GATE2-PRICING', 'Gate 2 Pricing Tenant', 'ACTIVE', 'EGP', 'Africa/Cairo')
  RETURNING id INTO v_tenant;

  INSERT INTO projects (tenant_id, code, name, status, currency, timezone)
  VALUES (v_tenant, 'GATE2', 'Gate 2 Pricing Project', 'ACTIVE', 'EGP', 'Africa/Cairo')
  RETURNING id INTO v_project;

  INSERT INTO catalog_unit_types (
    tenant_id, project_id, code, name, bedroom_count,
    indoor_area_sqm, roof_area_sqm, garden_area_sqm, status, sort_order
  ) VALUES (
    v_tenant, v_project, 'TYPE-A', 'Type A', 3,
    100.00, 20.00, 30.00, 'ACTIVE', 1
  ) RETURNING id INTO v_unit_type;

  -- Version 1: 100*2000 + 20*500 + 30*750 = 232,500.00.
  INSERT INTO pricing_versions (
    tenant_id, project_id, version_number, label, status, effective_at, created_by
  ) VALUES (
    v_tenant, v_project, 1, 'Gate 2 V1', 'DRAFT', '2026-01-01T00:00:00+00', v_user
  ) RETURNING id INTO v_pricing_v1;

  INSERT INTO pricing_rates (
    tenant_id, project_id, pricing_version_id, unit_type_id, component, rate_per_sqm
  ) VALUES
    (v_tenant, v_project, v_pricing_v1, v_unit_type, 'INDOOR', 2000.00),
    (v_tenant, v_project, v_pricing_v1, v_unit_type, 'ROOF', 500.00),
    (v_tenant, v_project, v_pricing_v1, v_unit_type, 'GARDEN', 750.00);

  UPDATE pricing_versions
  SET status = 'PUBLISHED',
      published_at = '2026-01-01T00:00:00+00',
      published_by = v_user,
      updated_at = '2026-01-01T00:00:00+00'
  WHERE id = v_pricing_v1;

  v_total := calculate_unit_type_price(v_pricing_v1, v_unit_type);
  IF v_total IS DISTINCT FROM 232500.00::numeric THEN
    RAISE EXCEPTION 'deterministic pricing failed: expected 232500.00, got %', v_total;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pricing_rates
    WHERE pricing_version_id = v_pricing_v1
      AND (
        (component = 'INDOOR' AND area_sqm <> 100.00) OR
        (component = 'ROOF' AND area_sqm <> 20.00) OR
        (component = 'GARDEN' AND area_sqm <> 30.00)
      )
  ) THEN
    RAISE EXCEPTION 'pricing area snapshots do not match the unit type at version creation';
  END IF;

  -- Property-style coverage across a range of areas/rates. One draft version is
  -- enough because the canonical formula is version/unit scoped.
  INSERT INTO pricing_versions (
    tenant_id, project_id, version_number, label, status, effective_at, created_by
  ) VALUES (
    v_tenant, v_project, 2, 'Property Formula Cases', 'DRAFT', '2026-01-01T00:00:00+00', v_user
  ) RETURNING id INTO v_property_version;

  FOR v_i IN 1..25 LOOP
    INSERT INTO catalog_unit_types (
      tenant_id, project_id, code, name,
      indoor_area_sqm, roof_area_sqm, garden_area_sqm, status, sort_order
    ) VALUES (
      v_tenant,
      v_project,
      'PROP-' || v_i,
      'Property ' || v_i,
      50 + v_i,
      v_i,
      v_i * 2,
      'ACTIVE',
      100 + v_i
    ) RETURNING id INTO v_property_unit;

    INSERT INTO pricing_rates (
      tenant_id, project_id, pricing_version_id, unit_type_id, component, rate_per_sqm
    ) VALUES
      (v_tenant, v_project, v_property_version, v_property_unit, 'INDOOR', 1000 + v_i),
      (v_tenant, v_project, v_property_version, v_property_unit, 'ROOF', 100 + v_i),
      (v_tenant, v_project, v_property_version, v_property_unit, 'GARDEN', 50 + v_i);

    v_expected := round(
      ((50 + v_i)::numeric * (1000 + v_i)::numeric) +
      (v_i::numeric * (100 + v_i)::numeric) +
      ((v_i * 2)::numeric * (50 + v_i)::numeric),
      2
    );
    v_total := calculate_unit_type_price(v_property_version, v_property_unit);

    IF v_total IS DISTINCT FROM v_expected THEN
      RAISE EXCEPTION 'pricing property case % failed: expected %, got %', v_i, v_expected, v_total;
    END IF;
  END LOOP;

  -- Seed the minimum authoritative sales chain required for a reservation.
  INSERT INTO buyer_profiles (tenant_id, user_id, status, source, created_by)
  VALUES (v_tenant, v_user, 'ACTIVE', 'DIRECT', v_user)
  RETURNING id INTO v_buyer;

  INSERT INTO eoi_refund_policies (
    tenant_id, project_id, version_number, name, status,
    eoi_amount, currency, effective_at, published_at, created_by, published_by
  ) VALUES (
    v_tenant, v_project, 1, 'Gate 2 EOI', 'ACTIVE',
    1000.00, 'EGP', '2025-12-01T00:00:00+00', '2025-12-01T00:00:00+00', v_user, v_user
  ) RETURNING id INTO v_policy;

  INSERT INTO buyer_eois (
    tenant_id, project_id, buyer_profile_id, refund_policy_id,
    amount, currency, status, payment_reference, paid_at, created_by
  ) VALUES (
    v_tenant, v_project, v_buyer, v_policy,
    1000.00, 'EGP', 'PAID', 'GATE2-EOI', '2025-12-15T00:00:00+00', v_user
  ) RETURNING id INTO v_eoi;

  INSERT INTO queue_entries (
    tenant_id, project_id, buyer_profile_id, eoi_id,
    channel, priority_group, priority_score, status, checked_in_at, created_by
  ) VALUES (
    v_tenant, v_project, v_buyer, v_eoi,
    'ONLINE', 'STANDARD', 0, 'WAITING', '2026-01-02T00:00:00+00', v_user
  ) RETURNING id INTO v_queue;

  INSERT INTO inventory_slots (tenant_id, project_id, unit_type_id, state, internal_reference)
  VALUES (v_tenant, v_project, v_unit_type, 'AVAILABLE', 'GATE2-SLOT-1')
  RETURNING id INTO v_slot;

  INSERT INTO inventory_locks (
    tenant_id, project_id, unit_type_id, inventory_slot_id,
    buyer_user_id, locked_by_user_id, status, expires_at, created_at, updated_at
  ) VALUES (
    v_tenant, v_project, v_unit_type, v_slot,
    v_user, v_user, 'ACTIVE', '2026-01-03T00:00:00+00',
    '2026-01-02T00:00:00+00', '2026-01-02T00:00:00+00'
  ) RETURNING id INTO v_lock;

  INSERT INTO reservations (
    tenant_id, project_id, buyer_profile_id, queue_entry_id,
    inventory_lock_id, inventory_slot_id, unit_type_id, pricing_version_id,
    quoted_total, currency, status, reserved_by, reserved_at, created_at, updated_at
  ) VALUES (
    v_tenant, v_project, v_buyer, v_queue,
    v_lock, v_slot, v_unit_type, v_pricing_v1,
    232500.00, 'EGP', 'ACTIVE', v_user,
    '2026-01-02T00:00:00+00', '2026-01-02T00:00:00+00', '2026-01-02T00:00:00+00'
  ) RETURNING id INTO v_reservation;

  SELECT count(*), round(sum(amount), 2)
  INTO v_snapshot_count, v_snapshot_total
  FROM reservation_price_components
  WHERE reservation_id = v_reservation;

  IF v_snapshot_count <> 3 THEN
    RAISE EXCEPTION 'reservation quote snapshot must contain exactly 3 components, got %', v_snapshot_count;
  END IF;
  IF v_snapshot_total IS DISTINCT FROM 232500.00::numeric THEN
    RAISE EXCEPTION 'reservation component snapshot does not reconcile: %', v_snapshot_total;
  END IF;

  SELECT quoted_total INTO v_old_total FROM reservations WHERE id = v_reservation;

  -- Later price publication changes the live catalog price but must not change
  -- the historical reservation quote/components.
  INSERT INTO pricing_versions (
    tenant_id, project_id, version_number, label, status, effective_at, created_by
  ) VALUES (
    v_tenant, v_project, 3, 'Gate 2 V2', 'DRAFT', '2026-02-01T00:00:00+00', v_user
  ) RETURNING id INTO v_pricing_v2;

  INSERT INTO pricing_rates (
    tenant_id, project_id, pricing_version_id, unit_type_id, component, rate_per_sqm
  ) VALUES
    (v_tenant, v_project, v_pricing_v2, v_unit_type, 'INDOOR', 2500.00),
    (v_tenant, v_project, v_pricing_v2, v_unit_type, 'ROOF', 700.00),
    (v_tenant, v_project, v_pricing_v2, v_unit_type, 'GARDEN', 900.00);

  UPDATE pricing_versions
  SET status = 'PUBLISHED',
      published_at = '2026-02-01T00:00:00+00',
      published_by = v_user,
      updated_at = '2026-02-01T00:00:00+00'
  WHERE id = v_pricing_v2;

  IF calculate_unit_type_price(v_pricing_v2, v_unit_type) = v_old_total THEN
    RAISE EXCEPTION 'test fixture error: V2 price should differ from V1';
  END IF;

  IF (SELECT quoted_total FROM reservations WHERE id = v_reservation) IS DISTINCT FROM v_old_total THEN
    RAISE EXCEPTION 'later pricing publication mutated the reservation quote';
  END IF;
  IF (SELECT round(sum(amount), 2) FROM reservation_price_components WHERE reservation_id = v_reservation)
       IS DISTINCT FROM v_old_total THEN
    RAISE EXCEPTION 'later pricing publication mutated the reservation component snapshot';
  END IF;

  -- A mismatched quote must be rejected at the database authority boundary.
  INSERT INTO inventory_slots (tenant_id, project_id, unit_type_id, state, internal_reference)
  VALUES (v_tenant, v_project, v_unit_type, 'AVAILABLE', 'GATE2-SLOT-BAD')
  RETURNING id INTO v_bad_slot;

  INSERT INTO inventory_locks (
    tenant_id, project_id, unit_type_id, inventory_slot_id,
    buyer_user_id, locked_by_user_id, status, expires_at, created_at, updated_at
  ) VALUES (
    v_tenant, v_project, v_unit_type, v_bad_slot,
    v_user, v_user, 'ACTIVE', '2026-01-03T00:00:00+00',
    '2026-01-02T00:00:00+00', '2026-01-02T00:00:00+00'
  ) RETURNING id INTO v_bad_lock;

  v_rejected := false;
  BEGIN
    INSERT INTO reservations (
      tenant_id, project_id, buyer_profile_id, queue_entry_id,
      inventory_lock_id, inventory_slot_id, unit_type_id, pricing_version_id,
      quoted_total, currency, status, reserved_by, reserved_at
    ) VALUES (
      v_tenant, v_project, v_buyer, v_queue,
      v_bad_lock, v_bad_slot, v_unit_type, v_pricing_v1,
      1.00, 'EGP', 'ACTIVE', v_user, '2026-01-02T00:00:00+00'
    );
  EXCEPTION WHEN OTHERS THEN
    v_rejected := position('does not match canonical pricing' in SQLERRM) > 0;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'database accepted a reservation with a mismatched quote';
  END IF;

  -- Historical reservation pricing fields are immutable.
  v_rejected := false;
  BEGIN
    UPDATE reservations SET quoted_total = quoted_total + 1 WHERE id = v_reservation;
  EXCEPTION WHEN OTHERS THEN
    v_rejected := position('pricing snapshot is immutable' in SQLERRM) > 0;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'database allowed mutation of a locked reservation price';
  END IF;

  -- Published pricing rates are immutable.
  v_rejected := false;
  BEGIN
    UPDATE pricing_rates SET rate_per_sqm = rate_per_sqm + 1
    WHERE pricing_version_id = v_pricing_v1 AND component = 'INDOOR';
  EXCEPTION WHEN OTHERS THEN
    v_rejected := position('pricing rates are immutable' in SQLERRM) > 0;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'database allowed mutation of a published pricing rate';
  END IF;

  -- Priced geometry is immutable after publication; new geometry belongs in a
  -- new commercial/versioned definition instead of rewriting history.
  v_rejected := false;
  BEGIN
    UPDATE catalog_unit_types SET indoor_area_sqm = indoor_area_sqm + 1 WHERE id = v_unit_type;
  EXCEPTION WHEN OTHERS THEN
    v_rejected := position('priced unit-type areas are immutable' in SQLERRM) > 0;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'database allowed mutation of geometry used by published pricing';
  END IF;

  -- Quote component rows themselves are immutable.
  v_rejected := false;
  BEGIN
    UPDATE reservation_price_components SET rate_per_sqm = rate_per_sqm + 1
    WHERE reservation_id = v_reservation AND component = 'INDOOR';
  EXCEPTION WHEN OTHERS THEN
    v_rejected := position('price components are immutable' in SQLERRM) > 0;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'database allowed mutation of reservation price components';
  END IF;
END $$;

ROLLBACK;
