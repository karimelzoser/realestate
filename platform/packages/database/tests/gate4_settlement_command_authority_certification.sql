\set ON_ERROR_STOP on

BEGIN;

DO $$
DECLARE
  v_user uuid;
  v_user_2 uuid;
  v_tenant uuid;
  v_project uuid;
  v_buyer uuid;
  v_buyer_2 uuid;
  v_policy uuid;
  v_eoi_1 uuid;
  v_eoi_2 uuid;
  v_refund_1 uuid;
  v_refund_2 uuid;
  v_settlement uuid;
  v_repeat uuid;
  v_rejected boolean;
BEGIN
  INSERT INTO users (display_name, status)
  VALUES ('Settlement Command Authority Operator', 'ACTIVE')
  RETURNING id INTO v_user;

  INSERT INTO users (display_name, status)
  VALUES ('Settlement Command Collision Buyer', 'ACTIVE')
  RETURNING id INTO v_user_2;

  INSERT INTO tenants (code, name, status, default_currency, default_timezone)
  VALUES ('SET-CMD', 'Settlement Command Tenant', 'ACTIVE', 'EGP', 'Africa/Cairo')
  RETURNING id INTO v_tenant;

  INSERT INTO projects (tenant_id, code, name, status, currency, timezone)
  VALUES (v_tenant, 'SET-CMD', 'Settlement Command Project', 'ACTIVE', 'EGP', 'Africa/Cairo')
  RETURNING id INTO v_project;

  INSERT INTO buyer_profiles (tenant_id, user_id, status, source, created_by)
  VALUES (v_tenant, v_user, 'ACTIVE', 'DIRECT', v_user)
  RETURNING id INTO v_buyer;

  INSERT INTO buyer_profiles (tenant_id, user_id, status, source, created_by)
  VALUES (v_tenant, v_user_2, 'ACTIVE', 'DIRECT', v_user)
  RETURNING id INTO v_buyer_2;

  INSERT INTO eoi_refund_policies (
    tenant_id, project_id, version_number, name, status, eoi_amount, currency,
    before_reservation_refund_percent, after_reservation_before_contract_refund_percent,
    after_contract_refund_percent, processing_fee, effective_at, published_at,
    created_by, published_by
  ) VALUES (
    v_tenant, v_project, 1, 'Settlement Command Policy', 'ACTIVE', 100, 'EGP',
    100, 100, 0, 0, '2026-01-01T00:00:00+00', '2026-01-01T00:00:00+00',
    v_user, v_user
  ) RETURNING id INTO v_policy;

  INSERT INTO buyer_eois (
    tenant_id, project_id, buyer_profile_id, refund_policy_id, amount, currency,
    status, payment_reference, paid_at, refund_requested_at, created_by
  ) VALUES (
    v_tenant, v_project, v_buyer, v_policy, 100, 'EGP', 'REFUND_REQUESTED',
    'SET-CMD-EOI-1', '2026-01-02T00:00:00+00', '2026-01-03T00:00:00+00', v_user
  ) RETURNING id INTO v_eoi_1;

  INSERT INTO buyer_eois (
    tenant_id, project_id, buyer_profile_id, refund_policy_id, amount, currency,
    status, payment_reference, paid_at, refund_requested_at, created_by
  ) VALUES (
    v_tenant, v_project, v_buyer_2, v_policy, 100, 'EGP', 'REFUND_REQUESTED',
    'SET-CMD-EOI-2', '2026-01-02T00:00:00+00', '2026-01-03T00:00:00+00', v_user
  ) RETURNING id INTO v_eoi_2;

  INSERT INTO eoi_refund_requests (
    tenant_id, project_id, eoi_id, buyer_profile_id, refund_policy_id,
    stage, eoi_status_at_request, original_eoi_amount, refund_percent,
    processing_fee, requested_amount, currency, status,
    requested_by, requested_at, reviewed_by, reviewed_at, updated_at
  ) VALUES (
    v_tenant, v_project, v_eoi_1, v_buyer, v_policy,
    'BEFORE_RESERVATION', 'PAID', 100, 100, 0, 100, 'EGP', 'APPROVED',
    v_user, '2026-01-03T00:00:00+00', v_user, '2026-01-03T01:00:00+00',
    '2026-01-03T01:00:00+00'
  ) RETURNING id INTO v_refund_1;

  INSERT INTO eoi_refund_requests (
    tenant_id, project_id, eoi_id, buyer_profile_id, refund_policy_id,
    stage, eoi_status_at_request, original_eoi_amount, refund_percent,
    processing_fee, requested_amount, currency, status,
    requested_by, requested_at, reviewed_by, reviewed_at, updated_at
  ) VALUES (
    v_tenant, v_project, v_eoi_2, v_buyer_2, v_policy,
    'BEFORE_RESERVATION', 'PAID', 100, 100, 0, 100, 'EGP', 'APPROVED',
    v_user, '2026-01-03T00:00:00+00', v_user, '2026-01-03T01:00:00+00',
    '2026-01-03T01:00:00+00'
  ) RETURNING id INTO v_refund_2;

  -- Same command + same idempotency key returns the same settlement.
  v_settlement := preneura_create_eoi_refund_settlement(
    v_refund_1, v_user, 'SET-COMMAND-001', '2026-01-04T00:00:00+00'
  );
  v_repeat := preneura_create_eoi_refund_settlement(
    v_refund_1, v_user, 'SET-COMMAND-001', '2026-01-04T00:01:00+00'
  );
  IF v_repeat <> v_settlement THEN
    RAISE EXCEPTION 'same settlement command was not idempotent';
  END IF;

  -- Tenant-wide idempotency keys cannot be reused for another source command.
  v_rejected := false;
  BEGIN
    PERFORM preneura_create_eoi_refund_settlement(
      v_refund_2, v_user, 'SET-COMMAND-001', '2026-01-04T00:02:00+00'
    );
  EXCEPTION WHEN OTHERS THEN
    v_rejected := position('different command' in SQLERRM) > 0;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'settlement idempotency key was reused for a different refund command';
  END IF;

  -- Projection cannot jump to SUBMITTED without immutable SUBMITTED evidence.
  v_rejected := false;
  BEGIN
    UPDATE settlement_disbursements
    SET status = 'SUBMITTED', provider = 'BANK', provider_reference = 'FORGED',
        submitted_at = now(), updated_at = now()
    WHERE id = v_settlement;
  EXCEPTION WHEN OTHERS THEN
    v_rejected := position('immutable event evidence' in SQLERRM) > 0;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'settlement projection reached SUBMITTED without event evidence';
  END IF;

  -- Submit is retry-safe only for the same provider evidence.
  PERFORM preneura_submit_settlement(
    v_settlement, v_user, 'BANK', 'BANK-CMD-001', '2026-01-04T01:00:00+00'
  );
  PERFORM preneura_submit_settlement(
    v_settlement, v_user, 'BANK', 'BANK-CMD-001', '2026-01-04T01:01:00+00'
  );

  v_rejected := false;
  BEGIN
    PERFORM preneura_submit_settlement(
      v_settlement, v_user, 'BANK', 'BANK-CMD-CONFLICT', '2026-01-04T01:02:00+00'
    );
  EXCEPTION WHEN OTHERS THEN
    v_rejected := position('different provider evidence' in SQLERRM) > 0;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'settlement resubmission accepted conflicting provider evidence';
  END IF;

  PERFORM preneura_apply_settlement_outcome(
    v_settlement, 'SETTLED', NULL, 'BANK', 'BANK-CMD-EVENT-001',
    'BANK-CMD-001', '2026-01-04T02:00:00+00', '{}'::jsonb
  );

  IF (SELECT status FROM eoi_refund_requests WHERE id = v_refund_1) <> 'PAID' THEN
    RAISE EXCEPTION 'settled disbursement did not project refund to PAID';
  END IF;

  -- A paid obligation cannot be reopened while the settlement remains SETTLED.
  v_rejected := false;
  BEGIN
    UPDATE eoi_refund_requests
    SET status = 'APPROVED', paid_at = NULL, updated_at = now()
    WHERE id = v_refund_1;
  EXCEPTION WHEN OTHERS THEN
    v_rejected := position('reversed disbursement evidence' in SQLERRM) > 0;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'paid refund obligation reopened without settlement reversal';
  END IF;

  PERFORM preneura_apply_settlement_outcome(
    v_settlement, 'REVERSED', NULL, 'BANK', 'BANK-CMD-EVENT-002',
    'BANK-CMD-001', '2026-01-05T00:00:00+00', '{}'::jsonb
  );

  IF (SELECT status FROM eoi_refund_requests WHERE id = v_refund_1) <> 'APPROVED'
     OR (SELECT status FROM buyer_eois WHERE id = v_eoi_1) <> 'REFUND_REQUESTED' THEN
    RAISE EXCEPTION 'reversed disbursement did not reopen refund obligation';
  END IF;

  -- Terminal states cannot be rewound through an old historical event.
  v_rejected := false;
  BEGIN
    UPDATE settlement_disbursements
    SET status = 'SUBMITTED', updated_at = now()
    WHERE id = v_settlement;
  EXCEPTION WHEN OTHERS THEN
    v_rejected := position('illegal settlement state transition' in SQLERRM) > 0;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'reversed settlement was rewound to SUBMITTED';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM platform_runtime_contract
    WHERE singleton_key = 'production'
      AND schema_version = 36
      AND minimum_runtime_version = 36
      AND migration_marker = '0036_settlement_command_authority'
  ) THEN
    RAISE EXCEPTION 'runtime contract is not settlement command authority schema 36';
  END IF;
END;
$$;

ROLLBACK;

\echo 'Gate 4 settlement command authority certification passed.'
