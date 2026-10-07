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
  v_receipt_1 uuid;
  v_receipt_1_repeat uuid;
  v_reversal uuid;
  v_receipt_2 uuid;
  v_queue uuid;
  v_refund_request uuid;
  v_refund_event uuid;
  v_refund_event_repeat uuid;
  v_count integer;
  v_amount numeric(18,2);
  v_rejected boolean;
BEGIN
  INSERT INTO users (display_name, status)
  VALUES ('Gate 4 EOI Finance Operator', 'ACTIVE')
  RETURNING id INTO v_user;

  INSERT INTO tenants (code, name, status, default_currency, default_timezone)
  VALUES ('GATE4-EOI', 'Gate 4 EOI Tenant', 'ACTIVE', 'EGP', 'Africa/Cairo')
  RETURNING id INTO v_tenant;

  INSERT INTO projects (tenant_id, code, name, status, currency, timezone)
  VALUES (v_tenant, 'GATE4-EOI', 'Gate 4 EOI Project', 'ACTIVE', 'EGP', 'Africa/Cairo')
  RETURNING id INTO v_project;

  INSERT INTO buyer_profiles (tenant_id, user_id, status, source, created_by)
  VALUES (v_tenant, v_user, 'ACTIVE', 'DIRECT', v_user)
  RETURNING id INTO v_buyer;

  INSERT INTO eoi_refund_policies (
    tenant_id, project_id, version_number, name, status, eoi_amount, currency,
    before_reservation_refund_percent,
    after_reservation_before_contract_refund_percent,
    after_contract_refund_percent,
    processing_fee, effective_at, published_at, created_by, published_by
  ) VALUES (
    v_tenant, v_project, 1, 'Gate 4 Refund Policy', 'ACTIVE', 10000, 'EGP',
    75, 50, 0, 0,
    '2026-01-01T00:00:00+00', '2026-01-01T00:00:00+00', v_user, v_user
  ) RETURNING id INTO v_policy;

  INSERT INTO buyer_eois (
    tenant_id, project_id, buyer_profile_id, refund_policy_id,
    amount, currency, status, created_by
  ) VALUES (
    v_tenant, v_project, v_buyer, v_policy,
    10000, 'EGP', 'PAYMENT_PENDING', v_user
  ) RETURNING id INTO v_eoi;

  -- Financial projection columns are not a write authority.
  v_rejected := false;
  BEGIN
    UPDATE buyer_eois
    SET status = 'PAID', payment_reference = 'FORGED', paid_at = now()
    WHERE id = v_eoi;
  EXCEPTION WHEN OTHERS THEN
    v_rejected := position('ledger-derived' in SQLERRM) > 0;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'database allowed direct EOI PAID projection manufacture';
  END IF;

  -- Initial immutable receipt and same-reference idempotency.
  v_receipt_1 := preneura_post_eoi_payment(
    v_tenant, v_project, v_eoi, 'EOI-RECEIPT-001', v_user,
    '2026-02-01T09:00:00+00', 'MANUAL', NULL, NULL
  );
  v_receipt_1_repeat := preneura_post_eoi_payment(
    v_tenant, v_project, v_eoi, 'EOI-RECEIPT-001', v_user,
    '2026-02-01T09:01:00+00', 'MANUAL', NULL, NULL
  );
  IF v_receipt_1_repeat <> v_receipt_1 THEN
    RAISE EXCEPTION 'same EOI receipt reference was not idempotent';
  END IF;
  IF (SELECT status FROM buyer_eois WHERE id = v_eoi) <> 'PAID'
     OR (SELECT payment_reference FROM buyer_eois WHERE id = v_eoi) <> 'EOI-RECEIPT-001' THEN
    RAISE EXCEPTION 'EOI payment projection did not reconcile to receipt';
  END IF;

  -- A second active receipt is forbidden.
  v_rejected := false;
  BEGIN
    PERFORM preneura_post_eoi_payment(
      v_tenant, v_project, v_eoi, 'EOI-RECEIPT-CONFLICT', v_user,
      '2026-02-01T09:02:00+00', 'MANUAL', NULL, NULL
    );
  EXCEPTION WHEN OTHERS THEN
    v_rejected := position('active immutable payment receipt' in SQLERRM) > 0;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'database allowed a second active EOI receipt';
  END IF;

  -- A mistaken receipt is compensated, never rewritten.
  v_reversal := preneura_reverse_eoi_payment(
    v_tenant, v_project, v_eoi, 'EOI-REVERSAL-001', v_user,
    '2026-02-01T10:00:00+00'
  );
  IF (SELECT status FROM buyer_eois WHERE id = v_eoi) <> 'PAYMENT_PENDING'
     OR (SELECT payment_reference FROM buyer_eois WHERE id = v_eoi) IS NOT NULL THEN
    RAISE EXCEPTION 'EOI reversal did not reopen payment-pending projection';
  END IF;

  -- Regression: a corrected receipt must be possible after reversal while the
  -- original receipt/reversal remain immutable historical evidence.
  v_receipt_2 := preneura_post_eoi_payment(
    v_tenant, v_project, v_eoi, 'EOI-RECEIPT-002', v_user,
    '2026-02-01T11:00:00+00', 'MANUAL', NULL, NULL
  );
  IF v_receipt_2 = v_receipt_1 THEN
    RAISE EXCEPTION 'corrected EOI payment reused reversed receipt evidence';
  END IF;
  SELECT count(*)::int INTO v_count
  FROM eoi_finance_events
  WHERE eoi_id = v_eoi AND event_type = 'PAYMENT_RECEIVED';
  IF v_count <> 2 THEN
    RAISE EXCEPTION 'corrected payment did not preserve both receipt records';
  END IF;
  SELECT count(*)::int INTO v_count
  FROM eoi_finance_events
  WHERE eoi_id = v_eoi
    AND event_type = 'PAYMENT_RECEIVED'
    AND NOT EXISTS (
      SELECT 1 FROM eoi_finance_events r
      WHERE r.event_type = 'PAYMENT_REVERSED'
        AND r.related_event_id = eoi_finance_events.id
    );
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'EOI does not have exactly one active unreversed receipt';
  END IF;

  -- Once the buyer enters the queue the active deposit cannot be reversed.
  INSERT INTO queue_entries (
    tenant_id, project_id, buyer_profile_id, eoi_id, channel,
    priority_group, priority_score, status, checked_in_at, created_by
  ) VALUES (
    v_tenant, v_project, v_buyer, v_eoi, 'ONLINE',
    'STANDARD', 0, 'WAITING', '2026-02-02T08:00:00+00', v_user
  ) RETURNING id INTO v_queue;

  v_rejected := false;
  BEGIN
    PERFORM preneura_reverse_eoi_payment(
      v_tenant, v_project, v_eoi, 'EOI-REVERSAL-LATE', v_user,
      '2026-02-02T08:01:00+00'
    );
  EXCEPTION WHEN OTHERS THEN
    v_rejected := position('queue entry exists' in SQLERRM) > 0;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'database allowed EOI reversal after queue entry';
  END IF;

  -- Create an approved 75% refund snapshot. Approval and payout are separate.
  INSERT INTO eoi_refund_requests (
    tenant_id, project_id, eoi_id, buyer_profile_id, refund_policy_id,
    stage, eoi_status_at_request, original_eoi_amount, refund_percent,
    processing_fee, requested_amount, currency, status,
    requested_by, requested_at, reviewed_by, reviewed_at, decision_note
  ) VALUES (
    v_tenant, v_project, v_eoi, v_buyer, v_policy,
    'BEFORE_RESERVATION', 'PAID', 10000, 75,
    0, 7500, 'EGP', 'APPROVED',
    v_user, '2026-02-03T09:00:00+00', v_user, '2026-02-03T10:00:00+00',
    'Gate 4 approved partial refund'
  ) RETURNING id INTO v_refund_request;

  UPDATE buyer_eois
  SET status = 'REFUND_REQUESTED',
      refund_requested_at = '2026-02-03T09:00:00+00',
      updated_at = '2026-02-03T09:00:00+00'
  WHERE id = v_eoi;

  -- Direct payout projection is forbidden even after approval.
  v_rejected := false;
  BEGIN
    UPDATE eoi_refund_requests
    SET status = 'PAID', paid_at = now(), updated_at = now()
    WHERE id = v_refund_request;
  EXCEPTION WHEN OTHERS THEN
    v_rejected := position('ledger-derived' in SQLERRM) > 0;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'database allowed direct refund payout projection manufacture';
  END IF;

  v_refund_event := preneura_pay_eoi_refund(
    v_tenant, v_project, v_refund_request, 'EOI-PAYOUT-001', v_user,
    '2026-02-04T09:00:00+00'
  );
  v_refund_event_repeat := preneura_pay_eoi_refund(
    v_tenant, v_project, v_refund_request, 'EOI-PAYOUT-001', v_user,
    '2026-02-04T09:01:00+00'
  );
  IF v_refund_event_repeat <> v_refund_event THEN
    RAISE EXCEPTION 'same refund payout reference was not idempotent';
  END IF;

  v_rejected := false;
  BEGIN
    PERFORM preneura_pay_eoi_refund(
      v_tenant, v_project, v_refund_request, 'EOI-PAYOUT-CONFLICT', v_user,
      '2026-02-04T09:02:00+00'
    );
  EXCEPTION WHEN OTHERS THEN
    v_rejected := position('different immutable payout' in SQLERRM) > 0;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'database allowed a second payout reference for one refund';
  END IF;

  IF (SELECT status FROM eoi_refund_requests WHERE id = v_refund_request) <> 'PAID'
     OR (SELECT paid_at FROM eoi_refund_requests WHERE id = v_refund_request) IS NULL THEN
    RAISE EXCEPTION 'refund request payout projection did not reconcile';
  END IF;
  IF (SELECT status FROM buyer_eois WHERE id = v_eoi) <> 'REFUNDED'
     OR (SELECT refunded_at FROM buyer_eois WHERE id = v_eoi) IS NULL THEN
    RAISE EXCEPTION 'EOI refund projection did not reconcile';
  END IF;

  IF (SELECT amount FROM eoi_finance_events WHERE id = v_refund_event) <> 7500 THEN
    RAISE EXCEPTION 'refund event amount does not match approved request';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM eoi_finance_events
    WHERE refund_request_id = v_refund_request
      AND event_type = 'RETAINED_AMOUNT_RECOGNIZED'
      AND amount = 2500
  ) THEN
    RAISE EXCEPTION 'retained EOI amount was not recognized';
  END IF;

  -- Every immutable event must have exactly two balanced ledger lines.
  IF EXISTS (
    SELECT e.id
    FROM eoi_finance_events e
    LEFT JOIN eoi_finance_ledger_entries l ON l.eoi_finance_event_id = e.id
    WHERE e.eoi_id = v_eoi
    GROUP BY e.id
    HAVING count(l.id) <> 2 OR COALESCE(sum(l.signed_amount), 0) <> 0
  ) THEN
    RAISE EXCEPTION 'one or more EOI finance events are not exactly balanced';
  END IF;

  SELECT COALESCE(sum(signed_amount), 0)::numeric(18,2)
  INTO v_amount
  FROM eoi_finance_ledger_entries
  WHERE eoi_id = v_eoi AND account = 'CASH_CLEARING';
  IF v_amount <> 2500 THEN
    RAISE EXCEPTION 'net EOI cash after refund is %, expected 2500', v_amount;
  END IF;

  SELECT COALESCE(sum(signed_amount), 0)::numeric(18,2)
  INTO v_amount
  FROM eoi_finance_ledger_entries
  WHERE eoi_id = v_eoi AND account = 'EOI_DEPOSIT_LIABILITY';
  IF v_amount <> 0 THEN
    RAISE EXCEPTION 'EOI deposit liability did not settle to zero';
  END IF;

  SELECT COALESCE(sum(signed_amount), 0)::numeric(18,2)
  INTO v_amount
  FROM eoi_finance_ledger_entries
  WHERE eoi_id = v_eoi AND account = 'EOI_FEE_REVENUE';
  IF v_amount <> -2500 THEN
    RAISE EXCEPTION 'retained EOI revenue projection is %, expected -2500', v_amount;
  END IF;

  SELECT COALESCE(sum(signed_amount), 0)::numeric(18,2)
  INTO v_amount
  FROM eoi_finance_ledger_entries
  WHERE eoi_id = v_eoi;
  IF v_amount <> 0 THEN
    RAISE EXCEPTION 'EOI ledger does not reconcile to zero';
  END IF;

  -- Immutable evidence cannot be edited or deleted after posting.
  v_rejected := false;
  BEGIN
    UPDATE eoi_finance_events SET external_reference = 'TAMPERED' WHERE id = v_receipt_2;
  EXCEPTION WHEN OTHERS THEN
    v_rejected := position('immutable' in SQLERRM) > 0;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'database allowed EOI finance event mutation';
  END IF;

  v_rejected := false;
  BEGIN
    DELETE FROM eoi_finance_ledger_entries WHERE eoi_finance_event_id = v_refund_event;
  EXCEPTION WHEN OTHERS THEN
    v_rejected := position('immutable' in SQLERRM) > 0;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'database allowed EOI ledger deletion';
  END IF;

  -- Runtime contract must identify this financial authority version exactly.
  IF NOT EXISTS (
    SELECT 1 FROM platform_runtime_contract
    WHERE singleton_key = 'production'
      AND schema_version = 34
      AND minimum_runtime_version = 34
      AND migration_marker = '0034_eoi_financial_evidence'
  ) THEN
    RAISE EXCEPTION 'runtime contract is not pinned to EOI finance schema 34';
  END IF;
END $$;

SET CONSTRAINTS ALL IMMEDIATE;
ROLLBACK;
