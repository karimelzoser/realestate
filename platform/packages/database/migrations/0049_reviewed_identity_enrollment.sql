BEGIN;

-- Subjects are meaningful only inside an issuer. Legacy unscoped bindings stay
-- quarantined; never infer their issuer from the current deployment environment.
ALTER TABLE auth_external_identities ADD COLUMN issuer text;
ALTER TABLE auth_external_identities DROP CONSTRAINT auth_external_identities_provider_provider_subject_key;
CREATE UNIQUE INDEX auth_external_identity_subject ON auth_external_identities(provider,issuer,provider_subject) NULLS NOT DISTINCT;
CREATE UNIQUE INDEX auth_external_identity_user_issuer ON auth_external_identities(user_id,provider,issuer) WHERE issuer IS NOT NULL;

CREATE FUNCTION reject_external_identity_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Identity bindings are immutable; replacement requires a separate recovery process';
END;
$$;
CREATE TRIGGER external_identity_immutable BEFORE UPDATE OR DELETE ON auth_external_identities
FOR EACH ROW EXECUTE FUNCTION reject_external_identity_mutation();

CREATE TABLE auth_identity_enrollment_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  base_session_id uuid NOT NULL REFERENCES auth_sessions(id),
  provider text NOT NULL CHECK (provider='google'),
  issuer text NOT NULL CHECK (length(issuer) BETWEEN 8 AND 2048),
  provider_subject text NOT NULL CHECK (length(provider_subject) BETWEEN 1 AND 255),
  verified_email text,
  provider_acr text,
  provider_amr jsonb NOT NULL CHECK (jsonb_typeof(provider_amr)='array'),
  id_token_sha256 text NOT NULL CHECK (id_token_sha256 ~ '^[a-f0-9]{64}$'),
  proof_verified_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now()+interval '24 hours',
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','APPROVED','REJECTED','EXPIRED')),
  reviewed_by uuid REFERENCES users(id),
  reviewer_session_id uuid REFERENCES auth_sessions(id),
  reviewed_at timestamptz,
  decision_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (expires_at>proof_verified_at),
  CHECK ((status IN ('PENDING','EXPIRED') AND reviewed_by IS NULL AND reviewer_session_id IS NULL AND reviewed_at IS NULL AND decision_note IS NULL)
    OR (status IN ('APPROVED','REJECTED') AND reviewed_by IS NOT NULL AND reviewer_session_id IS NOT NULL AND reviewed_at IS NOT NULL AND length(btrim(decision_note)) BETWEEN 10 AND 1000)),
  CHECK (reviewed_by IS DISTINCT FROM user_id)
);
CREATE UNIQUE INDEX auth_identity_enrollment_one_pending ON auth_identity_enrollment_requests(user_id,provider) WHERE status='PENDING';

