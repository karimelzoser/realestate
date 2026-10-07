BEGIN;

-- The settlement command may be created only when its source obligation is
-- backed by immutable financial evidence. This closes the gap between EOI
-- deposit accounting and the outgoing settlement subledger before money can be
-- submitted to a payout provider.
CREATE OR REPLACE FUNCTION settlement_validate_scope()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_tenant uuid;
  v_project uuid;
  v_amount numeric(18,2);
  v_currency char(3);
  v_buyer uuid;
  v_broker uuid;
  v_eoi uuid;
  v_receipt_amount numeric(18,2);
  v_receipt_currency char(3);
BEGIN
  IF NEW.settlement_type = 'EOI_REFUND' THEN
    SELECT r.tenant_id, r.project_id, r.requested_amount, r.currency,
           r.buyer_profile_id, r.eoi_id
      INTO v_tenant, v_project, v_amount, v_currency, v_buyer, v_eoi
    FROM eoi_refund_requests r
    WHERE r.id = NEW.eoi_refund_request_id;

    IF v_tenant IS NULL OR v_tenant <> NEW.tenant_id OR v_project <> NEW.project_id
       OR v_amount <> NEW.amount OR v_currency <> NEW.currency
       OR v_buyer <> NEW.buyer_profile_id THEN
      RAISE EXCEPTION 'EOI refund settlement scope/amount mismatch';
    END IF;

    SELECT receipt.amount, receipt.currency
      INTO v_receipt_amount, v_receipt_currency
    FROM eoi_finance_events receipt
    WHERE receipt.eoi_id = v_eoi
      AND receipt.event_type = 'PAYMENT_RECEIVED'
      AND NOT EXISTS (
        SELECT 1 FROM eoi_finance_events reversal
        WHERE reversal.event_type = 'PAYMENT_REVERSED'
          AND reversal.related_event_id = receipt.id
      )
    ORDER BY receipt.occurred_at DESC, receipt.created_at DESC, receipt.id DESC
    LIMIT 1;

    IF v_receipt_amount IS NULL THEN
      RAISE EXCEPTION 'EOI refund settlement requires an active immutable deposit receipt';
    END IF;
    IF v_receipt_currency <> NEW.currency OR NEW.amount > v_receipt_amount THEN
      RAISE EXCEPTION 'EOI refund settlement does not reconcile to immutable deposit receipt';
    END IF;
  ELSE
    SELECT c.tenant_id, c.project_id, c.commission_amount, p.currency, c.broker_company_id
      INTO v_tenant, v_project, v_amount, v_currency, v_broker
    FROM broker_commission_cases c
    JOIN transactions t ON t.id = c.transaction_id
    JOIN reservations r ON r.id = t.reservation_id
    JOIN projects p ON p.id = c.project_id
    WHERE c.id = NEW.commission_case_id;

    IF v_tenant IS NULL OR v_tenant <> NEW.tenant_id OR v_project <> NEW.project_id
       OR v_amount <> NEW.amount OR v_currency <> NEW.currency
       OR v_broker <> NEW.broker_company_id THEN
      RAISE EXCEPTION 'commission settlement scope/amount mismatch';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- A read-only reconciliation surface makes the relationship between the two
-- subledgers explicit. Settlement owns external cash movement; EOI finance owns
-- deposit-liability release and retained revenue recognition.
CREATE OR REPLACE VIEW eoi_refund_financial_reconciliation AS
SELECT
  r.id AS refund_request_id,
  r.tenant_id,
  r.project_id,
  r.eoi_id,
  r.requested_amount,
  r.currency,
  s.id AS settlement_id,
  s.status AS settlement_status,
  COALESCE((
    SELECT sum(l.signed_amount)
    FROM eoi_finance_ledger_entries l
    JOIN eoi_finance_events f ON f.id = l.eoi_finance_event_id
    WHERE f.refund_request_id = r.id
      AND l.account = 'BUYER_REFUND_PAYABLE'
  ), 0)::numeric(18,2) AS eoi_refund_payable_balance,
  COALESCE((
    SELECT sum(l.signed_amount)
    FROM settlement_ledger_entries l
    WHERE l.settlement_id = s.id
      AND l.account_code = 'BUYER_REFUND_PAYABLE'
  ), 0)::numeric(18,2) AS settlement_refund_payable_movement,
  COALESCE((
    SELECT sum(l.signed_amount)
    FROM eoi_finance_ledger_entries l
    JOIN eoi_finance_events f ON f.id = l.eoi_finance_event_id
    WHERE f.eoi_id = r.eoi_id
      AND l.account = 'EOI_DEPOSIT_LIABILITY'
  ), 0)::numeric(18,2) AS eoi_deposit_liability_balance,
  COALESCE((
    SELECT sum(l.signed_amount)
    FROM eoi_finance_ledger_entries l
    JOIN eoi_finance_events f ON f.id = l.eoi_finance_event_id
    WHERE f.refund_request_id = r.id
      AND l.account = 'EOI_FEE_REVENUE'
  ), 0)::numeric(18,2) AS retained_revenue_balance
FROM eoi_refund_requests r
LEFT JOIN LATERAL (
  SELECT sd.*
  FROM settlement_disbursements sd
  WHERE sd.eoi_refund_request_id = r.id
  ORDER BY sd.initiated_at DESC, sd.id DESC
  LIMIT 1
) s ON true;

UPDATE platform_runtime_contract
SET schema_version = 39,
    minimum_runtime_version = 39,
    migration_marker = '0039_gate4_financial_integration',
    updated_at = now()
WHERE singleton_key = 'production';

COMMIT;
