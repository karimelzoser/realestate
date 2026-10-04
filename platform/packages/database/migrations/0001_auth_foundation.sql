BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  display_name text NOT NULL,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('ACTIVE','DISABLED','PENDING')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Login identifiers never store phone numbers or national IDs in clear text.
-- identifier_hmac is HMAC-SHA256(normalized identifier, application secret).
CREATE TABLE IF NOT EXISTS auth_login_aliases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('PHONE','NATIONAL_ID')),
  identifier_hmac bytea NOT NULL,
  verified_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (kind, identifier_hmac)
);

-- Encrypted contact values are used only when PRENEURA needs to deliver an OTP.
-- Encryption/decryption happens in the application with a KMS-managed envelope key.
CREATE TABLE IF NOT EXISTS auth_delivery_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('PHONE','EMAIL')),
  value_ciphertext bytea NOT NULL,
  value_hmac bytea NOT NULL,
  verified_at timestamptz,
  is_primary boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (kind, value_hmac)
);

CREATE UNIQUE INDEX IF NOT EXISTS auth_delivery_contacts_one_primary_phone
  ON auth_delivery_contacts(user_id)
  WHERE kind = 'PHONE' AND is_primary = true;

CREATE TABLE IF NOT EXISTS auth_external_identities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider text NOT NULL,
  provider_subject text NOT NULL,
  email_at_link_time text,
  linked_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_subject)
);

-- A challenge is created even when no account matches. This preserves a generic,
-- enumeration-resistant response shape. user_id therefore remains nullable.
CREATE TABLE IF NOT EXISTS auth_otp_challenges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  requested_kind text NOT NULL CHECK (requested_kind IN ('PHONE','NATIONAL_ID')),
  requested_identifier_hmac bytea NOT NULL,
  otp_digest bytea NOT NULL,
  delivery_channel text NOT NULL CHECK (delivery_channel IN ('SMS','WHATSAPP')),
  delivery_attempted boolean NOT NULL DEFAULT false,
  attempts_remaining smallint NOT NULL CHECK (attempts_remaining BETWEEN 0 AND 20),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (expires_at > created_at)
);

CREATE INDEX IF NOT EXISTS auth_otp_challenges_lookup
  ON auth_otp_challenges(requested_kind, requested_identifier_hmac, created_at DESC);

CREATE INDEX IF NOT EXISTS auth_otp_challenges_expiry
  ON auth_otp_challenges(expires_at)
  WHERE consumed_at IS NULL;

-- Browser receives the random session token. PostgreSQL stores only its digest.
CREATE TABLE IF NOT EXISTS auth_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_digest bytea NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  CHECK (expires_at > created_at)
);

CREATE INDEX IF NOT EXISTS auth_sessions_user_active
  ON auth_sessions(user_id, expires_at DESC)
  WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS auth_security_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  event_type text NOT NULL,
  result text NOT NULL CHECK (result IN ('SUCCESS','REJECTED','FAILED')),
  challenge_id uuid,
  session_id uuid,
  request_id text,
  ip_digest bytea,
  user_agent_digest bytea,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS auth_security_events_user_time
  ON auth_security_events(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS auth_security_events_type_time
  ON auth_security_events(event_type, created_at DESC);

COMMIT;