CREATE FUNCTION guard_identity_enrollment_request() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE base_user uuid; base_verified timestamptz;
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Enrollment evidence is append-only'; END IF;
  IF TG_OP='INSERT' THEN
    SELECT s.user_id,a.verified_at INTO base_user,base_verified
      FROM auth_sessions s JOIN auth_session_assurance a ON a.session_id=s.id JOIN users u ON u.id=s.user_id
      WHERE s.id=NEW.base_session_id AND s.revoked_at IS NULL AND s.expires_at>now() AND u.status='ACTIVE';
    IF base_user IS DISTINCT FROM NEW.user_id OR base_verified IS NULL OR base_verified<now()-interval '10 minutes' THEN
      RAISE EXCEPTION 'A recent owned base session is required';
    END IF;
    IF NEW.status<>'PENDING' OR NEW.reviewed_by IS NOT NULL OR NEW.proof_verified_at<>now() OR NEW.expires_at<>now()+interval '24 hours' THEN
      RAISE EXCEPTION 'Enrollment starts pending with server-owned times';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM access_role_assignments WHERE user_id=NEW.user_id AND status='ACTIVE' AND revoked_at IS NULL
      AND role_code IN ('PRENEURA_SUPER_ADMIN','OPERATIONS_DIRECTOR','MANAGER','ALLOCATOR','TRANSACTION_OPERATOR','BROKER_MANAGER','BROKER_FINANCE')) THEN
      RAISE EXCEPTION 'Enrollment is for an invited privileged account';
    END IF;
    IF EXISTS (SELECT 1 FROM auth_external_identities WHERE user_id=NEW.user_id AND provider=NEW.provider) THEN
      RAISE EXCEPTION 'Initial enrollment cannot replace an existing factor';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.status<>'PENDING' OR (to_jsonb(NEW)-ARRAY['status','reviewed_by','reviewer_session_id','reviewed_at','decision_note'])
      IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','reviewed_by','reviewer_session_id','reviewed_at','decision_note']) THEN
    RAISE EXCEPTION 'Enrollment proof and terminal decisions are immutable';
  END IF;
  IF NEW.status='EXPIRED' THEN
    IF OLD.expires_at>now() THEN RAISE EXCEPTION 'Enrollment has not expired'; END IF;
    RETURN NEW;
  END IF;
  IF NEW.status NOT IN ('APPROVED','REJECTED') OR OLD.expires_at<=now() OR NEW.reviewed_at<>now() OR NEW.reviewed_by=OLD.user_id THEN
    RAISE EXCEPTION 'Invalid enrollment decision';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM auth_sessions s JOIN auth_session_assurance a ON a.session_id=s.id JOIN users u ON u.id=s.user_id
    JOIN access_role_assignments r ON r.user_id=u.id
    WHERE s.id=NEW.reviewer_session_id AND s.user_id=NEW.reviewed_by AND s.revoked_at IS NULL AND s.expires_at>now()
      AND u.status='ACTIVE' AND a.assurance_level='AAL2' AND a.verified_at>=now()-interval '10 minutes'
      AND r.role_code='PRENEURA_SUPER_ADMIN' AND r.scope_type='PLATFORM' AND r.status='ACTIVE' AND r.revoked_at IS NULL
  ) THEN RAISE EXCEPTION 'A recent platform administrator MFA session is required'; END IF;
  IF NOT EXISTS (SELECT 1 FROM users WHERE id=OLD.user_id AND status='ACTIVE') THEN RAISE EXCEPTION 'Target account is inactive'; END IF;
  IF NOT EXISTS (SELECT 1 FROM access_role_assignments WHERE user_id=OLD.user_id AND status='ACTIVE' AND revoked_at IS NULL
      AND role_code IN ('PRENEURA_SUPER_ADMIN','OPERATIONS_DIRECTOR','MANAGER','ALLOCATOR','TRANSACTION_OPERATOR','BROKER_MANAGER','BROKER_FINANCE')) THEN
    RAISE EXCEPTION 'Target no longer requires privileged enrollment';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER identity_enrollment_guard BEFORE INSERT OR UPDATE OR DELETE ON auth_identity_enrollment_requests
FOR EACH ROW EXECUTE FUNCTION guard_identity_enrollment_request();

CREATE FUNCTION apply_identity_enrollment_decision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status='APPROVED' THEN
    IF EXISTS (SELECT 1 FROM auth_external_identities WHERE user_id=NEW.user_id AND provider=NEW.provider) THEN
      RAISE EXCEPTION 'Initial enrollment cannot replace an existing factor';
    END IF;
    INSERT INTO auth_external_identities(user_id,provider,issuer,provider_subject,email_at_link_time)
      VALUES (NEW.user_id,NEW.provider,NEW.issuer,NEW.provider_subject,NEW.verified_email);
  END IF;
  INSERT INTO auth_security_events(user_id,event_type,result,session_id,metadata)
    VALUES (NEW.user_id,'IDENTITY_ENROLLMENT_'||NEW.status,
      CASE WHEN NEW.status='REJECTED' THEN 'REJECTED' ELSE 'SUCCESS' END,NEW.reviewer_session_id,
      jsonb_build_object('requestId',NEW.id,'reviewedBy',NEW.reviewed_by));
  RETURN NEW;
END;
$$;
CREATE TRIGGER identity_enrollment_apply AFTER UPDATE OF status ON auth_identity_enrollment_requests
FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status) EXECUTE FUNCTION apply_identity_enrollment_decision();

UPDATE platform_runtime_contract SET schema_version=49,minimum_runtime_version=49,migration_marker='0049_reviewed_identity_enrollment',updated_at=now() WHERE singleton_key='production';
COMMIT;
