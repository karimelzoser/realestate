\set ON_ERROR_STOP on

BEGIN;

DO $$
DECLARE
  runtime_version integer;
BEGIN
  SELECT schema_version
    INTO runtime_version
  FROM platform_runtime_contract
  WHERE singleton_key = 'production';

  IF runtime_version IS NULL OR runtime_version < 44 THEN
    RAISE EXCEPTION 'developer onboarding requires runtime schema version >= 44, found %', runtime_version;
  END IF;
END $$;

INSERT INTO users (id, display_name, status)
VALUES
  ('11111111-1111-4111-8111-111111111111', 'Onboarding Admin', 'ACTIVE'),
  ('22222222-2222-4222-8222-222222222222', 'Operations Director', 'PENDING');

INSERT INTO tenants (id, code, name, status, default_currency, default_timezone)
VALUES
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'DEV_A', 'Developer A', 'ACTIVE', 'EGP', 'Africa/Cairo'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'DEV_B', 'Developer B', 'ACTIVE', 'EGP', 'Africa/Cairo');

INSERT INTO tenant_memberships (tenant_id, user_id, status)
VALUES
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '22222222-2222-4222-8222-222222222222', 'INVITED');

INSERT INTO access_role_assignments (
  user_id, role_code, scope_type, tenant_id, project_id, broker_company_id, status, granted_by
) VALUES (
  '22222222-2222-4222-8222-222222222222',
  'OPERATIONS_DIRECTOR',
  'TENANT',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  NULL,
  NULL,
  'ACTIVE',
  '11111111-1111-4111-8111-111111111111'
);

INSERT INTO projects (id, tenant_id, code, name, status, currency, timezone)
VALUES (
  'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'PROJECT_A',
  'Project A',
  'DRAFT',
  'EGP',
  'Africa/Cairo'
);

INSERT INTO developer_tenant_branding (
  tenant_id, display_name_en, display_name_ar, primary_color, updated_by
) VALUES (
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'Developer A',
  'المطور أ',
  '#112233',
  '11111111-1111-4111-8111-111111111111'
);

INSERT INTO developer_project_branding (
  project_id, tenant_id, display_name_en, display_name_ar, updated_by
) VALUES (
  'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'Project A',
  'المشروع أ',
  '11111111-1111-4111-8111-111111111111'
);

DO $$
BEGIN
  BEGIN
    INSERT INTO developer_project_branding (
      project_id, tenant_id, display_name_en, display_name_ar
    ) VALUES (
      'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      'Wrong Scope',
      'نطاق خاطئ'
    )
    ON CONFLICT (project_id) DO UPDATE
      SET tenant_id = EXCLUDED.tenant_id;
    RAISE EXCEPTION 'cross-tenant project branding unexpectedly succeeded';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'cross-tenant project branding unexpectedly succeeded' THEN
      RAISE;
    END IF;
    IF position('project branding tenant/project scope mismatch' IN SQLERRM) = 0 THEN
      RAISE;
    END IF;
  END;
END $$;

INSERT INTO developer_onboarding_events (
  tenant_id, actor_user_id, event_type, metadata
) VALUES (
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  '11111111-1111-4111-8111-111111111111',
  'TENANT_BRANDING_UPDATED',
  '{"source":"certification"}'::jsonb
);

DO $$
DECLARE
  event_id uuid;
BEGIN
  SELECT id INTO event_id
  FROM developer_onboarding_events
  WHERE tenant_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  ORDER BY created_at DESC, id DESC
  LIMIT 1;

  BEGIN
    UPDATE developer_onboarding_events
    SET metadata = '{"tampered":true}'::jsonb
    WHERE id = event_id;
    RAISE EXCEPTION 'onboarding audit mutation unexpectedly succeeded';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'onboarding audit mutation unexpectedly succeeded' THEN
      RAISE;
    END IF;
    IF position('developer onboarding events are append-only' IN SQLERRM) = 0 THEN
      RAISE;
    END IF;
  END;
END $$;

DO $$
DECLARE
  ops_count integer;
  project_count integer;
  unbranded_count integer;
BEGIN
  SELECT count(DISTINCT a.user_id)::integer
  INTO ops_count
  FROM access_role_assignments a
  JOIN tenant_memberships m ON m.tenant_id = a.tenant_id AND m.user_id = a.user_id
  WHERE a.tenant_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    AND a.role_code = 'OPERATIONS_DIRECTOR'
    AND a.scope_type = 'TENANT'
    AND a.status = 'ACTIVE'
    AND a.revoked_at IS NULL
    AND m.status IN ('ACTIVE','INVITED');

  SELECT count(*)::integer INTO project_count
  FROM projects
  WHERE tenant_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    AND status <> 'ARCHIVED';

  SELECT count(*)::integer INTO unbranded_count
  FROM projects p
  LEFT JOIN developer_project_branding b ON b.project_id = p.id
  WHERE p.tenant_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    AND p.status <> 'ARCHIVED'
    AND b.project_id IS NULL;

  IF ops_count <> 1 OR project_count <> 1 OR unbranded_count <> 0 THEN
    RAISE EXCEPTION 'onboarding readiness facts are inconsistent: ops %, projects %, unbranded %',
      ops_count, project_count, unbranded_count;
  END IF;
END $$;

ROLLBACK;

\echo 'E03.1 developer onboarding database certification passed.'
