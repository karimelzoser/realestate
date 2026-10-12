\set ON_ERROR_STOP on
-- Run only as the owner of the new realestate_os database after migrations.
-- Password values are supplied over a private script/input channel, not GitHub.
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM pg_proc routine JOIN pg_namespace scope ON scope.oid=routine.pronamespace WHERE scope.nspname='public' AND routine.prosecdef) THEN
    RAISE EXCEPTION 'Definer functions require an explicit service privilege review before runtime grants';
  END IF;
END $$;
SELECT format('CREATE ROLE realestate_os_worker LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD %L', :'worker_password')
WHERE NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='realestate_os_worker') \gexec
SELECT format('CREATE ROLE realestate_os_gateway LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD %L', :'gateway_password')
WHERE NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='realestate_os_gateway') \gexec
GRANT CONNECT ON DATABASE realestate_os TO realestate_os_worker,realestate_os_gateway;
GRANT USAGE ON SCHEMA public TO realestate_os_worker,realestate_os_gateway;

-- No auth-session, MFA, challenge or identity evidence is available to workers.
SELECT format('GRANT SELECT ON TABLE public.%I TO realestate_os_worker',tablename)
FROM pg_tables WHERE schemaname='public' AND tablename NOT LIKE 'auth\_%' ESCAPE '\'
AND tablename NOT ILIKE '%identity%' \gexec
GRANT INSERT,UPDATE ON inventory_locks,inventory_slots,queue_entries,domain_outbox_events,realtime_events,
  notification_jobs,notification_delivery_attempts,user_notifications,broker_commission_cases TO realestate_os_worker;
GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO realestate_os_worker;

GRANT SELECT ON auth_delivery_contacts,notification_gateway_deliveries TO realestate_os_gateway;
GRANT INSERT,UPDATE ON notification_gateway_deliveries TO realestate_os_gateway;
-- Invoker functions retain the caller's table restrictions. A future migration
-- adding a definer function must review explicit service grants before rollout.
