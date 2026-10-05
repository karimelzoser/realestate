BEGIN;

ALTER TABLE auth_login_aliases
  ALTER COLUMN verified_at DROP NOT NULL;

ALTER TABLE auth_delivery_contacts
  ADD COLUMN IF NOT EXISTS display_hint text,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE UNIQUE INDEX IF NOT EXISTS auth_delivery_contacts_one_primary_email
  ON auth_delivery_contacts(user_id)
  WHERE kind = 'EMAIL' AND is_primary = true;

CREATE INDEX IF NOT EXISTS auth_delivery_contacts_user_verified
  ON auth_delivery_contacts(user_id, kind, is_primary)
  WHERE verified_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS auth_contact_verification_challenges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  contact_id uuid NOT NULL REFERENCES auth_delivery_contacts(id) ON DELETE CASCADE,
  alias_id uuid REFERENCES auth_login_aliases(id) ON DELETE CASCADE,
  channel text NOT NULL CHECK (channel IN ('SMS','WHATSAPP')),
  code_digest bytea NOT NULL,
  attempts_remaining smallint NOT NULL DEFAULT 5 CHECK (attempts_remaining BETWEEN 0 AND 20),
  expires_at timestamptz NOT NULL,
  sent_at timestamptz,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (expires_at > created_at)
);

CREATE INDEX IF NOT EXISTS auth_contact_verification_lookup
  ON auth_contact_verification_challenges(contact_id, created_at DESC)
  WHERE consumed_at IS NULL;

CREATE INDEX IF NOT EXISTS auth_contact_verification_expiry
  ON auth_contact_verification_challenges(expires_at)
  WHERE consumed_at IS NULL;

COMMIT;