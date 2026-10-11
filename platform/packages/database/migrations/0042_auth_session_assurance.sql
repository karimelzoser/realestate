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

COMMIT;
