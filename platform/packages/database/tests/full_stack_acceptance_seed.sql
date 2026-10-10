\set ON_ERROR_STOP on

-- Reuse the certified buyer/property commercial graph, then add only the
-- identities and runtime probes required for full-stack acceptance.
\ir gate5_buyer_property_fixture.sql

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

-- Attribute Buyer A to the broker agent for scoped broker tests.
UPDATE buyer_profiles
SET source = 'BROKER',
    broker_company_id = '33000000-0000-4000-8000-000000000001',
    broker_agent_user_id = '32000000-0000-4000-8000-000000000002',
    updated_at = now()
WHERE id = '10000000-0000-4000-8000-000000000001';

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

-- A second tenant/project exists only to prove isolation.
INSERT INTO tenants (id, code, name, status, default_currency, default_timezone)
VALUES (
  '41000000-0000-4000-8000-000000000001',
  'ACCEPT-OTHER', 'Acceptance Other Tenant', 'ACTIVE', 'EGP', 'Africa/Cairo'
);
INSERT INTO projects (id, tenant_id, code, name, status, currency, timezone)
VALUES (
  '42000000-0000-4000-8000-000000000001',
  '41000000-0000-4000-8000-000000000001',
  'OTHER-PROJECT', 'Acceptance Other Project', 'ACTIVE', 'EGP', 'Africa/Cairo'
);

-- Browser session tokens are known only to this disposable acceptance fixture.
-- PostgreSQL stores exactly what production stores: SHA-256 token digests.
INSERT INTO auth_sessions (id, user_id, token_digest, expires_at) VALUES
  (
    '51000000-0000-4000-8000-000000000001',
    '11111111-1111-4111-8111-111111111111',
    digest('acceptance-buyer-token-0000000000000001', 'sha256'),
    now() + interval '2 hours'
  ),
  (
    '51000000-0000-4000-8000-000000000002',
    '31000000-0000-4000-8000-000000000001',
    digest('acceptance-manager-token-00000000000001', 'sha256'),
    now() + interval '2 hours'
  ),
  (
    '51000000-0000-4000-8000-000000000003',
    '32000000-0000-4000-8000-000000000001',
    digest('acceptance-broker-manager-token-000001', 'sha256'),
    now() + interval '2 hours'
  ),
  (
    '51000000-0000-4000-8000-000000000004',
    '32000000-0000-4000-8000-000000000002',
    digest('acceptance-broker-agent-token-0000001', 'sha256'),
    now() + interval '2 hours'
  );

-- Runtime worker probes: one outbox event, one in-app notification and one
-- expired lock that must be reclaimed by the emitted production worker.
INSERT INTO domain_outbox_events (
  id, tenant_id, project_id, aggregate_type, aggregate_id, event_type, payload, occurred_at
) VALUES (
  '61000000-0000-4000-8000-000000000001',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  'TRANSACTION', '10000000-0000-4000-8000-000000000061',
  'acceptance.transaction.changed', '{"source":"full-stack-acceptance"}'::jsonb, now()
);

INSERT INTO notification_jobs (
  id, tenant_id, project_id, transaction_id, recipient_user_id,
  audience, channel, template_code, locale, payload, scheduled_for,
  status, idempotency_key, attempts
) VALUES (
  '62000000-0000-4000-8000-000000000001',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  '10000000-0000-4000-8000-000000000061',
  '11111111-1111-4111-8111-111111111111',
  'BUYER', 'IN_APP', 'acceptance.in_app', 'en-US',
  '{"message":"Full-stack acceptance notification"}'::jsonb,
  now() - interval '1 minute', 'PENDING', 'full-stack-acceptance-notification-1', 0
);

INSERT INTO inventory_slots (
  id, tenant_id, project_id, unit_type_id, state, internal_reference
) VALUES (
  '63000000-0000-4000-8000-000000000001',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  'AVAILABLE', 'ACCEPTANCE-EXPIRED-SLOT'
);

INSERT INTO inventory_locks (
  id, tenant_id, project_id, unit_type_id, inventory_slot_id, buyer_user_id,
  locked_by_user_id, status, expires_at, created_at, updated_at
) VALUES (
  '64000000-0000-4000-8000-000000000001',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  '63000000-0000-4000-8000-000000000001',
  '11111111-1111-4111-8111-111111111111',
  '31000000-0000-4000-8000-000000000001',
  'ACTIVE', now() - interval '5 minutes', now() - interval '10 minutes', now() - interval '10 minutes'
);
