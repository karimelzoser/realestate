\set ON_ERROR_STOP on

BEGIN;

DO $$
DECLARE
  v_user uuid;
  v_tenant uuid;
  v_project uuid;
  v_unit_type uuid;
  v_pricing uuid;
  v_buyer uuid;
  v_policy uuid;
  v_eoi uuid;
  v_queue uuid;
  v_slot uuid;
  v_lock uuid;
  v_reservation uuid;
  v_transaction uuid;
  v_schedule uuid;
  v_down uuid;
  v_installment uuid;
  v_event1 uuid;
  v_event2 uuid;
  v_reverse uuid;
  v_refund uuid;
  v_provider uuid;
  v_provider_reversal uuid;
  v_allocations jsonb;
  v_original_alloc uuid;
  v_cheque uuid;
  v_replacement uuid;
  v_rejected boolean;
  v_count integer;
  v_amount numeric(18,2);
BEGIN
  INSERT INTO users (display_name, status)
  VALUES ('Gate 3 Finance Operator', 'ACTIVE') RETURNING id INTO v_user;

  INSERT INTO tenants (code, name, status, default_currency, default_timezone)
  VALUES ('GATE3-FIN', 'Gate 3 Finance Tenant', 'ACTIVE', 'EGP', 'Africa/Cairo')
  RETURNING id INTO v_tenant;

  INSERT INTO projects (tenant_id, code, name, status, currency, timezone)
  VALUES (v_tenant, 'GATE3-FIN', 'Gate 3 Finance Project', 'ACTIVE', 'EGP', 'Africa/Cairo')
  RETURNING id INTO v_project;

  INSERT INTO catalog_unit_types (
    tenant_id, project_id, code, name, indoor_area_sqm, roof_area_sqm,
    garden_area_sqm, status, sort_order
  ) VALUES (
    v_tenant, v_project, 'FIN-A', 'Finance A', 1, 0, 0, 'ACTIVE', 1
  ) RETURNING id INTO v_unit_type;

  INSERT INTO pricing_versions (
    tenant_id, project_id, version_number, label, status, effective_at, created_by
  ) VALUES (
    v_tenant, v_project, 1, 'Finance Price', 'DRAFT', '2026-01-01T00:00:00+00', v_user
  ) RETURNING id INTO v_pricing;

  INSERT INTO pricing_rates (
    tenant_id, project_id, pricing_version_id, unit_type_id, component, rate_per_sqm
  ) VALUES
    (v_tenant, v_project, v_pricing, v_unit_type, 'INDOOR', 300),
    (v_tenant, v_project, v_pricing, v_unit_type, 'ROOF', 0),
    (v_tenant, v_project, v_pricing, v_unit_type, 'GARDEN', 0);

  UPDATE pricing_versions
  SET status = 'PUBLISHED', published_at = '2026-01-01T00:00:00+00',
      published_by = v_user, updated_at = '2026-01-01T00:00:00+00'
  WHERE id = v_pricing;

  INSERT INTO buyer_profiles (tenant_id, user_id, status, source, created_by)
  VALUES (v_tenant, v_user, 'ACTIVE', 'DIRECT', v_user)
  RETURNING id INTO v_buyer;

  INSERT INTO eoi_refund_policies (
    tenant_id, project_id, version_number, name, status, eoi_amount, currency,
    effective_at, published_at, created_by, published_by
  ) VALUES (
    v_tenant, v_project, 1, 'Finance EOI', 'ACTIVE', 10, 'EGP',
    '2025-12-01T00:00:00+00', '2025-12-01T00:00:00+00', v_user, v_user
  ) RETURNING id INTO v_policy;

  INSERT INTO buyer_eois (
    tenant_id, project_id, buyer_profile_id, refund_policy_id,
    amount, currency, status, payment_reference, paid_at, created_by
  ) VALUES (
    v_tenant, v_project, v_buyer, v_policy, 10, 'EGP', 'PAID',
    'FIN-EOI', '2025-12-15T00:00:00+00', v_user
  ) RETURNING id INTO v_eoi;

  INSERT INTO queue_entries (
    tenant_id, project_id, buyer_profile_id, eoi_id, channel,
    priority_group, priority_score, status, checked_in_at, created_by
  ) VALUES (
    v_tenant, v_project, v_buyer, v_eoi, 'ONLINE',
    'STANDARD', 0, 'WAITING', '2026-01-02T00:00:00+00', v_user
  ) RETURNING id INTO v_queue;

  INSERT INTO inventory_slots (tenant_id, project_id, unit_type_id, state, internal_reference)
  VALUES (v_tenant, v_project, v_unit_type, 'AVAILABLE', 'FIN-SLOT')
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
    v_slot, v_unit_type, v_pricing, 300, 'EGP',
    'ACTIVE', v_user, '2026-01-02T00:00:00+00',
    '2026-01-02T00:00:00+00', '2026-01-02T00:00:00+00'
  ) RETURNING id INTO v_reservation;

  INSERT INTO transactions (
    tenant_id, project_id, reservation_id, buyer_profile_id, status, opened_at
  ) VALUES (
    v_tenant, v_project, v_reservation, v_buyer, 'IN_PROGRESS', '2026-01-02T00:05:00+00'
  ) RETURNING id INTO v_transaction;

  INSERT INTO payment_schedules (
    tenant_id, project_id, transaction_id, currency, total_contract_amount,
    status, created_by, activated_at
  ) VALUES (
    v_tenant, v_project, v_transaction, 'EGP', 300,
    'ACTIVE', v_user, '2026-01-02T00:06:00+00'
  ) RETURNING id INTO v_schedule;

  INSERT INTO payment_schedule_items (
    payment_schedule_id, sequence_number, item_type, amount, due_at, status, updated_at
  ) VALUES (
    v_schedule, 1, 'DOWN_PAYMENT', 100, '2026-01-10T00:00:00+00', 'UPCOMING', '2026-01-02T00:06:00+00'
  ) RETURNING id INTO v_down;

  INSERT INTO payment_schedule_items (
    payment_schedule_id, sequence_number, item_type, amount, due_at, status, updated_at
  ) VALUES (
    v_schedule, 2, 'INSTALLMENT', 200, '2026-02-10T00:00:00+00', 'UPCOMING', '2026-01-02T00:06:00+00'
  ) RETURNING id INTO v_installment;

  -- Direct paid state manipulation is rejected.
  v_rejected := false;
  BEGIN
    UPDATE payment_schedule_items
    SET status = 'PAID', paid_amount = amount, paid_at = now(), payment_reference = 'FORGED'
    WHERE id = v_down;
  EXCEPTION WHEN OTHERS THEN
    v_rejected := position('ledger projection' in SQLERRM) > 0;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'database allowed direct PAID state manufacture';
  END IF;

  -- One receipt partially spans two schedule items.
  v_event1 := preneura_post_finance_event(
    v_tenant, v_project, v_transaction, 'PAYMENT_RECEIVED', 150, 'EGP',
    'MANUAL', 'MANUAL-001', v_user, '2026-01-05T00:00:00+00',
    jsonb_build_array(
      jsonb_build_object('paymentItemId', v_down, 'amount', 100),
      jsonb_build_object('paymentItemId', v_installment, 'amount', 50)
    )
  );

  IF (SELECT status FROM payment_schedule_items WHERE id = v_down) <> 'PAID'
     OR (SELECT paid_amount FROM payment_schedule_items WHERE id = v_down) <> 100 THEN
    RAISE EXCEPTION 'down payment projection did not become fully paid';
  END IF;
  IF (SELECT status FROM payment_schedule_items WHERE id = v_installment) <> 'PARTIALLY_PAID'
     OR (SELECT paid_amount FROM payment_schedule_items WHERE id = v_installment) <> 50 THEN
    RAISE EXCEPTION 'installment projection did not become partially paid';
  END IF;

  SELECT count(*)::int, sum(signed_amount)::numeric(18,2)
  INTO v_count, v_amount
  FROM finance_ledger_entries WHERE payment_event_id = v_event1;
  IF v_count <> 2 OR v_amount <> 0 THEN
    RAISE EXCEPTION 'payment event ledger postings are not exactly balanced';
  END IF;

  -- Over-allocation is rejected by the schedule/item boundary.
  v_rejected := false;
  BEGIN
    PERFORM preneura_post_finance_event(
      v_tenant, v_project, v_transaction, 'PAYMENT_RECEIVED', 201, 'EGP',
      'MANUAL', 'MANUAL-OVER', v_user, '2026-01-05T00:01:00+00',
      jsonb_build_array(jsonb_build_object('paymentItemId', v_installment, 'amount', 201))
    );
  EXCEPTION WHEN OTHERS THEN
    v_rejected := true;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'database allowed payment allocation above schedule item amount';
  END IF;

  v_event2 := preneura_post_finance_event(
    v_tenant, v_project, v_transaction, 'PAYMENT_RECEIVED', 150, 'EGP',
    'MANUAL', 'MANUAL-002', v_user, '2026-01-06T00:00:00+00',
    jsonb_build_array(jsonb_build_object('paymentItemId', v_installment, 'amount', 150))
  );

  IF (SELECT status FROM payment_schedule_items WHERE id = v_installment) <> 'PAID'
     OR (SELECT status FROM payment_schedules WHERE id = v_schedule) <> 'COMPLETED' THEN
    RAISE EXCEPTION 'schedule did not complete after exact full allocation';
  END IF;

  SELECT sum(signed_amount)::numeric(18,2) INTO v_amount
  FROM finance_ledger_entries WHERE transaction_id = v_transaction;
  IF v_amount <> 0 THEN
    RAISE EXCEPTION 'transaction ledger is not balanced after receipts';
  END IF;

  -- A compensating reversal never edits original money evidence.
  v_allocations := preneura_compensating_allocations(v_event1, 50);
  v_reverse := preneura_post_finance_event(
    v_tenant, v_project, v_transaction, 'PAYMENT_REVERSED', 50, 'EGP',
    'MANUAL', 'REV-001', v_user, '2026-01-07T00:00:00+00',
    v_allocations, NULL, NULL, v_event1
  );

  IF (SELECT paid_amount FROM payment_schedule_items WHERE id = v_down) <> 50
     OR (SELECT status FROM payment_schedule_items WHERE id = v_down) <> 'PARTIALLY_PAID'
     OR (SELECT status FROM payment_schedules WHERE id = v_schedule) <> 'ACTIVE' THEN
    RAISE EXCEPTION 'reversal did not correctly reopen payment projection';
  END IF;

  v_allocations := preneura_compensating_allocations(v_event1, 50);
  v_refund := preneura_post_finance_event(
    v_tenant, v_project, v_transaction, 'REFUND_ISSUED', 50, 'EGP',
    'MANUAL', 'REFUND-001', v_user, '2026-01-08T00:00:00+00',
    v_allocations, NULL, NULL, v_event1
  );

  IF (SELECT paid_amount FROM payment_schedule_items WHERE id = v_down) <> 0 THEN
    RAISE EXCEPTION 'refund did not reduce allocated paid amount';
  END IF;

  v_rejected := false;
  BEGIN
    PERFORM preneura_post_finance_event(
      v_tenant, v_project, v_transaction, 'PAYMENT_REVERSED', 51, 'EGP',
      'MANUAL', 'REV-TOO-MUCH', v_user, '2026-01-08T00:01:00+00',
      preneura_compensating_allocations(v_event1, 51), NULL, NULL, v_event1
    );
  EXCEPTION WHEN OTHERS THEN
    v_rejected := true;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'database allowed compensation above remaining original allocation';
  END IF;

  -- Provider receipt is FIFO-allocated and idempotent on replay.
  v_provider := preneura_ingest_provider_finance_event(
    'GATEWAY_TEST', 'provider-payment-1', repeat('d',64),
    v_tenant, v_project, v_transaction, 'PAYMENT_RECEIVED', 100, 'EGP',
    'PROVIDER-REF-1', '2026-01-09T00:00:00+00', NULL
  );

  IF (SELECT paid_amount FROM payment_schedule_items WHERE id = v_down) <> 100
     OR (SELECT status FROM payment_schedule_items WHERE id = v_down) <> 'PAID' THEN
    RAISE EXCEPTION 'provider FIFO payment did not settle oldest outstanding item';
  END IF;

  IF preneura_ingest_provider_finance_event(
    'GATEWAY_TEST', 'provider-payment-1', repeat('d',64),
    v_tenant, v_project, v_transaction, 'PAYMENT_RECEIVED', 100, 'EGP',
    'PROVIDER-REF-1', '2026-01-09T00:00:00+00', NULL
  ) <> v_provider THEN
    RAISE EXCEPTION 'provider replay did not return the original payment event';
  END IF;

  IF (SELECT count(*) FROM finance_payment_events WHERE provider='GATEWAY_TEST' AND provider_event_id='provider-payment-1') <> 1 THEN
    RAISE EXCEPTION 'provider replay created a duplicate payment event';
  END IF;

  v_rejected := false;
  BEGIN
    PERFORM preneura_ingest_provider_finance_event(
      'GATEWAY_TEST', 'provider-payment-1', repeat('e',64),
      v_tenant, v_project, v_transaction, 'PAYMENT_RECEIVED', 100, 'EGP',
      'PROVIDER-REF-1', '2026-01-09T00:00:00+00', NULL
    );
  EXCEPTION WHEN OTHERS THEN
    v_rejected := position('re-used with different' in SQLERRM) > 0;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'provider event ID content collision was not rejected';
  END IF;

  v_provider_reversal := preneura_ingest_provider_finance_event(
    'GATEWAY_TEST', 'provider-reversal-1', repeat('f',64),
    v_tenant, v_project, v_transaction, 'PAYMENT_REVERSED', 100, 'EGP',
    'PROVIDER-REV-1', '2026-01-10T00:00:00+00', 'provider-payment-1'
  );

  IF (SELECT paid_amount FROM payment_schedule_items WHERE id = v_down) <> 0 THEN
    RAISE EXCEPTION 'provider reversal did not compensate original allocation';
  END IF;

  -- Immutable money evidence rejects in-place changes/deletes.
  v_rejected := false;
  BEGIN
    UPDATE finance_payment_events SET amount = amount + 1 WHERE id = v_event2;
  EXCEPTION WHEN OTHERS THEN
    v_rejected := position('immutable' in SQLERRM) > 0;
  END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'payment event mutation was allowed'; END IF;

  v_rejected := false;
  BEGIN
    UPDATE finance_ledger_entries SET signed_amount = signed_amount + 1 WHERE payment_event_id = v_event2;
  EXCEPTION WHEN OTHERS THEN
    v_rejected := position('immutable' in SQLERRM) > 0;
  END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'ledger entry mutation was allowed'; END IF;

  v_rejected := false;
  BEGIN
    DELETE FROM finance_payment_allocations WHERE payment_event_id = v_event2;
  EXCEPTION WHEN OTHERS THEN
    v_rejected := position('immutable' in SQLERRM) > 0;
  END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'allocation deletion was allowed'; END IF;

  -- Cheque creation starts an append-only history and root chain.
  INSERT INTO transaction_cheques (
    tenant_id, project_id, transaction_id, sequence_number, amount, due_at,
    status, verified_by, updated_at
  ) VALUES (
    v_tenant, v_project, v_transaction, 1, 80, '2026-03-01T00:00:00+00',
    'EXPECTED', v_user, '2026-01-11T00:00:00+00'
  ) RETURNING id INTO v_cheque;

  IF (SELECT root_cheque_id FROM transaction_cheques WHERE id=v_cheque) <> v_cheque THEN
    RAISE EXCEPTION 'root cheque did not initialize to itself';
  END IF;
  IF (SELECT count(*) FROM finance_cheque_events WHERE cheque_id=v_cheque AND event_type='EXPECTED') <> 1 THEN
    RAISE EXCEPTION 'cheque creation did not append EXPECTED event';
  END IF;

  v_rejected := false;
  BEGIN
    UPDATE transaction_cheques
    SET status='RECEIVED', received_at='2026-01-12T00:00:00+00'
    WHERE id=v_cheque;
  EXCEPTION WHEN OTHERS THEN
    v_rejected := position('event projection' in SQLERRM) > 0;
  END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'direct cheque status mutation was allowed'; END IF;

  PERFORM preneura_record_cheque_event(
    v_cheque, 'RECEIVED', v_user, '2026-01-12T00:00:00+00', 'CHK-001', 'Gate Bank'
  );
  PERFORM preneura_record_cheque_event(
    v_cheque, 'DEPOSITED', v_user, '2026-01-13T00:00:00+00', NULL, NULL
  );
  PERFORM preneura_record_cheque_event(
    v_cheque, 'RETURNED', v_user, '2026-01-14T00:00:00+00', NULL, NULL
  );

  IF (SELECT status FROM transaction_cheques WHERE id=v_cheque) <> 'RETURNED' THEN
    RAISE EXCEPTION 'cheque projection did not reach RETURNED';
  END IF;

  v_replacement := preneura_replace_returned_cheque(
    v_cheque, v_user, 80, '2026-03-15T00:00:00+00', 'CHK-002', 'Gate Bank',
    '2026-01-15T00:00:00+00'
  );

  IF (SELECT generation FROM transaction_cheques WHERE id=v_replacement) <> 2
     OR (SELECT root_cheque_id FROM transaction_cheques WHERE id=v_replacement) <> v_cheque
     OR (SELECT replaces_cheque_id FROM transaction_cheques WHERE id=v_replacement) <> v_cheque THEN
    RAISE EXCEPTION 'replacement cheque chain is incorrect';
  END IF;
  IF (SELECT status FROM transaction_cheques WHERE id=v_cheque) <> 'RETURNED' THEN
    RAISE EXCEPTION 'replacement rewrote bounced cheque history';
  END IF;
  IF (SELECT count(*) FROM finance_cheque_events WHERE cheque_id=v_cheque AND event_type='REPLACED') <> 1
     OR (SELECT count(*) FROM finance_cheque_events WHERE cheque_id=v_replacement AND event_type='EXPECTED') <> 1 THEN
    RAISE EXCEPTION 'replacement history events are incomplete';
  END IF;

  v_rejected := false;
  BEGIN
    UPDATE finance_cheque_events SET bank_name='Changed Bank' WHERE cheque_id=v_cheque;
  EXCEPTION WHEN OTHERS THEN
    v_rejected := position('immutable' in SQLERRM) > 0;
  END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'cheque event mutation was allowed'; END IF;

  -- Final ledger reconciliation: every payment event has exactly two postings,
  -- every event balances to zero, and transaction balance is zero.
  IF EXISTS (
    SELECT 1
    FROM finance_payment_events e
    LEFT JOIN finance_ledger_entries l ON l.payment_event_id=e.id
    WHERE e.transaction_id=v_transaction
    GROUP BY e.id
    HAVING count(l.id) <> 2 OR COALESCE(sum(l.signed_amount),0) <> 0
  ) THEN
    RAISE EXCEPTION 'one or more finance events are not exactly double-entry balanced';
  END IF;

  SELECT COALESCE(sum(signed_amount),0)::numeric(18,2) INTO v_amount
  FROM finance_ledger_entries WHERE transaction_id=v_transaction;
  IF v_amount <> 0 THEN RAISE EXCEPTION 'final transaction ledger is not balanced'; END IF;
END $$;

ROLLBACK;
