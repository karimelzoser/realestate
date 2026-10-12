\set ON_ERROR_STOP on

BEGIN;

INSERT INTO users (id, display_name, status)
VALUES
  ('e0100000-0000-4000-8000-000000000001', 'E01 Assurance User', 'ACTIVE'),
  ('e0100000-0000-4000-8000-000000000004', 'E01 Other User', 'ACTIVE');

INSERT INTO auth_sessions (id, user_id, token_digest, expires_at)
VALUES (
  'e0100000-0000-4000-8000-000000000002',
  'e0100000-0000-4000-8000-000000000001',
  digest('e01-assurance-token-aal2', 'sha256'),
  now() + interval '1 hour'
);

DO $$
BEGIN
  BEGIN
    INSERT INTO auth_session_assurance (
      session_id, auth_method, assurance_level, provider_acr, provider_amr
    ) VALUES (
      'e0100000-0000-4000-8000-000000000002',
      'OTP', 'AAL2', NULL, '[]'::jsonb
    );
    RAISE EXCEPTION 'OTP/AAL2 row was incorrectly accepted';
  EXCEPTION
    WHEN check_violation THEN
      NULL;
  END;
END $$;

INSERT INTO auth_session_assurance (
  session_id, auth_method, assurance_level, provider_acr, provider_amr
) VALUES (
  'e0100000-0000-4000-8000-000000000002',
  'OIDC_GOOGLE', 'AAL2', 'urn:preneura:aal2', '["mfa"]'::jsonb
);

DO $$
DECLARE
  accepted boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM auth_session_assurance
    WHERE session_id = 'e0100000-0000-4000-8000-000000000002'
      AND assurance_level = 'AAL2'
      AND auth_method = 'OIDC_GOOGLE'
  ) INTO accepted;
  IF NOT accepted THEN
    RAISE EXCEPTION 'OIDC AAL2 evidence was not persisted';
  END IF;
END $$;

INSERT INTO auth_external_identities (
  user_id, provider, provider_subject, email_at_link_time
) VALUES (
  'e0100000-0000-4000-8000-000000000001',
  'google', 'google-subject-primary', 'primary@example.invalid'
);

DO $$
BEGIN
  BEGIN
    INSERT INTO auth_external_identities (
      user_id, provider, provider_subject, email_at_link_time
    ) VALUES (
      'e0100000-0000-4000-8000-000000000001',
      'google', 'google-subject-competing', 'competing@example.invalid'
    );
    RAISE EXCEPTION 'One PRENEURA account acquired two Google subjects';
  EXCEPTION
    WHEN unique_violation THEN
      NULL;
  END;

  BEGIN
    INSERT INTO auth_external_identities (
      user_id, provider, provider_subject, email_at_link_time
    ) VALUES (
      'e0100000-0000-4000-8000-000000000004',
      'google', 'google-subject-primary', 'reuse@example.invalid'
    );
    RAISE EXCEPTION 'One Google subject was linked to two PRENEURA accounts';
  EXCEPTION
    WHEN unique_violation THEN
      NULL;
  END;
END $$;

ROLLBACK;

\echo E01_PRIVILEGED_ASSURANCE_DB_OK
