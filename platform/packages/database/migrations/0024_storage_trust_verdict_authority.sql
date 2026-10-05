BEGIN;

CREATE OR REPLACE FUNCTION preneura_storage_trust_verdict_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_attempt record;
  v_expected_status text;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  SELECT provider, result, detected_mime_type, engine_version,
         provider_reference, malware_signature, error_code, completed_at
  INTO v_attempt
  FROM storage_object_scan_attempts
  WHERE object_trust_id = NEW.id
  ORDER BY attempt_number DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'storage trust verdict requires immutable scan evidence';
  END IF;

  v_expected_status := CASE
    WHEN v_attempt.result = 'CLEAN' THEN 'CLEAN'
    WHEN v_attempt.result IN ('INFECTED','MIME_MISMATCH') THEN 'REJECTED'
    WHEN v_attempt.result = 'ERROR' THEN 'SCAN_FAILED'
    ELSE NULL
  END;

  IF NEW.status IS DISTINCT FROM v_expected_status THEN
    RAISE EXCEPTION 'storage trust status does not match latest scan verdict';
  END IF;

  IF NEW.detected_mime_type IS DISTINCT FROM COALESCE(v_attempt.detected_mime_type, OLD.detected_mime_type)
     OR NEW.scanner_provider IS DISTINCT FROM v_attempt.provider
     OR NEW.scanner_reference IS DISTINCT FROM v_attempt.provider_reference
     OR NEW.scanner_signature IS DISTINCT FROM v_attempt.malware_signature
     OR NEW.last_error_code IS DISTINCT FROM v_attempt.error_code THEN
    RAISE EXCEPTION 'storage trust verdict metadata does not match latest scan evidence';
  END IF;

  IF NEW.status IN ('CLEAN','REJECTED') AND NEW.scanned_at IS DISTINCT FROM v_attempt.completed_at THEN
    RAISE EXCEPTION 'terminal storage trust verdict must use scan completion time';
  END IF;

  IF NEW.status = 'CLEAN' AND NEW.detected_mime_type IS DISTINCT FROM NEW.declared_mime_type THEN
    RAISE EXCEPTION 'CLEAN storage trust requires detected MIME to match declared MIME';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_storage_object_trust_00_verdict_authority
BEFORE UPDATE ON storage_object_trust
FOR EACH ROW EXECUTE FUNCTION preneura_storage_trust_verdict_guard();

COMMIT;
