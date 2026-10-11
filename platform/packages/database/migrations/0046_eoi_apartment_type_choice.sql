BEGIN;

-- Preserve legacy EOIs without inventing a buyer's choice. Every new EOI must
-- select a scoped active type and capture the actor accepting the quoted policy.
ALTER TABLE buyer_eois
  ADD COLUMN selected_unit_type_id uuid,
  ADD COLUMN selected_unit_type_snapshot jsonb,
  ADD COLUMN policy_accepted_by uuid REFERENCES users(id) ON DELETE RESTRICT,
  ADD COLUMN policy_accepted_at timestamptz,
  ADD COLUMN accepted_policy_snapshot jsonb,
  ADD CONSTRAINT buyer_eois_selected_type_scope_fk
    FOREIGN KEY (selected_unit_type_id, tenant_id, project_id)
    REFERENCES catalog_unit_types(id, tenant_id, project_id) ON DELETE RESTRICT;

CREATE FUNCTION preneura_guard_eoi_type_choice()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_type catalog_unit_types%ROWTYPE; v_policy eoi_refund_policies%ROWTYPE;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF ROW(NEW.tenant_id, NEW.project_id, NEW.buyer_profile_id, NEW.refund_policy_id,
           NEW.amount, NEW.currency, NEW.selected_unit_type_id, NEW.selected_unit_type_snapshot,
           NEW.policy_accepted_by, NEW.policy_accepted_at, NEW.accepted_policy_snapshot)
       IS DISTINCT FROM
       ROW(OLD.tenant_id, OLD.project_id, OLD.buyer_profile_id, OLD.refund_policy_id,
           OLD.amount, OLD.currency, OLD.selected_unit_type_id, OLD.selected_unit_type_snapshot,
           OLD.policy_accepted_by, OLD.policy_accepted_at, OLD.accepted_policy_snapshot) THEN
      RAISE EXCEPTION 'EOI choice and accepted policy evidence are immutable';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.selected_unit_type_id IS NULL OR NEW.policy_accepted_by IS NULL THEN
    RAISE EXCEPTION 'new EOI requires selected apartment type and policy acceptance actor';
  END IF;
  IF NEW.policy_accepted_by IS DISTINCT FROM NEW.created_by THEN
    RAISE EXCEPTION 'EOI acceptance actor must match the recorded creator';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM projects WHERE id = NEW.project_id AND tenant_id = NEW.tenant_id AND status = 'ACTIVE')
    OR NOT EXISTS (SELECT 1 FROM buyer_profiles WHERE id = NEW.buyer_profile_id AND tenant_id = NEW.tenant_id AND status = 'ACTIVE') THEN
    RAISE EXCEPTION 'new EOI requires active project and buyer';
  END IF;
  SELECT * INTO v_type FROM catalog_unit_types
  WHERE id = NEW.selected_unit_type_id AND tenant_id = NEW.tenant_id
    AND project_id = NEW.project_id AND status = 'ACTIVE' FOR SHARE;
  IF v_type.id IS NULL THEN RAISE EXCEPTION 'selected apartment type is not active in this project'; END IF;
  SELECT * INTO v_policy FROM eoi_refund_policies
  WHERE id = NEW.refund_policy_id AND tenant_id = NEW.tenant_id
    AND project_id = NEW.project_id AND status = 'ACTIVE' AND effective_at <= clock_timestamp() FOR SHARE;
  IF v_policy.id IS NULL THEN RAISE EXCEPTION 'EOI refund policy is not in this project'; END IF;
  IF NEW.amount <> v_policy.eoi_amount OR NEW.currency <> v_policy.currency THEN
    RAISE EXCEPTION 'EOI amount and currency must match accepted policy';
  END IF;

  -- Server-derived immutable evidence. No physical slot is acquired here.
  NEW.selected_unit_type_snapshot := jsonb_build_object('id', v_type.id,
    'code', v_type.code, 'name', v_type.name, 'indoorAreaSqm', v_type.indoor_area_sqm::text,
    'roofAreaSqm', v_type.roof_area_sqm::text, 'gardenAreaSqm', v_type.garden_area_sqm::text);
  NEW.policy_accepted_at := clock_timestamp();
  NEW.accepted_policy_snapshot := jsonb_build_object('id', v_policy.id,
    'versionNumber', v_policy.version_number, 'name', v_policy.name,
    'eoiAmount', v_policy.eoi_amount::text, 'currency', v_policy.currency,
    'beforeReservationRefundPercent', v_policy.before_reservation_refund_percent::text,
    'afterReservationBeforeContractRefundPercent', v_policy.after_reservation_before_contract_refund_percent::text,
    'afterContractRefundPercent', v_policy.after_contract_refund_percent::text,
    'processingFee', v_policy.processing_fee::text);
  RETURN NEW;
END;
$$;

CREATE TRIGGER buyer_eois_type_choice_guard BEFORE INSERT OR UPDATE ON buyer_eois
FOR EACH ROW EXECUTE FUNCTION preneura_guard_eoi_type_choice();

CREATE FUNCTION preneura_guard_accepted_eoi_policy()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(NEW.tenant_id, NEW.project_id, NEW.version_number, NEW.name, NEW.eoi_amount,
         NEW.currency, NEW.before_reservation_refund_percent,
         NEW.after_reservation_before_contract_refund_percent, NEW.after_contract_refund_percent,
         NEW.processing_fee, NEW.effective_at)
     IS DISTINCT FROM
     ROW(OLD.tenant_id, OLD.project_id, OLD.version_number, OLD.name, OLD.eoi_amount,
         OLD.currency, OLD.before_reservation_refund_percent,
         OLD.after_reservation_before_contract_refund_percent, OLD.after_contract_refund_percent,
         OLD.processing_fee, OLD.effective_at)
     AND EXISTS (SELECT 1 FROM buyer_eois WHERE refund_policy_id = OLD.id) THEN
    RAISE EXCEPTION 'accepted EOI policy terms are immutable; publish a new version';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER eoi_policy_accepted_terms_guard BEFORE UPDATE ON eoi_refund_policies
FOR EACH ROW EXECUTE FUNCTION preneura_guard_accepted_eoi_policy();

UPDATE platform_runtime_contract SET schema_version = 46, minimum_runtime_version = 46,
  migration_marker = '0046_eoi_apartment_type_choice', updated_at = now()
WHERE singleton_key = 'production';
COMMIT;
