\set ON_ERROR_STOP on

INSERT INTO users (id, display_name, status)
VALUES ('51515151-5151-4515-8515-515151515151', 'Gate 5 Sales User', 'ACTIVE');

INSERT INTO tenants (id, code, name, status, default_currency, default_timezone)
VALUES (
  'aaaaaaaa-5151-4515-8515-aaaaaaaaaaaa',
  'G5-SALES', 'Gate 5 Sales Tenant', 'ACTIVE', 'EGP', 'Africa/Cairo'
);

INSERT INTO projects (id, tenant_id, code, name, status, currency, timezone)
VALUES (
  'bbbbbbbb-5151-4515-8515-bbbbbbbbbbbb',
  'aaaaaaaa-5151-4515-8515-aaaaaaaaaaaa',
  'G5-SALES-PROJECT', 'Gate 5 Sales Project', 'ACTIVE', 'EGP', 'Africa/Cairo'
);

INSERT INTO tenant_memberships (tenant_id, user_id, status)
VALUES (
  'aaaaaaaa-5151-4515-8515-aaaaaaaaaaaa',
  '51515151-5151-4515-8515-515151515151',
  'ACTIVE'
);

INSERT INTO access_role_assignments (
  id, user_id, role_code, scope_type, tenant_id, project_id, status, granted_by
) VALUES (
  '51515151-aaaa-4515-8515-515151515151',
  '51515151-5151-4515-8515-515151515151',
  'SALES', 'PROJECT',
  'aaaaaaaa-5151-4515-8515-aaaaaaaaaaaa',
  'bbbbbbbb-5151-4515-8515-bbbbbbbbbbbb',
  'ACTIVE', '51515151-5151-4515-8515-515151515151'
);

INSERT INTO eoi_refund_policies (
  id, tenant_id, project_id, version_number, name, status,
  eoi_amount, currency,
  before_reservation_refund_percent,
  after_reservation_before_contract_refund_percent,
  after_contract_refund_percent,
  processing_fee,
  effective_at, published_at, created_by, published_by
) VALUES (
  'eeeeeeee-5151-4515-8515-eeeeeeeeeeee',
  'aaaaaaaa-5151-4515-8515-aaaaaaaaaaaa',
  'bbbbbbbb-5151-4515-8515-bbbbbbbbbbbb',
  1, 'Gate 5 Sales EOI', 'ACTIVE',
  25000, 'EGP', 100, 100, 0, 0,
  '2026-01-01T00:00:00+00', '2026-01-01T00:00:00+00',
  '51515151-5151-4515-8515-515151515151',
  '51515151-5151-4515-8515-515151515151'
);
