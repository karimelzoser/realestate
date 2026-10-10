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
  v_receipt uuid;
  v_refund uuid;
  v_settlement uuid;
  v_event uuid;
  v_count integer;
  v_sum numeric(18,2);
  v_rejected boolean;
BEGIN
  INSERT INTO users (display_name, status)
  VALUES ('Gate 4 Integrated Finance Operator', 'ACTIVE')
  RETURNING id INTO v_user;

  INSERT INTO tenants (code, name, status, default_currency, default_timezone)
  VALUES ('G4-FIN-INT', 'Gate 4 Finance Integration Tenant', 'ACTIVE', 'EGP', 'Africa/Cairo')
  RETURNING id INTO v_tenant;

  INSERT INTO projects (tenant_id, code, name, status, currency, timezone)
  VALUES (v_tenant, 'G4-FIN-INT', 'Gate 4 Finance Integration Project', 'ACTIVE', 'EGP', 'Africa/Cairo')
  RETURNING id INTO v_project;

  INSERT INTO buyer_profiles (tenant_id, user_id, status, source, created_by)
  VALUES (v_tenant, v_user, 'ACTIVE', 'DIRECT', v_user)
  RETURNING id INTO v_buyer;

  INSERT INTO eoi_refund_policies (
    tenant_id, project_id, version_number, name, status, eoi_amount, currency,
    before_reservation_refund_percent, after_reservation_before_contract_refund_percent,
    after_contract_refund_percent, processing_fee, effective_at, published_at,
    created_by, published_by
  ) VALUES (
    v_tenant, v_project, 1, 'Gate 4 Integrated Refund Policy', 'ACTIVE', 10000, 'EGP',
    75, 50, 0, 0, '2026-01-01T00:00:00+00', '2026-01-01T00:00:00+00',
    v_user, v_user
  ) RETURNING id INTO v_policy;

  INSERT INTO buyer_eois (
    tenant_id, project_id, buyer_profile_id, refund_policy_id,
    amount, currency, status, created_by
  ) VALUES (
    v_tenant, v_project, v_buyer, v_policy,
    10000, 'EGP', 'PAYMENT_PENDING', v_user
  ) RETURNING id INTO v_eoi;

  v_receipt := preneura_post_eoi_payment(
    v_tenant, v_project, v_eoi, 'G4-EOI-RECEIPT-001', v_user,
    '2026-02-01T09:00:00+00', 'MANUAL', NULL, NULL
  );
  IF (SELECT status FROM buyer_eois WHERE id = v_eoi) <> 'PAID' THEN
    RAISE EXCEPTION 'EOI receipt did not project PAID state';
  END IF;

  SELECT count(*)::int, coalesce(sum(signed_amount),0)::numeric(18,2)
    INTO v_count, v_sum
  FROM eoi_finance_ledger_entries
  WHERE eoi_finance_event_id = v_receipt;
  IF v_count <> 2 OR v_sum <> 0 THEN
    RAISE EXCEPTION 'EOI receipt ledger event is not exactly balanced';
  END IF;

  INSERT INTO eoi_refund_requests (
    tenant_id, project_id, eoi_id, buyer_profile_id, refund_policy_id,
    stage, eoi_status_at_request, original_eoi_amount, refund_percent,
    processing_fee, requested_amount, currency, status,
    requested_by, requested_at, reviewed_by, reviewed_at, decision_note, updated_at
  ) VALUES (
    v_tenant, v_project, v_eoi, v_buyer, v_policy,
    'BEFORE_RESERVATION', 'PAID', 10000, 75,
    0, 7500, 'EGP', 'APPROVED',
    v_user, '2026-02-03T09:00:00+00', v_user, '2026-02-03T10:00:00+00',
    'Integrated settlement authority test', '2026-02-03T10:00:00+00'
  ) RETURNING id INTO v_refund;

  UPDATE buyer_eois
  SET status = 'REFUND_REQUESTED',
      refund_requested_at = '2026-02-03T09:00:00+00',
      updated_at = '2026-02-03T09:00:00+00'
  WHERE id = v_eoi;

  IF to_regprocedure('public.preneura_pay_eoi_refund(uuid,uuid,uuid,text,uuid,timestamp with time zone)') IS NOT NULL THEN
    RAISE EXCEPTION 'obsolete direct EOI refund payout function still exists';
  END IF;

  v_rejected := false;
  BEGIN
    UPDATE eoi_refund_requests
    SET status = 'PAID', paid_at = now(), updated_at = now()
    WHERE id = v_refund;
  EXCEPTION WHEN OTHERS THEN
    v_rejected := position('settled disbursement evidence' in SQLERRM) > 0;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'refund PAID state bypassed settlement authority';
  END IF;

  v_settlement := preneura_create_eoi_refund_settlement(
    v_refund, v_user, 'G4-REFUND-SETTLEMENT-001', '2026-02-04T08:00:00+00'
  );
  PERFORM preneura_submit_settlement(
    v_settlement, v_user, 'BANK', 'G4-BANK-REF-001', '2026-02-04T08:30:00+00'
  );
  v_event := preneura_apply_settlement_outcome(
    v_settlement, 'SETTLED', NULL, 'BANK', 'G4-BANK-EVENT-001',
    'G4-BANK-REF-001', '2026-02-04T09:00:00+00', '{}'::jsonb
  );

  SELECT count(*)::int, coalesce(sum(signed_amount),0)::numeric(18,2)
    INTO v_count, v_sum
  FROM settlement_ledger_entries WHERE settlement_event_id = v_event;
  IF v_count <> 2 OR v_sum <> 0 THEN
    RAISE EXCEPTION 'settlement payout event is not exactly balanced';
  END IF;

  IF (SELECT status FROM eoi_refund_requests WHERE id = v_refund) <> 'PAID'
     OR (SELECT status FROM buyer_eois WHERE id = v_eoi) <> 'REFUNDED' THEN
    RAISE EXCEPTION 'settlement evidence did not project PAID/REFUNDED state';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM eoi_finance_events
    WHERE refund_request_id = v_refund
      AND event_type = 'REFUND_ISSUED'
      AND amount = 7500
      AND metadata ->> 'settlementId' = v_settlement::text
  ) THEN
    RAISE EXCEPTION 'settled refund did not mirror into EOI subledger';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM eoi_finance_events
    WHERE refund_request_id = v_refund
      AND event_type = 'RETAINED_AMOUNT_RECOGNIZED'
      AND amount = 2500
      AND metadata ->> 'settlementId' = v_settlement::text
  ) THEN
    RAISE EXCEPTION 'retained EOI amount was not recognized from settlement';
  END IF;

  SELECT coalesce(sum(signed_amount),0)::numeric(18,2) INTO v_sum
  FROM eoi_finance_ledger_entries
  WHERE eoi_id = v_eoi AND account = 'CASH_CLEARING';
  IF v_sum <> 2500 THEN RAISE EXCEPTION 'EOI subledger net cash is %, expected 2500', v_sum; END IF;
  SELECT coalesce(sum(signed_amount),0)::numeric(18,2) INTO v_sum
  FROM eoi_finance_ledger_entries
  WHERE eoi_id = v_eoi AND account = 'EOI_DEPOSIT_LIABILITY';
  IF v_sum <> 0 THEN RAISE EXCEPTION 'EOI deposit liability after payout is %, expected 0', v_sum; END IF;
  SELECT coalesce(sum(signed_amount),0)::numeric(18,2) INTO v_sum
  FROM eoi_finance_ledger_entries
  WHERE eoi_id = v_eoi AND account = 'EOI_FEE_REVENUE';
  IF v_sum <> -2500 THEN RAISE EXCEPTION 'retained EOI revenue is %, expected -2500', v_sum; END IF;

  v_event := preneura_apply_settlement_outcome(
    v_settlement, 'REVERSED', NULL, 'BANK', 'G4-BANK-EVENT-002',
    'G4-BANK-REF-001', '2026-02-05T09:00:00+00', '{}'::jsonb
  );
  SELECT count(*)::int, coalesce(sum(signed_amount),0)::numeric(18,2)
    INTO v_count, v_sum
  FROM settlement_ledger_entries WHERE settlement_event_id = v_event;
  IF v_count <> 2 OR v_sum <> 0 THEN
    RAISE EXCEPTION 'settlement reversal event is not exactly balanced';
  END IF;

  IF (SELECT status FROM eoi_refund_requests WHERE id = v_refund) <> 'APPROVED'
     OR (SELECT status FROM buyer_eois WHERE id = v_eoi) <> 'REFUND_REQUESTED' THEN
    RAISE EXCEPTION 'settlement reversal did not reopen refund obligation';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM eoi_finance_events
    WHERE refund_request_id = v_refund AND event_type = 'REFUND_REVERSED'
  ) OR NOT EXISTS (
    SELECT 1 FROM eoi_finance_events
    WHERE refund_request_id = v_refund AND event_type = 'RETAINED_AMOUNT_REVERSED'
  ) THEN
    RAISE EXCEPTION 'settlement reversal did not append compensating EOI subledger evidence';
  END IF;

  SELECT coalesce(sum(signed_amount),0)::numeric(18,2) INTO v_sum
  FROM eoi_finance_ledger_entries
  WHERE eoi_id = v_eoi AND account = 'CASH_CLEARING';
  IF v_sum <> 10000 THEN RAISE EXCEPTION 'EOI cash after payout reversal is %, expected 10000', v_sum; END IF;
  SELECT coalesce(sum(signed_amount),0)::numeric(18,2) INTO v_sum
  FROM eoi_finance_ledger_entries
  WHERE eoi_id = v_eoi AND account = 'EOI_DEPOSIT_LIABILITY';
  IF v_sum <> -10000 THEN RAISE EXCEPTION 'EOI liability after payout reversal is %, expected -10000', v_sum; END IF;
  SELECT coalesce(sum(signed_amount),0)::numeric(18,2) INTO v_sum
  FROM eoi_finance_ledger_entries
  WHERE eoi_id = v_eoi AND account = 'EOI_FEE_REVENUE';
  IF v_sum <> 0 THEN RAISE EXCEPTION 'EOI fee revenue after payout reversal is %, expected 0', v_sum; END IF;

  IF EXISTS (
    SELECT e.id
    FROM eoi_finance_events e
    LEFT JOIN eoi_finance_ledger_entries l ON l.eoi_finance_event_id = e.id
    WHERE e.eoi_id = v_eoi
    GROUP BY e.id
    HAVING count(l.id) <> 2 OR coalesce(sum(l.signed_amount),0) <> 0
  ) THEN
    RAISE EXCEPTION 'integrated EOI subledger contains an unbalanced event';
  END IF;

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
