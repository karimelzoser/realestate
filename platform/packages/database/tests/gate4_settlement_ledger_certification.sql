\set ON_ERROR_STOP on

BEGIN;

DO $$
DECLARE
  v_user uuid;
  v_tenant uuid;
  v_project uuid;
  v_buyer uuid;
  v_policy uuid;
  v_eoi uuid;
  v_broker uuid;
  v_unit_type uuid;
  v_pricing uuid;
  v_queue uuid;
  v_slot uuid;
  v_lock uuid;
  v_reservation uuid;
  v_transaction uuid;
  v_plan uuid;
  v_case uuid;
  v_settlement uuid;
  v_event uuid;
  v_count integer;
  v_sum numeric(18,2);
  v_rejected boolean;
BEGIN
  INSERT INTO users (display_name, status)
  VALUES ('Gate 4 Commission Settlement Operator', 'ACTIVE')
  RETURNING id INTO v_user;

  INSERT INTO tenants (code, name, status, default_currency, default_timezone)
  VALUES ('G4-COM-SET', 'Gate 4 Commission Settlement Tenant', 'ACTIVE', 'EGP', 'Africa/Cairo')
  RETURNING id INTO v_tenant;

  INSERT INTO projects (tenant_id, code, name, status, currency, timezone)
  VALUES (v_tenant, 'G4-COM-SET', 'Gate 4 Commission Settlement Project', 'ACTIVE', 'EGP', 'Africa/Cairo')
  RETURNING id INTO v_project;

  INSERT INTO buyer_profiles (tenant_id, user_id, status, source, created_by)
  VALUES (v_tenant, v_user, 'ACTIVE', 'DIRECT', v_user)
  RETURNING id INTO v_buyer;

  INSERT INTO eoi_refund_policies (
    tenant_id, project_id, version_number, name, status, eoi_amount, currency,
    effective_at, published_at, created_by, published_by
  ) VALUES (
    v_tenant, v_project, 1, 'Commission Fixture Policy', 'ACTIVE', 100, 'EGP',
    '2026-01-01T00:00:00+00', '2026-01-01T00:00:00+00', v_user, v_user
  ) RETURNING id INTO v_policy;

  INSERT INTO buyer_eois (
    tenant_id, project_id, buyer_profile_id, refund_policy_id,
    amount, currency, status, created_by
  ) VALUES (
    v_tenant, v_project, v_buyer, v_policy,
    100, 'EGP', 'PAYMENT_PENDING', v_user
  ) RETURNING id INTO v_eoi;

  INSERT INTO broker_companies (tenant_id, code, name, status)
  VALUES (v_tenant, 'G4-BROKER', 'Gate 4 Broker', 'ACTIVE')
  RETURNING id INTO v_broker;

  INSERT INTO catalog_unit_types (
    tenant_id, project_id, code, name, indoor_area_sqm, roof_area_sqm,
    garden_area_sqm, status, sort_order
  ) VALUES (
    v_tenant, v_project, 'G4-A', 'Gate 4 Type A', 1, 0, 0, 'ACTIVE', 1
  ) RETURNING id INTO v_unit_type;

  INSERT INTO pricing_versions (
    tenant_id, project_id, version_number, label, status, effective_at, created_by
  ) VALUES (
    v_tenant, v_project, 1, 'Gate 4 Commission Price', 'DRAFT',
    '2026-01-01T00:00:00+00', v_user
  ) RETURNING id INTO v_pricing;

  INSERT INTO pricing_rates (
    tenant_id, project_id, pricing_version_id, unit_type_id, component, rate_per_sqm
  ) VALUES
    (v_tenant, v_project, v_pricing, v_unit_type, 'INDOOR', 1000),
    (v_tenant, v_project, v_pricing, v_unit_type, 'ROOF', 0),
    (v_tenant, v_project, v_pricing, v_unit_type, 'GARDEN', 0);

  UPDATE pricing_versions
  SET status = 'PUBLISHED', published_at = '2026-01-01T00:00:00+00', published_by = v_user
  WHERE id = v_pricing;

  INSERT INTO queue_entries (
    tenant_id, project_id, buyer_profile_id, eoi_id, channel,
    priority_group, priority_score, status, checked_in_at, created_by
  ) VALUES (
    v_tenant, v_project, v_buyer, v_eoi, 'ONLINE',
    'STANDARD', 0, 'WAITING', '2026-01-02T00:00:00+00', v_user
  ) RETURNING id INTO v_queue;

  INSERT INTO inventory_slots (tenant_id, project_id, unit_type_id, state, internal_reference)
  VALUES (v_tenant, v_project, v_unit_type, 'AVAILABLE', 'G4-COM-SLOT')
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
    v_slot, v_unit_type, v_pricing, 1000, 'EGP',
    'ACTIVE', v_user, '2026-01-02T00:05:00+00',
    '2026-01-02T00:05:00+00', '2026-01-02T00:05:00+00'
  ) RETURNING id INTO v_reservation;

  INSERT INTO transactions (
    tenant_id, project_id, reservation_id, buyer_profile_id, status, opened_at
  ) VALUES (
    v_tenant, v_project, v_reservation, v_buyer, 'IN_PROGRESS',
    '2026-01-02T00:06:00+00'
  ) RETURNING id INTO v_transaction;

  INSERT INTO broker_commission_plans (
    tenant_id, project_id, broker_company_id, version_number, status,
    rate_percent, due_days_after_eligibility, effective_at, activated_at, created_by
  ) VALUES (
    v_tenant, v_project, v_broker, 1, 'ACTIVE', 5, 30,
    '2026-01-01T00:00:00+00', '2026-01-01T00:00:00+00', v_user
  ) RETURNING id INTO v_plan;

  INSERT INTO broker_commission_cases (
    tenant_id, project_id, transaction_id, broker_company_id, commission_plan_id,
    basis_amount, rate_percent, commission_amount, status, completion_percent_snapshot,
    eligible_at, due_at, invoiced_at, created_at, updated_at
  ) VALUES (
    v_tenant, v_project, v_transaction, v_broker, v_plan,
    1000, 5, 50, 'INVOICED', 100,
    '2026-01-03T00:00:00+00', '2026-02-02T00:00:00+00',
    '2026-01-04T00:00:00+00', '2026-01-03T00:00:00+00', '2026-01-04T00:00:00+00'
  ) RETURNING id INTO v_case;

  v_rejected := false;
  BEGIN
    UPDATE broker_commission_cases
    SET status = 'PAID', paid_at = now(), updated_at = now()
    WHERE id = v_case;
  EXCEPTION WHEN OTHERS THEN
    v_rejected := position('settled disbursement evidence' in SQLERRM) > 0;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'commission PAID state bypassed settlement authority';
  END IF;

  v_settlement := preneura_create_commission_settlement(
    v_case, v_user, 'G4-COM-SETTLEMENT-001', '2026-01-05T00:00:00+00'
  );
  PERFORM preneura_submit_settlement(
    v_settlement, v_user, 'BANK', 'G4-COM-BANK-001', '2026-01-05T01:00:00+00'
  );
  v_event := preneura_apply_settlement_outcome(
    v_settlement, 'SETTLED', NULL, 'BANK', 'G4-COM-EVENT-001',
    'G4-COM-BANK-001', '2026-01-05T02:00:00+00', '{}'::jsonb
  );

  SELECT count(*)::int, coalesce(sum(signed_amount),0)::numeric(18,2)
    INTO v_count, v_sum
  FROM settlement_ledger_entries WHERE settlement_event_id = v_event;
  IF v_count <> 2 OR v_sum <> 0 THEN
    RAISE EXCEPTION 'commission settlement ledger is not exactly balanced';
  END IF;
  IF (SELECT status FROM broker_commission_cases WHERE id = v_case) <> 'PAID' THEN
    RAISE EXCEPTION 'commission settlement did not project PAID state';
  END IF;

  v_rejected := false;
  BEGIN
    UPDATE broker_commission_cases
    SET status = 'INVOICED', paid_at = NULL, updated_at = now()
    WHERE id = v_case;
  EXCEPTION WHEN OTHERS THEN
    v_rejected := position('reversed disbursement evidence' in SQLERRM) > 0;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'paid commission reopened without settlement reversal';
  END IF;

  v_event := preneura_apply_settlement_outcome(
    v_settlement, 'REVERSED', NULL, 'BANK', 'G4-COM-EVENT-002',
    'G4-COM-BANK-001', '2026-01-06T00:00:00+00', '{}'::jsonb
  );

  SELECT count(*)::int, coalesce(sum(signed_amount),0)::numeric(18,2)
    INTO v_count, v_sum
  FROM settlement_ledger_entries WHERE settlement_event_id = v_event;
  IF v_count <> 2 OR v_sum <> 0 THEN
    RAISE EXCEPTION 'commission settlement reversal is not exactly balanced';
  END IF;
  IF (SELECT status FROM broker_commission_cases WHERE id = v_case) NOT IN ('INVOICED','DUE') THEN
    RAISE EXCEPTION 'commission settlement reversal did not reopen obligation';
  END IF;

  -- Later additive schemas may advance the runtime marker, but they may not
  -- regress the settlement authority established by integrated Gate 4.
  IF NOT EXISTS (
    SELECT 1 FROM platform_runtime_contract
    WHERE singleton_key = 'production'
      AND schema_version >= 39
      AND minimum_runtime_version >= 39
  ) THEN
    RAISE EXCEPTION 'runtime contract regressed below integrated Gate 4 schema 39';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM platform_schema_migrations
    WHERE version = 39 AND filename = '0039_eoi_projection_authority_one_shot.sql'
  ) THEN
    RAISE EXCEPTION 'integrated Gate 4 migration 0039 is missing from canonical history';
  END IF;
END $$;

ROLLBACK;

\echo 'Gate 4 commission settlement certification passed.'
