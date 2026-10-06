BEGIN;

CREATE OR REPLACE FUNCTION preneura_capture_cheque_creation_event()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO finance_cheque_events (
    cheque_id, event_type, cheque_number, bank_name, actor_user_id,
    occurred_at, metadata
  ) VALUES (
    NEW.id, 'EXPECTED', NEW.cheque_number, NEW.bank_name, NEW.verified_by,
    NEW.updated_at, jsonb_build_object(
      'generation', NEW.generation,
      'rootChequeId', NEW.root_cheque_id,
      'replacesChequeId', NEW.replaces_cheque_id
    )
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_transaction_cheques_capture_creation
AFTER INSERT ON transaction_cheques
FOR EACH ROW EXECUTE FUNCTION preneura_capture_cheque_creation_event();

CREATE OR REPLACE FUNCTION preneura_replace_returned_cheque(
  p_cheque_id uuid,
  p_actor_user_id uuid,
  p_amount numeric,
  p_due_at timestamptz,
  p_cheque_number text DEFAULT NULL,
  p_bank_name text DEFAULT NULL,
  p_occurred_at timestamptz DEFAULT now()
) RETURNS uuid
LANGUAGE plpgsql
AS $$
DECLARE
  v_old transaction_cheques%ROWTYPE;
  v_new_id uuid;
BEGIN
  SELECT * INTO v_old FROM transaction_cheques WHERE id = p_cheque_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'cheque not found'; END IF;
  IF v_old.status <> 'RETURNED' THEN
    RAISE EXCEPTION 'only a returned cheque can be replaced';
  END IF;

  INSERT INTO transaction_cheques (
    tenant_id, project_id, transaction_id, sequence_number, amount, due_at,
    cheque_number, bank_name, status, received_at, verified_by, updated_at,
    generation, root_cheque_id, replaces_cheque_id
  ) VALUES (
    v_old.tenant_id, v_old.project_id, v_old.transaction_id, v_old.sequence_number,
    p_amount, p_due_at, p_cheque_number, p_bank_name, 'EXPECTED', NULL,
    p_actor_user_id, p_occurred_at, v_old.generation + 1, v_old.root_cheque_id, v_old.id
  ) RETURNING id INTO v_new_id;

  INSERT INTO finance_cheque_events (
    cheque_id, event_type, cheque_number, bank_name, replacement_cheque_id,
    actor_user_id, occurred_at, metadata
  ) VALUES (
    v_old.id, 'REPLACED', p_cheque_number, p_bank_name, v_new_id,
    p_actor_user_id, p_occurred_at, '{}'::jsonb
  );

  RETURN v_new_id;
END;
$$;

COMMIT;
