\set ON_ERROR_STOP on

-- Compatibility entry point for the retired direct-payout suite. Migration 0039
-- removed preneura_pay_eoi_refund: settlement evidence is now the only payout
-- authority. The canonical suite rejects direct PAID manufacture and certifies
-- balanced settlement/subledger postings, retained fees and reversals.
\ir gate4_finance_integration_certification.sql
