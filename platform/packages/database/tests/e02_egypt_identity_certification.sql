\set ON_ERROR_STOP on

BEGIN;

INSERT INTO users (id, display_name, status) VALUES
  ('e0200000-0000-4000-8000-000000000001', 'E02 User One', 'ACTIVE'),
  ('e0200000-0000-4000-8000-000000000002', 'E02 User Two', 'ACTIVE'),
  ('e0200000-0000-4000-8000-000000000003', 'E02 User Three', 'ACTIVE');

INSERT INTO tenants (id, code, name, status) VALUES
  ('e0200000-0000-4000-8000-000000000101', 'E02-T1', 'E02 Tenant One', 'ACTIVE'),
  ('e0200000-0000-4000-8000-000000000102', 'E02-T2', 'E02 Tenant Two', 'ACTIVE');

INSERT INTO tenant_memberships (tenant_id, user_id, status) VALUES
  ('e0200000-0000-4000-8000-000000000101', 'e0200000-0000-4000-8000-000000000001', 'ACTIVE'),
  ('e0200000-0000-4000-8000-000000000101', 'e0200000-0000-4000-8000-000000000003', 'ACTIVE'),
  ('e0200000-0000-4000-8000-000000000102', 'e0200000-0000-4000-8000-000000000002', 'ACTIVE');

INSERT INTO auth_delivery_contacts
  (id, user_id, kind, value_ciphertext, value_hmac, verified_at, is_primary, display_hint)
VALUES
  ('e0200000-0000-4000-8000-000000000201', 'e0200000-0000-4000-8000-000000000001', 'PHONE', decode('01','hex'), digest('phone-1','sha256'), now(), true, '+20••••0001'),
  ('e0200000-0000-4000-8000-000000000202', 'e0200000-0000-4000-8000-000000000002', 'PHONE', decode('02','hex'), digest('phone-2','sha256'), now(), true, '+20••••0002');

INSERT INTO identity_profiles
  (tenant_id, user_id, document_kind, document_country_code, document_hmac, document_display_hint, status)
VALUES
  ('e0200000-0000-4000-8000-000000000101', 'e0200000-0000-4000-8000-000000000001', 'NATIONAL_ID', 'EG', digest('30101011234567','sha256'), '••••••••••4567', 'DECLARED'),
  ('e0200000-0000-4000-8000-000000000102', 'e0200000-0000-4000-8000-000000000002', 'NATIONAL_ID', 'EG', digest('30101011234567','sha256'), '••••••••••4567', 'DECLARED');

DO $$
BEGIN
  BEGIN
    INSERT INTO identity_profiles
      (tenant_id, user_id, document_kind, document_country_code, document_hmac, document_display_hint, status)
    VALUES
      ('e0200000-0000-4000-8000-000000000101', 'e0200000-0000-4000-8000-000000000003', 'NATIONAL_ID', 'EG', digest('30101011234567','sha256'), '••••••••••4567', 'DECLARED');
    RAISE EXCEPTION 'same-tenant duplicate identity was accepted';
  EXCEPTION
    WHEN unique_violation THEN NULL;
  END;
END;
$$;

INSERT INTO identity_consent_events
  (tenant_id, user_id, purpose, action, policy_version, actor_user_id, source)
VALUES
  ('e0200000-0000-4000-8000-000000000101', 'e0200000-0000-4000-8000-000000000001', 'ACCOUNT_RECOVERY', 'GRANTED', '2026-10', 'e0200000-0000-4000-8000-000000000001', 'SELF_SERVICE');

INSERT INTO identity_verification_events
  (tenant_id, user_id, assertion_type, document_kind, actor_user_id, evidence_source)
VALUES
  ('e0200000-0000-4000-8000-000000000101', 'e0200000-0000-4000-8000-000000000001', 'DOCUMENT_DECLARED', 'NATIONAL_ID', 'e0200000-0000-4000-8000-000000000001', 'SELF_SERVICE');

DO $$
BEGIN
  BEGIN
    UPDATE identity_consent_events SET policy_version = 'tampered' WHERE tenant_id = 'e0200000-0000-4000-8000-000000000101';
    RAISE EXCEPTION 'consent evidence was mutable';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM <> 'identity evidence is append-only' THEN RAISE; END IF;
  END;

  BEGIN
    DELETE FROM identity_verification_events WHERE tenant_id = 'e0200000-0000-4000-8000-000000000101';
    RAISE EXCEPTION 'verification evidence was deletable';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM <> 'identity evidence is append-only' THEN RAISE; END IF;
  END;
END;
$$;

INSERT INTO identity_recovery_challenges
  (id, tenant_id, user_id, contact_id, requested_document_kind, requested_document_hmac,
   channel, code_digest, attempts_remaining, expires_at)
VALUES
  ('e0200000-0000-4000-8000-000000000301', 'e0200000-0000-4000-8000-000000000101', NULL, NULL,
   'NATIONAL_ID', digest('unknown-id','sha256'), 'SMS', digest('dummy-code','sha256'), 5, now() + interval '5 minutes');

DO $$
DECLARE
  dummy_count integer;
  cross_tenant_count integer;
BEGIN
  SELECT count(*) INTO dummy_count
  FROM identity_recovery_challenges
  WHERE id = 'e0200000-0000-4000-8000-000000000301'
    AND user_id IS NULL AND contact_id IS NULL;
  IF dummy_count <> 1 THEN RAISE EXCEPTION 'dummy recovery challenge was not preserved'; END IF;

  SELECT count(*) INTO cross_tenant_count
  FROM identity_profiles
  WHERE document_kind = 'NATIONAL_ID'
    AND document_hmac = digest('30101011234567','sha256');
  IF cross_tenant_count <> 2 THEN RAISE EXCEPTION 'cross-tenant identity isolation failed'; END IF;
END;
$$;

ROLLBACK;

\echo 'E02.2 Egypt identity database certification passed.'
