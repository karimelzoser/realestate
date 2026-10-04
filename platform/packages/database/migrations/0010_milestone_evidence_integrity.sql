BEGIN;

CREATE OR REPLACE FUNCTION enforce_transaction_milestone_evidence()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  tx_tenant_id uuid;
  tx_project_id uuid;
  requirement_count integer;
  missing_requirement_count integer;
  evidence_count integer;
  incomplete_count integer;
BEGIN
  IF NEW.status <> 'COMPLETED' OR OLD.status = 'COMPLETED' THEN
    RETURN NEW;
  END IF;

  SELECT t.tenant_id, t.project_id
  INTO tx_tenant_id, tx_project_id
  FROM transactions t
  WHERE t.id = NEW.transaction_id;

  IF tx_tenant_id IS NULL OR tx_project_id IS NULL THEN
    RAISE EXCEPTION 'Transaction % does not exist for milestone evidence validation', NEW.transaction_id;
  END IF;

  CASE NEW.code
    WHEN 'BUYER_DOCUMENTS_COMPLETE' THEN
      SELECT count(*)::int
      INTO requirement_count
      FROM project_document_requirements r
      WHERE r.tenant_id = tx_tenant_id
        AND r.project_id = tx_project_id
        AND r.required_for_completion = true;

      IF requirement_count = 0 THEN
        RAISE EXCEPTION 'BUYER_DOCUMENTS_COMPLETE requires at least one configured completion document requirement';
      END IF;

      SELECT count(*)::int
      INTO missing_requirement_count
      FROM project_document_requirements r
      WHERE r.tenant_id = tx_tenant_id
        AND r.project_id = tx_project_id
        AND r.required_for_completion = true
        AND (
          SELECT count(*)
          FROM transaction_documents d
          WHERE d.transaction_id = NEW.transaction_id
            AND d.category = r.category
            AND d.status IN ('VERIFIED','SIGNED','STAMPED')
        ) < r.required_count;

      IF missing_requirement_count <> 0 THEN
        RAISE EXCEPTION 'BUYER_DOCUMENTS_COMPLETE requires all configured transaction documents to be verified';
      END IF;

    WHEN 'DOWN_PAYMENT_RECEIVED' THEN
      SELECT count(*)::int,
             count(*) FILTER (WHERE item.status NOT IN ('PAID','WAIVED','CANCELLED'))::int
      INTO evidence_count, incomplete_count
      FROM payment_schedule_items item
      JOIN payment_schedules schedule ON schedule.id = item.payment_schedule_id
      WHERE schedule.transaction_id = NEW.transaction_id
        AND item.item_type = 'DOWN_PAYMENT';

      IF evidence_count = 0 OR incomplete_count <> 0 THEN
        RAISE EXCEPTION 'DOWN_PAYMENT_RECEIVED requires all down-payment items to be paid, waived or cancelled';
      END IF;

    WHEN 'CHEQUES_RECEIVED' THEN
      SELECT count(*)::int,
             count(*) FILTER (WHERE status NOT IN ('RECEIVED','DEPOSITED','CLEARED'))::int
      INTO evidence_count, incomplete_count
      FROM transaction_cheques
      WHERE transaction_id = NEW.transaction_id;

      IF evidence_count = 0 OR incomplete_count <> 0 THEN
        RAISE EXCEPTION 'CHEQUES_RECEIVED requires all expected cheques to be received, deposited or cleared';
      END IF;

    WHEN 'CONTRACT_GENERATED' THEN
      SELECT count(*)::int
      INTO evidence_count
      FROM transaction_documents d
      WHERE d.transaction_id = NEW.transaction_id
        AND d.category = 'CONTRACT'
        AND d.status IN ('VERIFIED','SIGNED','STAMPED');

      IF evidence_count = 0 THEN
        RAISE EXCEPTION 'CONTRACT_GENERATED requires a verified contract';
      END IF;

    WHEN 'CONTRACT_SIGNED' THEN
      SELECT count(*)::int
      INTO evidence_count
      FROM transaction_documents d
      WHERE d.transaction_id = NEW.transaction_id
        AND d.category = 'CONTRACT'
        AND d.status IN ('SIGNED','STAMPED');

      IF evidence_count = 0 THEN
        RAISE EXCEPTION 'CONTRACT_SIGNED requires a fully signed contract';
      END IF;

    WHEN 'CONTRACT_STAMPED' THEN
      SELECT count(*)::int
      INTO evidence_count
      FROM transaction_documents d
      WHERE d.transaction_id = NEW.transaction_id
        AND d.category = 'CONTRACT'
        AND d.status = 'STAMPED';

      IF evidence_count = 0 THEN
        RAISE EXCEPTION 'CONTRACT_STAMPED requires a stamped contract';
      END IF;

    ELSE
      RAISE EXCEPTION 'Unsupported transaction milestone code %', NEW.code;
  END CASE;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_transaction_milestone_evidence ON transaction_milestones;
CREATE TRIGGER trg_enforce_transaction_milestone_evidence
BEFORE UPDATE OF status ON transaction_milestones
FOR EACH ROW
WHEN (NEW.status = 'COMPLETED' AND OLD.status IS DISTINCT FROM NEW.status)
EXECUTE FUNCTION enforce_transaction_milestone_evidence();

COMMIT;
