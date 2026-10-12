-- Internal project manager plus broker users.
INSERT INTO users (id, display_name, status) VALUES
  ('31000000-0000-4000-8000-000000000001', 'Acceptance Manager', 'ACTIVE'),
  ('32000000-0000-4000-8000-000000000001', 'Acceptance Broker Manager', 'ACTIVE'),
  ('32000000-0000-4000-8000-000000000002', 'Acceptance Broker Agent', 'ACTIVE');

INSERT INTO tenant_memberships (tenant_id, user_id, status) VALUES
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '31000000-0000-4000-8000-000000000001', 'ACTIVE'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '32000000-0000-4000-8000-000000000001', 'ACTIVE'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '32000000-0000-4000-8000-000000000002', 'ACTIVE');

INSERT INTO broker_companies (id, tenant_id, code, name, status)
VALUES (
  '33000000-0000-4000-8000-000000000001',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'ACCEPT-BROKER', 'Acceptance Brokerage', 'ACTIVE'
);

INSERT INTO broker_project_access (
  broker_company_id, tenant_id, project_id, status, effective_from
) VALUES (
  '33000000-0000-4000-8000-000000000001',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  'ACTIVE', '2025-01-01T00:00:00+00'
);

INSERT INTO access_role_assignments (
  id, user_id, role_code, scope_type, tenant_id, project_id, broker_company_id,
  status, granted_by
) VALUES
  (
    '31000000-1000-4000-8000-000000000001',
    '31000000-0000-4000-8000-000000000001',
    'MANAGER', 'PROJECT',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', NULL,
    'ACTIVE', '31000000-0000-4000-8000-000000000001'
  ),
  (
    '32000000-1000-4000-8000-000000000001',
    '32000000-0000-4000-8000-000000000001',
    'BROKER_MANAGER', 'BROKER_COMPANY',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', NULL,
    '33000000-0000-4000-8000-000000000001',
    'ACTIVE', '31000000-0000-4000-8000-000000000001'
  ),
  (
    '32000000-1000-4000-8000-000000000002',
    '32000000-0000-4000-8000-000000000002',
    'BROKER_AGENT', 'BROKER_COMPANY',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', NULL,
    '33000000-0000-4000-8000-000000000001',
    'ACTIVE', '32000000-0000-4000-8000-000000000001'
  );

INSERT INTO broker_commission_plans (
  id, tenant_id, project_id, broker_company_id, version_number, status,
  rate_percent, due_days_after_eligibility, effective_at, activated_at,
  created_by, created_at, updated_at
) VALUES (
  '34000000-0000-4000-8000-000000000001',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  '33000000-0000-4000-8000-000000000001',
  1, 'ACTIVE', 5, 30,
  '2025-01-01T00:00:00+00', '2025-01-01T00:00:00+00',
  '31000000-0000-4000-8000-000000000001', now(), now()
);


-- Explicit active B2B agreement for the synthetic brokerage.
INSERT INTO brokerage_organizations(id,code,display_name_en,display_name_ar,status) VALUES('35000000-0000-4000-8000-000000000001','ACCEPT-BROKER','Acceptance Brokerage','وساطة الاختبار','ACTIVE');
INSERT INTO brokerage_tenant_links(organization_id,tenant_id,broker_company_id,status) VALUES('35000000-0000-4000-8000-000000000001','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','33000000-0000-4000-8000-000000000001','ACTIVE');
INSERT INTO brokerage_agreements(id,organization_id,tenant_id,broker_company_id,version_number,agreement_code,status,effective_from,approved_at) VALUES('35000000-0000-4000-8000-000000000002','35000000-0000-4000-8000-000000000001','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','33000000-0000-4000-8000-000000000001',1,'ACCEPT-AGREEMENT','ACTIVE','2025-01-01',now());
INSERT INTO brokerage_agreement_projects(agreement_id,tenant_id,project_id,status,effective_from) VALUES('35000000-0000-4000-8000-000000000002','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','ACTIVE','2025-01-01');
