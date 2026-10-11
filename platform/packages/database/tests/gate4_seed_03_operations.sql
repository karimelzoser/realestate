\set ON_ERROR_STOP on

BEGIN;

INSERT INTO broker_commission_plans (
  id, tenant_id, project_id, broker_company_id, version_number, status,
  rate_percent, due_days_after_eligibility, effective_at, activated_at, created_by
) VALUES
  (
    '40000000-0000-0000-0000-000000001100',
    '40000000-0000-0000-0000-000000000100',
    '40000000-0000-0000-0000-000000000101',
    '40000000-0000-0000-0000-000000000102',
    1, 'ACTIVE', 4, 5,
    '2026-01-01T00:00:00+00', '2026-01-01T00:00:00+00',
    '40000000-0000-0000-0000-000000000001'
  ),
  (
    '40000000-0000-0000-0000-000000001101',
    '40000000-0000-0000-0000-000000000100',
    '40000000-0000-0000-0000-000000000101',
    '40000000-0000-0000-0000-000000000102',
    2, 'ACTIVE', 9, 30,
    '2026-02-01T00:00:00+00', '2026-02-01T00:00:00+00',
    '40000000-0000-0000-0000-000000000001'
  );

INSERT INTO payment_schedules (
  id, tenant_id, project_id, transaction_id, currency, total_contract_amount,
  status, created_by, activated_at
) VALUES (
  '40000000-0000-0000-0000-000000001200',
  '40000000-0000-0000-0000-000000000100',
  '40000000-0000-0000-0000-000000000101',
  '40000000-0000-0000-0000-000000001001',
  'EGP', 300, 'ACTIVE',
  '40000000-0000-0000-0000-000000000001', '2026-01-12T00:20:00+00'
);

INSERT INTO payment_schedule_items (
  id, payment_schedule_id, sequence_number, item_type, amount, due_at, status, updated_at
) VALUES (
  '40000000-0000-0000-0000-000000001201',
  '40000000-0000-0000-0000-000000001200',
  1, 'INSTALLMENT', 300, '2026-01-20T00:00:00+00', 'UPCOMING',
  '2026-01-12T00:20:00+00'
);

INSERT INTO project_milestone_reminder_policies (
  tenant_id, project_id, milestone_code, target_hours_after_open,
  reminder_hours_before, audience, channel, template_code, locale, enabled
) VALUES
  (
    '40000000-0000-0000-0000-000000000100',
    '40000000-0000-0000-0000-000000000101',
    'BUYER_DOCUMENTS_COMPLETE', 96, 24,
    'BUYER', 'IN_APP', 'gate4.milestone', 'en', true
  ),
  (
    '40000000-0000-0000-0000-000000000100',
    '40000000-0000-0000-0000-000000000101',
    'BUYER_DOCUMENTS_COMPLETE', 96, 24,
    'BROKER_AGENT', 'IN_APP', 'gate4.milestone', 'en', true
  );

INSERT INTO project_installment_reminder_policies (
  tenant_id, project_id, item_type, audience, channel,
  reminder_hours_before, template_code, locale, enabled
) VALUES
  (
    '40000000-0000-0000-0000-000000000100',
    '40000000-0000-0000-0000-000000000101',
    'INSTALLMENT', 'BUYER', 'IN_APP', 72,
    'gate4.installment', 'en', true
  ),
  (
    '40000000-0000-0000-0000-000000000100',
    '40000000-0000-0000-0000-000000000101',
    'INSTALLMENT', 'BROKER_AGENT', 'IN_APP', 72,
    'gate4.installment', 'en', true
  );

COMMIT;
