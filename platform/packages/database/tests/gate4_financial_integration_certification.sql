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
  v_settlement uuid;
  v_count integer;
  v_amount numeric(18,2);
  v_rejected boolean;
BEGIN
  INSERT INTO users (display_name, status)
  VALUES ('Gate 4 Integrated Finance Operator', 'ACTIVE')
  RETURNING id INTO v_user;

  INSERT INTO tenants (code, name, status, default_currency, default_timezone)
  VALUES ('G4-INT', 'Gate 4 Integration Tenant', 'ACTIVE', 'EGP', 'Africa/Cairo')
  RETURNING id INTO v_tenant;

  INSERT INTO projects (tenant_id, code, name, status, currency, timezone)
  VALUES (v_tenant, 'G4-INT', 'Gate 4 Integration Project', 'ACTIVE', 'EGP', 'Africa/Cairo')
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
    v_tenant, v_project, 1, 'Gate 4 Integrated Refund Policy', 'ACTIVE', 10000, 'EGP',
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

  -- Projection columns cannot manufacture an EOI receipt.
  v_rejected := false;
  BEGIN
    UPDATE buyer_eois
    SET status = 'PAID', payment_reference = 'FORGED', paid_at = now()
    WHERE id = v_eoi;
  EXCEPTION WHEN OTHERS THEN
    v_rejected := position('ledger-derived' in SQLERRM) > 0;
  END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'direct EOI PAID projection was accepted'; END IF;

  v_receipt_1 := preneura_post_eoi_payment(
    v_tenant, v_project, v_eoi, 'EOI-RECEIPT-001', v_user,
    '2026-02-01T09:00:00+00'
  );
  v_receipt_1_repeat := preneura_post_eoi_payment(
    v_tenant, v_project, v_eoi, 'EOI-RECEIPT-001', v_user,
    '2026-02-01T09:01:00+00'
  );
  IF v_receipt_1_repeat <> v_receipt_1 THEN
    RAISE EXCEPTION 'same EOI receipt reference was not idempotent';
  END IF;

  -- One-shot projection authority must not leak after a valid payment command.
  v_rejected := false;
  BEGIN
    UPDATE buyer_eois SET payment_reference = 'FORGED-AFTER-VALID-COMMAND' WHERE id = v_eoi;
  EXCEPTION WHEN OTHERS THEN
    v_rejected := position('ledger-derived' in SQLERRM) > 0;
  END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'EOI payment authority leaked beyond one projection'; END IF;

  -- A different simultaneous active receipt is forbidden.
  v_rejected := false;
  BEGIN
    PERFORM preneura_post_eoi_payment(
      v_tenant, v_project, v_eoi, 'EOI-RECEIPT-CONFLICT', v_user,
      '2026-02-01T09:02:00+00'
    );
  EXCEPTION WHEN OTHERS THEN
    v_rejected := position('active immutable payment receipt' in SQLERRM) > 0;
  END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'second active EOI receipt was accepted'; END IF;

  -- Corrections compensate immutable evidence; they never rewrite the receipt.
  v_reversal := preneura_reverse_eoi_payment(
    v_tenant, v_project, v_eoi, 'EOI-REVERSAL-001', v_user,
    '2026-02-01T10:00:00+00'
  );
  v_receipt_2 := preneura_post_eoi_payment(
    v_tenant, v_project, v_eoi, 'EOI-RECEIPT-002', v_user,
    '2026-02-01T11:00:00+00'
  );
  IF v_receipt_2 = v_receipt_1 OR v_reversal IS NULL THEN
    RAISE EXCEPTION 'corrected EOI payment did not preserve independent evidence';
  END IF;

  SELECT count(*)::int INTO v_count
  FROM eoi_finance_events receipt
  WHERE receipt.eoi_id = v_eoi
    AND receipt.event_type = 'PAYMENT_RECEIVED'
    AND NOT EXISTS (
      SELECT 1 FROM eoi_finance_events reversal
      WHERE reversal.event_type = 'PAYMENT_REVERSED'
        AND reversal.related_event_id = receipt.id
    );
  IF v_count <> 1 THEN RAISE EXCEPTION 'EOI does not have exactly one active receipt'; END IF;

  -- Once allocation processing begins, receipt correction is closed.
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
  IF NOT v_rejected THEN RAISE EXCEPTION 'late EOI receipt reversal was accepted'; END IF;

  -- Approval creates an obligation but does not itself prove outgoing cash.
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
    'Gate 4 integrated partial refund'
  ) RETURNING id INTO v_refund_request;

  UPDATE buyer_eois
  SET status = 'REFUND_REQUESTED', refund_requested_at = '2026-02-03T09:00:00+00',
      updated_at = '2026-02-03T09:00:00+00'
  WHERE id = v_eoi;

  v_rejected := false;
  BEGIN
    UPDATE eoi_refund_requests
    SET status = 'PAID', paid_at = now(), updated_at = now()
    WHERE id = v_refund_request;
  EXCEPTION WHEN OTHERS THEN
    v_rejected := position('settled disbursement' in SQLERRM) > 0
      OR position('deposit-ledger' in SQLERRM) > 0;
  END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'approved refund was directly manufactured as PAID'; END IF;

  -- Settlement is the only outgoing-cash authority.
  v_settlement := preneura_create_eoi_refund_settlement(
    v_refund_request, v_user, 'G4-REFUND-SETTLEMENT-001',
    '2026-02-04T08:00:00+00'
  );
  PERFORM preneura_apply_settlement_outcome(
    v_settlement, 'SETTLED', v_user, 'GATE4-PROVIDER', 'PROVIDER-EVENT-001',
    'PAYOUT-001', '2026-02-04T09:00:00+00', '{}'::jsonb
  );

  IF (SELECT status FROM settlement_disbursements WHERE id = v_settlement) <> 'SETTLED' THEN
    RAISE EXCEPTION 'EOI refund settlement did not reach SETTLED';
  END IF;
  IF (SELECT status FROM eoi_refund_requests WHERE id = v_refund_request) <> 'PAID' THEN
    RAISE EXCEPTION 'settled disbursement did not derive refund PAID projection';
  END IF;
  IF (SELECT status FROM buyer_eois WHERE id = v_eoi) <> 'REFUNDED' THEN
    RAISE EXCEPTION 'settled disbursement did not derive EOI REFUNDED projection';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM eoi_finance_events
    WHERE settlement_id = v_settlement AND refund_request_id = v_refund_request
      AND event_type = 'REFUND_ISSUED' AND amount = 7500
  ) THEN RAISE EXCEPTION 'settlement did not create EOI refund-liability evidence'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM eoi_finance_events
    WHERE settlement_id = v_settlement AND refund_request_id = v_refund_request
      AND event_type = 'RETAINED_AMOUNT_RECOGNIZED' AND amount = 2500
  ) THEN RAISE EXCEPTION 'retained EOI amount was not recognized'; END IF;

  -- Each subledger remains balanced on its own immutable events.
  IF EXISTS (
    SELECT e.id
    FROM eoi_finance_events e
    LEFT JOIN eoi_finance_ledger_entries l ON l.eoi_finance_event_id = e.id
    WHERE e.eoi_id = v_eoi
    GROUP BY e.id
    HAVING count(l.id) <> 2 OR COALESCE(sum(l.signed_amount), 0) <> 0
  ) THEN RAISE EXCEPTION 'EOI finance contains an unbalanced event'; END IF;

  -- Integrated accounting after payout: customer deposit is fully released,
  -- the inter-ledger payable clears to zero, 2,500 is retained revenue, and
  -- net cash remains 2,500. No second refund cash posting exists in EOI finance.
  SELECT COALESCE(sum(amount), 0)::numeric(18,2) INTO v_amount FROM (
    SELECT signed_amount AS amount
    FROM eoi_finance_ledger_entries WHERE eoi_id = v_eoi AND account = 'CASH_CLEARING'
    UNION ALL
    SELECT signed_amount
    FROM settlement_ledger_entries WHERE settlement_id = v_settlement AND account_code = 'CASH_CLEARING'
  ) x;
  IF v_amount <> 2500 THEN RAISE EXCEPTION 'integrated cash is %, expected 2500', v_amount; END IF;

  SELECT COALESCE(sum(signed_amount), 0)::numeric(18,2) INTO v_amount
  FROM eoi_finance_ledger_entries
  WHERE eoi_id = v_eoi AND account = 'EOI_DEPOSIT_LIABILITY';
  IF v_amount <> 0 THEN RAISE EXCEPTION 'EOI deposit liability is %, expected 0', v_amount; END IF;

  SELECT COALESCE(sum(amount), 0)::numeric(18,2) INTO v_amount FROM (
    SELECT signed_amount AS amount
    FROM eoi_finance_ledger_entries
    WHERE eoi_id = v_eoi AND account = 'BUYER_REFUND_PAYABLE'
    UNION ALL
    SELECT signed_amount
    FROM settlement_ledger_entries
    WHERE settlement_id = v_settlement AND account_code = 'BUYER_REFUND_PAYABLE'
  ) x;
  IF v_amount <> 0 THEN RAISE EXCEPTION 'inter-ledger refund payable is %, expected 0', v_amount; END IF;

  SELECT COALESCE(sum(signed_amount), 0)::numeric(18,2) INTO v_amount
  FROM eoi_finance_ledger_entries
  WHERE eoi_id = v_eoi AND account = 'EOI_FEE_REVENUE';
  IF v_amount <> -2500 THEN RAISE EXCEPTION 'retained revenue is %, expected -2500', v_amount; END IF;

  SELECT (eoi_refund_payable_balance + settlement_refund_payable_movement)::numeric(18,2)
    INTO v_amount
  FROM eoi_refund_financial_reconciliation
  WHERE refund_request_id = v_refund_request;
  IF v_amount <> 0 THEN RAISE EXCEPTION 'reconciliation view payable does not clear'; END IF;

  -- Settlement reversal restores the deposit obligation without deleting any
  -- payout evidence. The customer/refund projections reopen from evidence.
  PERFORM preneura_apply_settlement_outcome(
    v_settlement, 'REVERSED', v_user, 'GATE4-PROVIDER', 'PROVIDER-EVENT-002',
    'PAYOUT-REVERSAL-001', '2026-02-05T09:00:00+00', '{}'::jsonb
  );

  IF (SELECT status FROM eoi_refund_requests WHERE id = v_refund_request) <> 'APPROVED' THEN
    RAISE EXCEPTION 'reversed settlement did not reopen refund approval';
  END IF;
  IF (SELECT status FROM buyer_eois WHERE id = v_eoi) <> 'REFUND_REQUESTED' THEN
    RAISE EXCEPTION 'reversed settlement did not reopen EOI refund-requested state';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM eoi_finance_events
    WHERE settlement_id = v_settlement AND event_type = 'REFUND_REVERSED'
  ) THEN RAISE EXCEPTION 'EOI refund reversal evidence missing'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM eoi_finance_events
    WHERE settlement_id = v_settlement AND event_type = 'RETAINED_AMOUNT_REVERSED'
  ) THEN RAISE EXCEPTION 'retained-amount reversal evidence missing'; END IF;

  SELECT COALESCE(sum(amount), 0)::numeric(18,2) INTO v_amount FROM (
    SELECT signed_amount AS amount
    FROM eoi_finance_ledger_entries WHERE eoi_id = v_eoi AND account = 'CASH_CLEARING'
    UNION ALL
    SELECT signed_amount
    FROM settlement_ledger_entries WHERE settlement_id = v_settlement AND account_code = 'CASH_CLEARING'
  ) x;
  IF v_amount <> 10000 THEN RAISE EXCEPTION 'cash after reversal is %, expected 10000', v_amount; END IF;

  SELECT COALESCE(sum(signed_amount), 0)::numeric(18,2) INTO v_amount
  FROM eoi_finance_ledger_entries
  WHERE eoi_id = v_eoi AND account = 'EOI_DEPOSIT_LIABILITY';
  IF v_amount <> -10000 THEN RAISE EXCEPTION 'deposit liability after reversal is %, expected -10000', v_amount; END IF;

  SELECT COALESCE(sum(amount), 0)::numeric(18,2) INTO v_amount FROM (
    SELECT signed_amount AS amount
    FROM eoi_finance_ledger_entries WHERE eoi_id = v_eoi AND account = 'BUYER_REFUND_PAYABLE'
    UNION ALL
    SELECT signed_amount
    FROM settlement_ledger_entries WHERE settlement_id = v_settlement AND account_code = 'BUYER_REFUND_PAYABLE'
  ) x;
  IF v_amount <> 0 THEN RAISE EXCEPTION 'payable after reversal is %, expected 0', v_amount; END IF;

  SELECT COALESCE(sum(signed_amount), 0)::numeric(18,2) INTO v_amount
  FROM eoi_finance_ledger_entries
  WHERE eoi_id = v_eoi AND account = 'EOI_FEE_REVENUE';
  IF v_amount <> 0 THEN RAISE EXCEPTION 'retained revenue after reversal is %, expected 0', v_amount; END IF;

  -- Append-only evidence cannot be rewritten.
  v_rejected := false;
  BEGIN
    UPDATE eoi_finance_events SET external_reference = 'TAMPERED' WHERE id = v_receipt_2;
  EXCEPTION WHEN OTHERS THEN
    v_rejected := position('immutable' in SQLERRM) > 0;
  END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'EOI finance event mutation was accepted'; END IF;

  v_rejected := false;
  BEGIN
    DELETE FROM eoi_finance_ledger_entries WHERE eoi_finance_event_id = v_receipt_2;
  EXCEPTION WHEN OTHERS THEN
    v_rejected := position('immutable' in SQLERRM) > 0;
  END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'EOI finance ledger deletion was accepted'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM platform_runtime_contract
    WHERE singleton_key = 'production'
      AND schema_version = 39
      AND minimum_runtime_version = 39
      AND migration_marker = '0039_gate4_financial_integration'
  ) THEN RAISE EXCEPTION 'runtime contract is not integrated Gate 4 schema 39'; END IF;
END $$;

SET CONSTRAINTS ALL IMMEDIATE;
ROLLBACK;
