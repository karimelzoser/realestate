BEGIN;

DO $$
DECLARE
  admin_user uuid := gen_random_uuid();
  agent_a uuid := gen_random_uuid();
  agent_b uuid := gen_random_uuid();
  buyer_user uuid := gen_random_uuid();
  tenant_a uuid := gen_random_uuid();
  tenant_b uuid := gen_random_uuid();
  project_a uuid := gen_random_uuid();
  project_b uuid := gen_random_uuid();
  company_a uuid := gen_random_uuid();
  company_b uuid := gen_random_uuid();
  company_target uuid := gen_random_uuid();
  organization uuid := gen_random_uuid();
  target_organization uuid := gen_random_uuid();
  agreement_a uuid := gen_random_uuid();
  agreement_b uuid := gen_random_uuid();
  agreement_target uuid := gen_random_uuid();
  buyer_profile uuid := gen_random_uuid();
  v_transfer_id uuid := gen_random_uuid();
  v_stale_transfer_id uuid := gen_random_uuid();
  row_count integer;
BEGIN
  INSERT INTO users (id, display_name, status) VALUES
    (admin_user, 'E03 Admin', 'ACTIVE'),
    (agent_a, 'E03 Agent A', 'ACTIVE'),
    (agent_b, 'E03 Agent B', 'ACTIVE'),
    (buyer_user, 'E03 Buyer', 'ACTIVE');

  INSERT INTO tenants (id, code, name, status) VALUES
    (tenant_a, 'E03_DEV_A_' || left(tenant_a::text, 6), 'E03 Developer A', 'ACTIVE'),
    (tenant_b, 'E03_DEV_B_' || left(tenant_b::text, 6), 'E03 Developer B', 'ACTIVE');

  INSERT INTO projects (id, tenant_id, code, name, status) VALUES
    (project_a, tenant_a, 'A1', 'Developer A Project', 'ACTIVE'),
    (project_b, tenant_b, 'B1', 'Developer B Project', 'ACTIVE');

  INSERT INTO broker_companies (id, tenant_id, code, name, status) VALUES
    (company_a, tenant_a, 'GLOBAL_A', 'Global Brokerage', 'ACTIVE'),
    (company_b, tenant_b, 'GLOBAL_B', 'Global Brokerage', 'ACTIVE'),
    (company_target, tenant_a, 'TARGET_A', 'Target Brokerage', 'ACTIVE');

  INSERT INTO brokerage_organizations (
    id, code, display_name_en, display_name_ar, legal_name, status, created_by
  ) VALUES
    (organization, 'E03_GLOBAL_' || upper(left(replace(organization::text, '-', ''), 8)), 'Global Brokerage', 'جلوبال للوساطة', 'Global Brokerage LLC', 'ACTIVE', admin_user),
    (target_organization, 'E03_TARGET_' || upper(left(replace(target_organization::text, '-', ''), 8)), 'Target Brokerage', 'تارجت للوساطة', 'Target Brokerage LLC', 'ACTIVE', admin_user);

  INSERT INTO brokerage_tenant_links (
    organization_id, tenant_id, broker_company_id, status, linked_by
  ) VALUES
    (organization, tenant_a, company_a, 'ACTIVE', admin_user),
    (organization, tenant_b, company_b, 'ACTIVE', admin_user),
    (target_organization, tenant_a, company_target, 'ACTIVE', admin_user);

  SELECT count(*) INTO row_count
  FROM brokerage_tenant_links
  WHERE organization_id = organization AND status = 'ACTIVE';
  IF row_count <> 2 THEN
    RAISE EXCEPTION 'one global brokerage must link to two developer tenants';
  END IF;

  INSERT INTO brokerage_agreements (
    id, organization_id, tenant_id, broker_company_id, version_number, agreement_code,
    status, effective_from, commercial_terms, created_by, approved_by, approved_at
  ) VALUES
    (agreement_a, organization, tenant_a, company_a, 1, 'E03-A', 'ACTIVE', now() - interval '1 day', '{}'::jsonb, admin_user, admin_user, now()),
    (agreement_b, organization, tenant_b, company_b, 1, 'E03-B', 'ACTIVE', now() - interval '1 day', '{}'::jsonb, admin_user, admin_user, now()),
    (agreement_target, target_organization, tenant_a, company_target, 1, 'E03-TARGET', 'ACTIVE', now() - interval '1 day', '{}'::jsonb, admin_user, admin_user, now());

  INSERT INTO brokerage_agreement_projects (
    agreement_id, tenant_id, project_id, status, effective_from, granted_by
  ) VALUES
    (agreement_a, tenant_a, project_a, 'ACTIVE', now() - interval '1 day', admin_user),
    (agreement_b, tenant_b, project_b, 'ACTIVE', now() - interval '1 day', admin_user),
    (agreement_target, tenant_a, project_a, 'ACTIVE', now() - interval '1 day', admin_user);

  INSERT INTO broker_project_access (
    broker_company_id, tenant_id, project_id, status, effective_from
  ) VALUES
    (company_a, tenant_a, project_a, 'ACTIVE', now() - interval '1 day'),
    (company_b, tenant_b, project_b, 'ACTIVE', now() - interval '1 day'),
    (company_target, tenant_a, project_a, 'ACTIVE', now() - interval '1 day');

  INSERT INTO access_role_assignments (
    user_id, role_code, scope_type, tenant_id, broker_company_id, status, granted_by
  ) VALUES
    (agent_a, 'BROKER_AGENT', 'BROKER_COMPANY', tenant_a, company_a, 'ACTIVE', admin_user),
    (agent_b, 'BROKER_AGENT', 'BROKER_COMPANY', tenant_a, company_target, 'ACTIVE', admin_user);

  INSERT INTO tenant_memberships (tenant_id, user_id, status) VALUES
    (tenant_a, buyer_user, 'ACTIVE');

  INSERT INTO buyer_profiles (
    id, tenant_id, user_id, status, source, broker_company_id, broker_agent_user_id, created_by
  ) VALUES (
    buyer_profile, tenant_a, buyer_user, 'ACTIVE', 'BROKER', company_a, agent_a, admin_user
  );

  INSERT INTO brokerage_attribution_history (
    tenant_id, buyer_profile_id, broker_company_id, broker_agent_user_id, event_type, actor_user_id
  ) VALUES (
    tenant_a, buyer_profile, company_a, agent_a, 'INITIAL', admin_user
  );

  INSERT INTO brokerage_attribution_transfers (
    id, tenant_id, project_id, buyer_profile_id,
    from_broker_company_id, from_broker_agent_user_id,
    to_broker_company_id, to_broker_agent_user_id,
    reason, requested_by
  ) VALUES (
    v_transfer_id, tenant_a, project_a, buyer_profile,
    company_a, agent_a, company_target, agent_b,
    'Buyer reassigned under approved B2B process', admin_user
  );

  PERFORM preneura_approve_brokerage_attribution_transfer(v_transfer_id, admin_user, 'Approved in certification');

  IF NOT EXISTS (
    SELECT 1 FROM buyer_profiles
    WHERE id = buyer_profile AND broker_company_id = company_target AND broker_agent_user_id = agent_b
  ) THEN
    RAISE EXCEPTION 'approved transfer did not update buyer attribution';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM brokerage_attribution_transfers
    WHERE id = v_transfer_id AND status = 'APPROVED' AND reviewed_by = admin_user AND reviewed_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'approved transfer did not retain review evidence';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM brokerage_attribution_history h
    WHERE h.transfer_id = v_transfer_id AND h.event_type = 'TRANSFER_APPROVED'
      AND h.broker_company_id = company_target AND h.broker_agent_user_id = agent_b
  ) THEN
    RAISE EXCEPTION 'approved transfer did not append attribution history';
  END IF;

  BEGIN
    UPDATE brokerage_attribution_history
    SET broker_agent_user_id = agent_a
    WHERE buyer_profile_id = buyer_profile;
    RAISE EXCEPTION 'attribution history unexpectedly mutable';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'attribution history unexpectedly mutable' THEN RAISE; END IF;
  END;

  INSERT INTO brokerage_attribution_transfers (
    id, tenant_id, project_id, buyer_profile_id,
    from_broker_company_id, from_broker_agent_user_id,
    to_broker_company_id, to_broker_agent_user_id,
    reason, requested_by
  ) VALUES (
    v_stale_transfer_id, tenant_a, project_a, buyer_profile,
    company_target, agent_b, company_a, agent_a,
    'Certification stale request', admin_user
  );

  UPDATE buyer_profiles SET broker_agent_user_id = NULL WHERE id = buyer_profile;
  BEGIN
    PERFORM preneura_approve_brokerage_attribution_transfer(v_stale_transfer_id, admin_user, NULL);
    RAISE EXCEPTION 'stale transfer unexpectedly approved';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'stale transfer unexpectedly approved' THEN RAISE; END IF;
    IF position('buyer attribution changed after transfer request' IN SQLERRM) = 0 THEN RAISE; END IF;
  END;

  IF NOT EXISTS (
    SELECT 1 FROM platform_runtime_contract
    WHERE singleton_key = 'production'
      AND schema_version >= 45
      AND (schema_version > 45 OR migration_marker = '0045_brokerage_b2b_onboarding')
  ) THEN
    RAISE EXCEPTION 'runtime schema contract did not advance to E03.2';
  END IF;
END;
$$;

ROLLBACK;
