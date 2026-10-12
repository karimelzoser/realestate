\set ON_ERROR_STOP on
DO $$ BEGIN
  IF NOT EXISTS(
    SELECT 1 FROM platform_runtime_contract runtime
    JOIN LATERAL (SELECT version,filename FROM platform_schema_migrations ORDER BY version DESC LIMIT 1) latest ON true
    WHERE runtime.singleton_key='production' AND latest.version>=48
      AND runtime.schema_version=latest.version AND runtime.minimum_runtime_version=latest.version
      AND runtime.migration_marker=regexp_replace(latest.filename,'\.sql$','')
  ) THEN RAISE EXCEPTION 'upgrade runtime contract does not match the applied migration ledger'; END IF;
  IF NOT EXISTS(SELECT 1 FROM buyer_project_attributions WHERE buyer_profile_id='10000000-0000-4000-8000-000000000001' AND project_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' AND source='BROKER' AND broker_company_id='e0348000-4848-4484-8484-000000000002') THEN RAISE EXCEPTION 'approved project ownership was not recovered'; END IF;
  IF NOT EXISTS(SELECT 1 FROM reservations WHERE id='10000000-0000-4000-8000-000000000051' AND buyer_source_snapshot='BROKER' AND broker_company_id_snapshot='33000000-0000-4000-8000-000000000001' AND broker_agent_user_id_snapshot='32000000-0000-4000-8000-000000000002') THEN RAISE EXCEPTION 'existing recorded commission ownership was moved'; END IF;
  IF NOT EXISTS(SELECT 1 FROM reservations WHERE id='20000000-0000-4000-8000-000000000052' AND buyer_source_snapshot IS NULL AND broker_company_id_snapshot IS NULL AND broker_agent_user_id_snapshot IS NULL) THEN RAISE EXCEPTION 'unrecorded legacy attribution was guessed'; END IF;
  IF EXISTS(SELECT 1 FROM certification_legacy_attribution_evidence evidence JOIN brokerage_attribution_history history ON history.id=evidence.id
    WHERE evidence.sha<>encode(digest(convert_to((to_jsonb(history)-ARRAY['project_id','previous_source','previous_broker_company_id','previous_broker_agent_user_id','previous_revision','new_revision','projection_transaction_id'])::text,'UTF8'),'sha256'),'hex')) THEN RAISE EXCEPTION 'legacy attribution history was modified'; END IF;
END $$;
\echo E03_ATTRIBUTION_UPGRADE_CERTIFICATION_OK
