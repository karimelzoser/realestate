\set ON_ERROR_STOP on
-- Disposable schema47 evidence: an approved project transfer, followed by the
-- old generic-profile bypass. Migration48 must recover approved project state
-- without moving the existing commission or inventing unrecorded deal ownership.
DO $$ BEGIN
  IF(SELECT schema_version FROM platform_runtime_contract WHERE singleton_key='production')<>47 THEN
    RAISE EXCEPTION 'upgrade seed requires the exact disposable schema47 baseline'; END IF;
END $$;
\ir full_stack_acceptance_seed.sql
INSERT INTO users(id,display_name,status) VALUES('e0348000-4848-4484-8484-000000000001','Synthetic legacy target agent','ACTIVE');
INSERT INTO tenant_memberships(tenant_id,user_id,status) VALUES('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','e0348000-4848-4484-8484-000000000001','ACTIVE');
INSERT INTO broker_companies(id,tenant_id,code,name,status) VALUES('e0348000-4848-4484-8484-000000000002','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','LEGACY-TARGET','Synthetic legacy target brokerage','ACTIVE');
INSERT INTO brokerage_organizations(id,code,display_name_en,display_name_ar,status) VALUES('e0348000-4848-4484-8484-000000000003','LEGACY-TARGET','Synthetic legacy target brokerage','وساطة تجريبية','ACTIVE');
INSERT INTO brokerage_tenant_links(organization_id,tenant_id,broker_company_id,status) VALUES('e0348000-4848-4484-8484-000000000003','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','e0348000-4848-4484-8484-000000000002','ACTIVE');
INSERT INTO brokerage_agreements(id,organization_id,tenant_id,broker_company_id,version_number,agreement_code,status,effective_from,approved_at) VALUES('e0348000-4848-4484-8484-000000000004','e0348000-4848-4484-8484-000000000003','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','e0348000-4848-4484-8484-000000000002',1,'LEGACY-TARGET','ACTIVE',now()-interval '1 day',now());
INSERT INTO brokerage_agreement_projects(agreement_id,tenant_id,project_id,status,effective_from) VALUES('e0348000-4848-4484-8484-000000000004','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','ACTIVE',now()-interval '1 day');
INSERT INTO broker_project_access(broker_company_id,tenant_id,project_id,status,effective_from) VALUES('e0348000-4848-4484-8484-000000000002','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','ACTIVE',now()-interval '1 day');
INSERT INTO access_role_assignments(user_id,role_code,scope_type,tenant_id,broker_company_id,status) VALUES('e0348000-4848-4484-8484-000000000001','BROKER_AGENT','BROKER_COMPANY','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','e0348000-4848-4484-8484-000000000002','ACTIVE');
INSERT INTO brokerage_attribution_transfers(id,tenant_id,project_id,buyer_profile_id,from_broker_company_id,from_broker_agent_user_id,to_broker_company_id,to_broker_agent_user_id,reason,requested_by)
VALUES('e0348000-4848-4484-8484-000000000005','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','10000000-0000-4000-8000-000000000001','33000000-0000-4000-8000-000000000001','32000000-0000-4000-8000-000000000002','e0348000-4848-4484-8484-000000000002','e0348000-4848-4484-8484-000000000001','Synthetic legacy approved transfer','31000000-0000-4000-8000-000000000001');
SELECT preneura_approve_brokerage_attribution_transfer('e0348000-4848-4484-8484-000000000005','31000000-0000-4000-8000-000000000001','Legacy reviewed decision');
UPDATE buyer_profiles SET source='DIRECT',broker_company_id=NULL,broker_agent_user_id=NULL WHERE id='10000000-0000-4000-8000-000000000001';
CREATE TABLE certification_legacy_attribution_evidence AS SELECT id,encode(digest(convert_to(to_jsonb(history)::text,'UTF8'),'sha256'),'hex') AS sha FROM brokerage_attribution_history history;
