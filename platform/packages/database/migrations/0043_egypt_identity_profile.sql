BEGIN;

CREATE TABLE IF NOT EXISTS identity_profiles (
  tenant_id uuid NOT NULL,
  user_id uuid NOT NULL,
  document_kind text NOT NULL CHECK (document_kind IN ('NATIONAL_ID','PASSPORT')),
  document_country_code char(2) NOT NULL,
  document_hmac bytea NOT NULL,
  document_display_hint text NOT NULL,
  status text NOT NULL DEFAULT 'DECLARED' CHECK (status IN ('DECLARED','REVIEWED','EXTERNAL_VERIFIED','REJECTED')),
  declared_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz,
  verified_at timestamptz,
  reviewed_by uuid REFERENCES users(id) ON DELETE SET NULL,
  verification_provider text,
  verification_reference_hmac bytea,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, user_id),
  FOREIGN KEY (tenant_id, user_id)
    REFERENCES tenant_memberships(tenant_id, user_id) ON DELETE CASCADE,
  CHECK (document_country_code = upper(document_country_code)),
  CHECK (document_kind <> 'NATIONAL_ID' OR document_country_code = 'EG'),
  CHECK ((status = 'DECLARED' AND reviewed_at IS NULL AND verified_at IS NULL)
      OR (status = 'REVIEWED' AND reviewed_at IS NOT NULL AND verified_at IS NULL)
      OR (status = 'EXTERNAL_VERIFIED' AND verified_at IS NOT NULL)
      OR (status = 'REJECTED' AND reviewed_at IS NOT NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS identity_profiles_tenant_document_unique
  ON identity_profiles(tenant_id, document_kind, document_hmac);

CREATE INDEX IF NOT EXISTS identity_profiles_user_status
  ON identity_profiles(user_id, status);

CREATE TABLE IF NOT EXISTS identity_consent_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  user_id uuid NOT NULL,
  purpose text NOT NULL CHECK (purpose IN ('IDENTITY_PROCESSING','ACCOUNT_RECOVERY')),
  action text NOT NULL CHECK (action IN ('GRANTED','REVOKED')),
  policy_version text NOT NULL,
  actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  source text NOT NULL DEFAULT 'SELF_SERVICE' CHECK (source IN ('SELF_SERVICE','TENANT_ADMIN','SYSTEM')),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, user_id)
    REFERENCES tenant_memberships(tenant_id, user_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS identity_consent_events_current
  ON identity_consent_events(tenant_id, user_id, purpose, created_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS identity_verification_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  user_id uuid NOT NULL,
  assertion_type text NOT NULL CHECK (assertion_type IN (
    'PHONE_POSSESSION_VERIFIED',
    'DOCUMENT_DECLARED',
    'DOCUMENT_REVIEWED',
    'DOCUMENT_EXTERNAL_VERIFIED',
    'DOCUMENT_REJECTED',
    'RECOVERY_CHALLENGE_CREATED',
    'RECOVERY_CHALLENGE_VERIFIED',
    'RECOVERY_CHALLENGE_REJECTED'
  )),
  document_kind text CHECK (document_kind IN ('NATIONAL_ID','PASSPORT')),
  actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  evidence_source text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, user_id)
    REFERENCES tenant_memberships(tenant_id, user_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS identity_verification_events_user_time
  ON identity_verification_events(tenant_id, user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS identity_recovery_challenges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  contact_id uuid REFERENCES auth_delivery_contacts(id) ON DELETE SET NULL,
  requested_document_kind text NOT NULL CHECK (requested_document_kind IN ('NATIONAL_ID','PASSPORT')),
  requested_document_hmac bytea NOT NULL,
  channel text NOT NULL CHECK (channel IN ('SMS','WHATSAPP')),
  code_digest bytea NOT NULL,
  attempts_remaining smallint NOT NULL DEFAULT 5 CHECK (attempts_remaining BETWEEN 0 AND 20),
  expires_at timestamptz NOT NULL,
  sent_at timestamptz,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (expires_at > created_at),
  CHECK ((user_id IS NULL AND contact_id IS NULL) OR user_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS identity_recovery_challenges_lookup
  ON identity_recovery_challenges(tenant_id, requested_document_kind, requested_document_hmac, created_at DESC);

CREATE INDEX IF NOT EXISTS identity_recovery_challenges_expiry
  ON identity_recovery_challenges(expires_at)
  WHERE consumed_at IS NULL;

CREATE OR REPLACE FUNCTION preneura_identity_evidence_immutable()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'identity evidence is append-only';
END;
$$;

DROP TRIGGER IF EXISTS identity_consent_events_immutable ON identity_consent_events;
CREATE TRIGGER identity_consent_events_immutable
BEFORE UPDATE OR DELETE ON identity_consent_events
FOR EACH ROW EXECUTE FUNCTION preneura_identity_evidence_immutable();

DROP TRIGGER IF EXISTS identity_verification_events_immutable ON identity_verification_events;
CREATE TRIGGER identity_verification_events_immutable
BEFORE UPDATE OR DELETE ON identity_verification_events
FOR EACH ROW EXECUTE FUNCTION preneura_identity_evidence_immutable();

COMMIT;
