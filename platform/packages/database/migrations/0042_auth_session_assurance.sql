BEGIN;

CREATE TABLE auth_session_assurance (
  session_id uuid PRIMARY KEY REFERENCES auth_sessions(id) ON DELETE CASCADE,
  auth_method text NOT NULL CHECK (auth_method IN ('OTP', 'OIDC_GOOGLE')),
  assurance_level text NOT NULL CHECK (assurance_level IN ('AAL1', 'AAL2')),
  provider_acr text,
  provider_amr jsonb NOT NULL DEFAULT '[]'::jsonb,
  verified_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (jsonb_typeof(provider_amr) = 'array'),
  -- A single possession OTP is never sufficient evidence for privileged AAL2.
  CHECK (NOT (auth_method = 'OTP' AND assurance_level = 'AAL2')),
  CHECK (
    (auth_method = 'OTP' AND provider_acr IS NULL AND provider_amr = '[]'::jsonb)
    OR auth_method = 'OIDC_GOOGLE'
  )
);

CREATE INDEX auth_session_assurance_level_time
  ON auth_session_assurance(assurance_level, verified_at DESC);

COMMENT ON TABLE auth_session_assurance IS
  'Server-side authentication assurance evidence. Sessions without a row are treated as AAL1 for backward-safe fail-closed behavior.';

-- One PRENEURA account may have only one identity per external provider. Combined
-- with the existing (provider, provider_subject) uniqueness, this closes both sides
-- of concurrent factor enrollment: one provider subject cannot own two accounts and
-- one account cannot acquire two competing Google subjects.
CREATE UNIQUE INDEX auth_external_identities_one_subject_per_user_provider
  ON auth_external_identities(user_id, provider);

-- Runtime 42 depends on this table/index for privileged authorization. The migration
-- is additive, so the previous runtime may continue during a rolling deployment.
UPDATE platform_runtime_contract
SET
  schema_version = 42,
  minimum_runtime_version = LEAST(minimum_runtime_version, 41),
  migration_marker = '0042_auth_session_assurance',
  updated_at = now()
WHERE singleton_key = 'production';

COMMIT;
