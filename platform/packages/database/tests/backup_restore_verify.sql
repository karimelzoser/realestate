\set ON_ERROR_STOP on

DO $$
DECLARE
  v_balance numeric(18,2);
  v_manifest_hash text;
BEGIN
  IF (SELECT count(*) FROM platform_schema_migrations) <> 35 THEN
    RAISE EXCEPTION 'restored migration ledger does not contain all 35 migrations';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM platform_runtime_contract
    WHERE singleton_key='production'
      AND schema_version=35
      AND migration_marker='0035_settlement_state_authority'
  ) THEN
    RAISE EXCEPTION 'restored runtime contract is not current';
  END IF;

  IF (SELECT quoted_total FROM reservations WHERE id='00000000-0000-0000-0000-000000012000') <> 232500 THEN
    RAISE EXCEPTION 'restored reservation quote total is incorrect';
  END IF;
  IF (SELECT count(*) FROM reservation_price_components WHERE reservation_id='00000000-0000-0000-0000-000000012000') <> 3 THEN
    RAISE EXCEPTION 'restored reservation lost immutable price components';
  END IF;
  IF (SELECT coalesce(sum(amount),0) FROM reservation_price_components WHERE reservation_id='00000000-0000-0000-0000-000000012000') <> 232500 THEN
    RAISE EXCEPTION 'restored reservation price components do not reconcile';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM transaction_documents d
    JOIN storage_object_trust t ON t.id=d.object_trust_id
    WHERE d.id='00000000-0000-0000-0000-000000014004'
      AND d.status='STAMPED'
      AND d.storage_object_key='backup/contract.pdf'
      AND d.sha256_hex=repeat('b',64)
      AND t.status='CLEAN'
      AND t.sha256_hex=repeat('b',64)
  ) THEN
    RAISE EXCEPTION 'restored executed contract/object trust evidence is incomplete';
  END IF;

  IF (SELECT count(*) FROM document_signatures WHERE document_id='00000000-0000-0000-0000-000000014004') <> 2 THEN
    RAISE EXCEPTION 'restored contract signer evidence count is incorrect';
  END IF;

  SELECT encode(digest(convert_to(manifest::text,'UTF8'),'sha256'),'hex')
    INTO v_manifest_hash
  FROM contract_execution_snapshots
  WHERE document_id='00000000-0000-0000-0000-000000014004';

  IF v_manifest_hash IS NULL OR v_manifest_hash IS DISTINCT FROM (
    SELECT manifest_sha256_hex FROM contract_execution_snapshots
    WHERE document_id='00000000-0000-0000-0000-000000014004'
  ) THEN
    RAISE EXCEPTION 'restored contract execution manifest hash does not verify';
  END IF;

  IF (SELECT count(*) FROM finance_payment_events WHERE transaction_id='00000000-0000-0000-0000-000000013000') <> 1 THEN
    RAISE EXCEPTION 'restored finance payment-event count is incorrect';
  END IF;
  IF (SELECT count(*) FROM finance_ledger_entries WHERE transaction_id='00000000-0000-0000-0000-000000013000') <> 2 THEN
    RAISE EXCEPTION 'restored finance ledger entry count is incorrect';
  END IF;
  SELECT coalesce(sum(signed_amount),0) INTO v_balance
  FROM finance_ledger_entries
  WHERE transaction_id='00000000-0000-0000-0000-000000013000';
  IF v_balance <> 0 THEN
    RAISE EXCEPTION 'restored finance ledger is not balanced';
  END IF;
  IF (SELECT paid_amount FROM payment_schedule_items WHERE id='00000000-0000-0000-0000-000000015001') <> 100000 THEN
    RAISE EXCEPTION 'restored down-payment allocation is incorrect';
  END IF;

  IF (SELECT count(*) FROM transaction_cheques WHERE root_cheque_id='00000000-0000-0000-0000-000000015003') <> 2 THEN
    RAISE EXCEPTION 'restored cheque replacement chain is incomplete';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM transaction_cheques
    WHERE root_cheque_id='00000000-0000-0000-0000-000000015003'
      AND generation=1 AND status='RETURNED'
  ) OR NOT EXISTS (
    SELECT 1 FROM transaction_cheques
    WHERE root_cheque_id='00000000-0000-0000-0000-000000015003'
      AND generation=2 AND status='RECEIVED'
  ) THEN
    RAISE EXCEPTION 'restored cheque current/history projections are incorrect';
  END IF;
  IF (
    SELECT count(*)
    FROM finance_cheque_events e
    JOIN transaction_cheques c ON c.id=e.cheque_id
    WHERE c.root_cheque_id='00000000-0000-0000-0000-000000015003'
  ) < 6 THEN
    RAISE EXCEPTION 'restored cheque event history is incomplete';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM broker_commission_cases
    WHERE id='00000000-0000-0000-0000-000000015005'
      AND status='ELIGIBLE'
      AND basis_amount=232500
      AND rate_percent=5.0000
      AND commission_amount=11625
  ) THEN
    RAISE EXCEPTION 'restored commission case is incorrect';
  END IF;
END $$;
