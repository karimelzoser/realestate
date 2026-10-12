BEGIN;

CREATE TABLE buyer_project_attributions(
  tenant_id uuid NOT NULL,project_id uuid NOT NULL,buyer_profile_id uuid NOT NULL,
  source text NOT NULL CHECK(source IN('DIRECT','BROKER','INTERNAL')),broker_company_id uuid,broker_agent_user_id uuid REFERENCES users(id) ON DELETE RESTRICT,
  attribution_revision bigint NOT NULL DEFAULT 0 CHECK(attribution_revision>=0),created_by uuid REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(buyer_profile_id,project_id),
  FOREIGN KEY(project_id,tenant_id) REFERENCES projects(id,tenant_id) ON DELETE RESTRICT,
  FOREIGN KEY(buyer_profile_id,tenant_id) REFERENCES buyer_profiles(id,tenant_id) ON DELETE RESTRICT,
  FOREIGN KEY(broker_company_id,tenant_id) REFERENCES broker_companies(id,tenant_id) ON DELETE RESTRICT,
  CHECK((source='BROKER' AND broker_company_id IS NOT NULL) OR(source<>'BROKER' AND broker_company_id IS NULL AND broker_agent_user_id IS NULL))
);
CREATE INDEX buyer_project_broker_scope ON buyer_project_attributions(tenant_id,project_id,broker_company_id,broker_agent_user_id);
-- Preserve known current prospect state in each recorded project; never infer
-- historical reservation ownership from this mutable prospect baseline.
INSERT INTO buyer_project_attributions(tenant_id,project_id,buyer_profile_id,source,broker_company_id,broker_agent_user_id)
SELECT DISTINCT scope.tenant_id,scope.project_id,buyer.id,
  CASE WHEN approved.id IS NOT NULL THEN 'BROKER' ELSE buyer.source END,
  CASE WHEN approved.id IS NOT NULL THEN approved.to_broker_company_id ELSE buyer.broker_company_id END,
  CASE WHEN approved.id IS NOT NULL THEN approved.to_broker_agent_user_id ELSE buyer.broker_agent_user_id END
FROM(SELECT tenant_id,project_id,buyer_profile_id FROM buyer_eois UNION SELECT tenant_id,project_id,buyer_profile_id FROM brokerage_attribution_transfers) scope
JOIN buyer_profiles buyer ON buyer.id=scope.buyer_profile_id AND buyer.tenant_id=scope.tenant_id
LEFT JOIN LATERAL(SELECT transfer.id,transfer.to_broker_company_id,transfer.to_broker_agent_user_id
  FROM brokerage_attribution_transfers transfer JOIN brokerage_attribution_history history ON history.transfer_id=transfer.id
    AND history.event_type='TRANSFER_APPROVED' AND history.actor_user_id=transfer.reviewed_by
    AND history.broker_company_id=transfer.to_broker_company_id
    AND history.broker_agent_user_id IS NOT DISTINCT FROM transfer.to_broker_agent_user_id
  WHERE transfer.buyer_profile_id=buyer.id AND transfer.tenant_id=scope.tenant_id AND transfer.project_id=scope.project_id
    AND transfer.status='APPROVED' AND transfer.reviewed_by IS NOT NULL
  ORDER BY transfer.reviewed_at DESC,transfer.id DESC LIMIT 1) approved ON true;
ALTER TABLE brokerage_attribution_transfers
  ADD COLUMN expected_source text,
  ADD COLUMN expected_revision bigint,
  ADD COLUMN execution_transaction_id bigint;
UPDATE brokerage_attribution_transfers transfer
SET expected_source=buyer.source,expected_revision=buyer.attribution_revision
FROM buyer_project_attributions buyer WHERE buyer.buyer_profile_id=transfer.buyer_profile_id AND buyer.tenant_id=transfer.tenant_id AND buyer.project_id=transfer.project_id AND transfer.status='REQUESTED';

ALTER TABLE brokerage_attribution_history
  ADD COLUMN project_id uuid,
  ADD CONSTRAINT brokerage_history_project_scope_fk FOREIGN KEY(project_id,tenant_id) REFERENCES projects(id,tenant_id) ON DELETE RESTRICT,
  ADD COLUMN previous_source text,
  ADD COLUMN previous_broker_company_id uuid,
  ADD COLUMN previous_broker_agent_user_id uuid,
  ADD COLUMN previous_revision bigint,
  ADD COLUMN new_revision bigint,
  ADD COLUMN projection_transaction_id bigint,
  DROP CONSTRAINT brokerage_attribution_history_event_type_check,
  ADD CONSTRAINT brokerage_attribution_history_event_type_check CHECK(event_type IN('INITIAL','TRANSFER_APPROVED','CLEARED','MIGRATION_BASELINE'));
CREATE UNIQUE INDEX brokerage_history_projection_revision ON brokerage_attribution_history(buyer_profile_id,project_id,new_revision) WHERE new_revision IS NOT NULL;
CREATE UNIQUE INDEX brokerage_history_transfer_application ON brokerage_attribution_history(transfer_id) WHERE event_type='TRANSFER_APPROVED' AND new_revision IS NOT NULL;
-- Preserve all historical evidence; explicitly baseline the current projection.
INSERT INTO brokerage_attribution_history(tenant_id,project_id,buyer_profile_id,broker_company_id,broker_agent_user_id,event_type,new_revision,projection_transaction_id)
SELECT tenant_id,project_id,buyer_profile_id,broker_company_id,broker_agent_user_id,'MIGRATION_BASELINE',0,txid_current() FROM buyer_project_attributions;

CREATE FUNCTION preneura_attribution_reviewer_authorized(p_actor uuid,p_tenant uuid,p_project uuid)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS(SELECT 1 FROM users actor
    JOIN tenant_memberships member ON member.user_id=actor.id AND member.tenant_id=p_tenant AND member.status='ACTIVE'
    JOIN tenants tenant ON tenant.id=p_tenant AND tenant.status='ACTIVE'
    JOIN projects project ON project.id=p_project AND project.tenant_id=p_tenant AND project.status='ACTIVE'
    JOIN access_role_assignments assignment ON assignment.user_id=actor.id AND assignment.tenant_id=p_tenant
      AND assignment.status='ACTIVE' AND assignment.revoked_at IS NULL AND assignment.role_code IN('OPERATIONS_DIRECTOR','MANAGER')
      AND (assignment.scope_type='TENANT' OR(assignment.scope_type='PROJECT' AND assignment.project_id=p_project))
    WHERE actor.id=p_actor AND actor.status='ACTIVE');
$$;

CREATE FUNCTION preneura_attribution_target_eligible(p_tenant uuid,p_project uuid,p_company uuid,p_agent uuid)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS(SELECT 1 FROM broker_companies company
    JOIN brokerage_tenant_links link ON link.broker_company_id=company.id AND link.tenant_id=company.tenant_id AND link.status='ACTIVE'
    JOIN brokerage_organizations org ON org.id=link.organization_id AND org.status='ACTIVE'
    JOIN brokerage_agreements agreement ON agreement.organization_id=org.id AND agreement.tenant_id=company.tenant_id
      AND agreement.broker_company_id=company.id AND agreement.status='ACTIVE'
      AND agreement.effective_from<=clock_timestamp() AND(agreement.effective_to IS NULL OR agreement.effective_to>clock_timestamp())
    JOIN brokerage_agreement_projects ap ON ap.agreement_id=agreement.id AND ap.tenant_id=company.tenant_id
      AND ap.project_id=p_project AND ap.status='ACTIVE' AND ap.effective_from<=clock_timestamp()
      AND(ap.effective_to IS NULL OR ap.effective_to>clock_timestamp())
    JOIN broker_project_access access ON access.broker_company_id=company.id AND access.tenant_id=company.tenant_id
      AND access.project_id=p_project AND access.status='ACTIVE' AND access.effective_from<=clock_timestamp()
      AND(access.effective_to IS NULL OR access.effective_to>clock_timestamp())
    WHERE company.id=p_company AND company.tenant_id=p_tenant AND company.status='ACTIVE')
    AND(p_agent IS NULL OR EXISTS(SELECT 1 FROM users agent
      JOIN tenant_memberships member ON member.user_id=agent.id AND member.tenant_id=p_tenant AND member.status='ACTIVE'
      JOIN access_role_assignments assignment ON assignment.user_id=agent.id AND assignment.tenant_id=p_tenant
        AND assignment.broker_company_id=p_company AND assignment.role_code='BROKER_AGENT' AND assignment.scope_type='BROKER_COMPANY'
        AND assignment.status='ACTIVE' AND assignment.revoked_at IS NULL
      WHERE agent.id=p_agent AND agent.status='ACTIVE'));
$$;

CREATE FUNCTION preneura_attribution_transfer_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_buyer buyer_project_attributions%ROWTYPE;
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'attribution transfer evidence cannot be deleted'; END IF;
  IF TG_OP='INSERT' THEN
    SELECT * INTO v_buyer FROM buyer_project_attributions WHERE buyer_profile_id=NEW.buyer_profile_id AND tenant_id=NEW.tenant_id AND project_id=NEW.project_id FOR SHARE;
    IF v_buyer.buyer_profile_id IS NULL OR NOT EXISTS(SELECT 1 FROM buyer_profiles WHERE id=NEW.buyer_profile_id AND tenant_id=NEW.tenant_id AND status='ACTIVE') OR ROW(NEW.from_broker_company_id,NEW.from_broker_agent_user_id)
      IS DISTINCT FROM ROW(v_buyer.broker_company_id,v_buyer.broker_agent_user_id) THEN RAISE EXCEPTION 'buyer attribution changed before transfer request'; END IF;
    IF NEW.status<>'REQUESTED' OR NEW.reviewed_by IS NOT NULL OR NEW.execution_transaction_id IS NOT NULL THEN RAISE EXCEPTION 'new attribution transfer must await review'; END IF;
    IF NOT preneura_attribution_reviewer_authorized(NEW.requested_by,NEW.tenant_id,NEW.project_id) AND NOT(
      NEW.from_broker_company_id IS NOT NULL AND NEW.from_broker_company_id=NEW.to_broker_company_id
      AND preneura_attribution_target_eligible(NEW.tenant_id,NEW.project_id,NEW.to_broker_company_id,NEW.to_broker_agent_user_id)
      AND EXISTS(SELECT 1 FROM users actor JOIN tenant_memberships member ON member.user_id=actor.id AND member.tenant_id=NEW.tenant_id AND member.status='ACTIVE'
        JOIN access_role_assignments assignment ON assignment.user_id=actor.id AND assignment.tenant_id=NEW.tenant_id
          AND assignment.broker_company_id=NEW.from_broker_company_id AND assignment.role_code='BROKER_MANAGER'
          AND assignment.scope_type='BROKER_COMPANY' AND assignment.status='ACTIVE' AND assignment.revoked_at IS NULL
        JOIN tenants tenant ON tenant.id=NEW.tenant_id AND tenant.status='ACTIVE'
        JOIN projects project ON project.id=NEW.project_id AND project.tenant_id=NEW.tenant_id AND project.status='ACTIVE'
        WHERE actor.id=NEW.requested_by AND actor.status='ACTIVE')) THEN
      RAISE EXCEPTION 'active attribution requester is required';
    END IF;
    NEW.expected_source:=v_buyer.source;NEW.expected_revision:=v_buyer.attribution_revision;
    RETURN NEW;
  END IF;
  IF ROW(NEW.id,NEW.tenant_id,NEW.project_id,NEW.buyer_profile_id,NEW.from_broker_company_id,NEW.from_broker_agent_user_id,
      NEW.to_broker_company_id,NEW.to_broker_agent_user_id,NEW.reason,NEW.requested_by,NEW.requested_at,NEW.expected_source,NEW.expected_revision)
    IS DISTINCT FROM ROW(OLD.id,OLD.tenant_id,OLD.project_id,OLD.buyer_profile_id,OLD.from_broker_company_id,OLD.from_broker_agent_user_id,
      OLD.to_broker_company_id,OLD.to_broker_agent_user_id,OLD.reason,OLD.requested_by,OLD.requested_at,OLD.expected_source,OLD.expected_revision) THEN
    RAISE EXCEPTION 'attribution transfer request evidence is immutable';
  END IF;
  IF OLD.status<>'REQUESTED' THEN
    IF NEW IS DISTINCT FROM OLD THEN RAISE EXCEPTION 'reviewed attribution transfer evidence is immutable'; END IF;
    RETURN NEW;
  END IF;
  IF NEW.status IN('APPROVED','REJECTED') THEN
    IF NEW.reviewed_at IS NULL OR NOT preneura_attribution_reviewer_authorized(NEW.reviewed_by,NEW.tenant_id,NEW.project_id) THEN
      RAISE EXCEPTION 'active developer attribution reviewer is required';
    END IF;
    IF NEW.status='APPROVED' AND NOT preneura_attribution_target_eligible(NEW.tenant_id,NEW.project_id,NEW.to_broker_company_id,NEW.to_broker_agent_user_id) THEN
      RAISE EXCEPTION 'target brokerage or agent is not eligible for attribution transfer';
    END IF;
    NEW.execution_transaction_id:=txid_current();
  ELSIF NEW.status='REQUESTED' THEN
    IF ROW(NEW.reviewed_by,NEW.reviewed_at,NEW.review_note,NEW.execution_transaction_id)
      IS DISTINCT FROM ROW(OLD.reviewed_by,OLD.reviewed_at,OLD.review_note,OLD.execution_transaction_id) THEN
      RAISE EXCEPTION 'pending attribution transfer cannot forge review evidence';
    END IF;
  ELSE RAISE EXCEPTION 'attribution transfer requires an approved or rejected review'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER brokerage_transfer_authority BEFORE INSERT OR UPDATE OR DELETE ON brokerage_attribution_transfers
FOR EACH ROW EXECUTE FUNCTION preneura_attribution_transfer_guard();

CREATE FUNCTION preneura_attribution_history_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_transfer brokerage_attribution_transfers%ROWTYPE;
BEGIN
  IF NEW.event_type='TRANSFER_APPROVED' THEN
    SELECT * INTO v_transfer FROM brokerage_attribution_transfers WHERE id=NEW.transfer_id;
    IF v_transfer.id IS NULL OR v_transfer.status<>'APPROVED' OR v_transfer.execution_transaction_id IS DISTINCT FROM txid_current()
      OR ROW(NEW.tenant_id,NEW.buyer_profile_id,NEW.broker_company_id,NEW.broker_agent_user_id,NEW.actor_user_id)
        IS DISTINCT FROM ROW(v_transfer.tenant_id,v_transfer.buyer_profile_id,v_transfer.to_broker_company_id,v_transfer.to_broker_agent_user_id,v_transfer.reviewed_by) THEN
      RAISE EXCEPTION 'attribution history must match the reviewed transfer';
    END IF;
    NEW.project_id:=v_transfer.project_id;NEW.previous_source:=v_transfer.expected_source;NEW.previous_broker_company_id:=v_transfer.from_broker_company_id;
    NEW.previous_broker_agent_user_id:=v_transfer.from_broker_agent_user_id;NEW.previous_revision:=v_transfer.expected_revision;
    NEW.new_revision:=v_transfer.expected_revision+1;NEW.projection_transaction_id:=txid_current();
  ELSIF NEW.event_type='INITIAL' THEN
    IF pg_trigger_depth()<2 OR NOT EXISTS(SELECT 1 FROM buyer_project_attributions attribution
      WHERE attribution.tenant_id=NEW.tenant_id AND attribution.project_id=NEW.project_id AND attribution.buyer_profile_id=NEW.buyer_profile_id
        AND attribution.attribution_revision=0 AND ROW(attribution.broker_company_id,attribution.broker_agent_user_id,attribution.created_by)
          IS NOT DISTINCT FROM ROW(NEW.broker_company_id,NEW.broker_agent_user_id,NEW.actor_user_id)) THEN
      RAISE EXCEPTION 'initial attribution history is project-registration-derived'; END IF;
    NEW.new_revision:=0;NEW.projection_transaction_id:=txid_current();
  ELSE RAISE EXCEPTION 'unsupported direct attribution history insertion'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER brokerage_history_authority BEFORE INSERT ON brokerage_attribution_history
FOR EACH ROW EXECUTE FUNCTION preneura_attribution_history_guard();

CREATE FUNCTION preneura_project_attribution_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'project buyer attribution evidence cannot be deleted'; END IF;
  IF ROW(NEW.tenant_id,NEW.project_id,NEW.buyer_profile_id) IS DISTINCT FROM ROW(OLD.tenant_id,OLD.project_id,OLD.buyer_profile_id) THEN RAISE EXCEPTION 'buyer profile owner and tenant are immutable'; END IF;
  IF ROW(NEW.source,NEW.broker_company_id,NEW.broker_agent_user_id,NEW.attribution_revision)
    IS NOT DISTINCT FROM ROW(OLD.source,OLD.broker_company_id,OLD.broker_agent_user_id,OLD.attribution_revision) THEN RETURN NEW; END IF;
  IF pg_trigger_depth()<2 OR NEW.attribution_revision<>OLD.attribution_revision+1 OR NOT EXISTS(
    SELECT 1 FROM brokerage_attribution_history history JOIN brokerage_attribution_transfers transfer ON transfer.id=history.transfer_id
    WHERE history.buyer_profile_id=OLD.buyer_profile_id AND history.tenant_id=OLD.tenant_id AND history.project_id=OLD.project_id AND history.event_type='TRANSFER_APPROVED'
      AND history.projection_transaction_id=txid_current() AND transfer.execution_transaction_id=txid_current() AND transfer.status='APPROVED'
      AND ROW(history.previous_source,history.previous_broker_company_id,history.previous_broker_agent_user_id,history.previous_revision)
        IS NOT DISTINCT FROM ROW(OLD.source,OLD.broker_company_id,OLD.broker_agent_user_id,OLD.attribution_revision)
      AND ROW('BROKER'::text,history.broker_company_id,history.broker_agent_user_id,history.new_revision)
        IS NOT DISTINCT FROM ROW(NEW.source,NEW.broker_company_id,NEW.broker_agent_user_id,NEW.attribution_revision)) THEN
    RAISE EXCEPTION 'buyer attribution is approved-transfer-derived and cannot be changed directly';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER buyer_project_attribution_authority BEFORE UPDATE OR DELETE ON buyer_project_attributions FOR EACH ROW EXECUTE FUNCTION preneura_project_attribution_guard();

CREATE FUNCTION preneura_buyer_attribution_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(NEW.tenant_id,NEW.user_id,NEW.source,NEW.broker_company_id,NEW.broker_agent_user_id) IS DISTINCT FROM ROW(OLD.tenant_id,OLD.user_id,OLD.source,OLD.broker_company_id,OLD.broker_agent_user_id) THEN
    RAISE EXCEPTION 'buyer identity/default attribution cannot be changed directly; use the approved project transfer'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER buyer_profiles_attribution_authority BEFORE UPDATE ON buyer_profiles FOR EACH ROW EXECUTE FUNCTION preneura_buyer_attribution_guard();

CREATE FUNCTION preneura_project_initial_attribution_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.attribution_revision<>0 THEN RAISE EXCEPTION 'new project attribution revision must start at zero'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER buyer_project_initial_attribution_guard BEFORE INSERT ON buyer_project_attributions FOR EACH ROW EXECUTE FUNCTION preneura_project_initial_attribution_guard();

CREATE FUNCTION preneura_apply_attribution_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.event_type='TRANSFER_APPROVED' THEN
    UPDATE buyer_project_attributions SET source='BROKER',broker_company_id=NEW.broker_company_id,broker_agent_user_id=NEW.broker_agent_user_id,
      attribution_revision=NEW.new_revision,updated_at=clock_timestamp()
    WHERE buyer_profile_id=NEW.buyer_profile_id AND tenant_id=NEW.tenant_id AND project_id=NEW.project_id AND attribution_revision=NEW.previous_revision
      AND ROW(source,broker_company_id,broker_agent_user_id)
        IS NOT DISTINCT FROM ROW(NEW.previous_source,NEW.previous_broker_company_id,NEW.previous_broker_agent_user_id);
    IF NOT FOUND THEN RAISE EXCEPTION 'buyer attribution changed after transfer request'; END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER brokerage_history_applies_profile AFTER INSERT ON brokerage_attribution_history FOR EACH ROW EXECUTE FUNCTION preneura_apply_attribution_history();

CREATE FUNCTION preneura_initial_project_attribution() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO brokerage_attribution_history(tenant_id,project_id,buyer_profile_id,broker_company_id,broker_agent_user_id,event_type,actor_user_id,new_revision,projection_transaction_id)
  VALUES(NEW.tenant_id,NEW.project_id,NEW.buyer_profile_id,NEW.broker_company_id,NEW.broker_agent_user_id,'INITIAL',NEW.created_by,0,txid_current());
  RETURN NEW;
END;
$$;
CREATE TRIGGER buyer_project_initial_attribution AFTER INSERT ON buyer_project_attributions FOR EACH ROW EXECUTE FUNCTION preneura_initial_project_attribution();

CREATE OR REPLACE FUNCTION preneura_approve_brokerage_attribution_transfer(p_transfer_id uuid,p_actor_user_id uuid,p_review_note text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v_transfer brokerage_attribution_transfers%ROWTYPE;v_buyer buyer_project_attributions%ROWTYPE;
BEGIN
  SELECT * INTO v_transfer FROM brokerage_attribution_transfers WHERE id=p_transfer_id;
  IF v_transfer.id IS NULL THEN RAISE EXCEPTION 'attribution transfer is not pending'; END IF;
  IF NOT preneura_attribution_reviewer_authorized(p_actor_user_id,v_transfer.tenant_id,v_transfer.project_id) THEN RAISE EXCEPTION 'active developer attribution reviewer is required'; END IF;
  -- Shared identity -> project attribution -> transfer ordering matches profile
  -- registration/reservation. NO KEY UPDATE remains compatible with history/
  -- EOI foreign-key checks while serializing lifecycle changes.
  PERFORM 1 FROM buyer_profiles WHERE id=v_transfer.buyer_profile_id AND tenant_id=v_transfer.tenant_id FOR NO KEY UPDATE;
  SELECT * INTO v_buyer FROM buyer_project_attributions WHERE buyer_profile_id=v_transfer.buyer_profile_id AND tenant_id=v_transfer.tenant_id AND project_id=v_transfer.project_id FOR UPDATE;
  SELECT * INTO v_transfer FROM brokerage_attribution_transfers WHERE id=p_transfer_id FOR UPDATE;
  IF v_transfer.status='APPROVED' AND v_transfer.reviewed_by=p_actor_user_id AND v_transfer.review_note IS NOT DISTINCT FROM p_review_note THEN RETURN p_transfer_id; END IF;
  IF v_transfer.status<>'REQUESTED' THEN RAISE EXCEPTION 'attribution transfer decision is immutable'; END IF;
  IF v_buyer.buyer_profile_id IS NULL OR NOT EXISTS(SELECT 1 FROM buyer_profiles WHERE id=v_transfer.buyer_profile_id AND tenant_id=v_transfer.tenant_id AND status='ACTIVE') OR ROW(v_buyer.source,v_buyer.broker_company_id,v_buyer.broker_agent_user_id,v_buyer.attribution_revision)
    IS DISTINCT FROM ROW(v_transfer.expected_source,v_transfer.from_broker_company_id,v_transfer.from_broker_agent_user_id,v_transfer.expected_revision) THEN
    RAISE EXCEPTION 'buyer attribution changed after transfer request'; END IF;
  IF NOT preneura_attribution_target_eligible(v_transfer.tenant_id,v_transfer.project_id,v_transfer.to_broker_company_id,v_transfer.to_broker_agent_user_id) THEN
    RAISE EXCEPTION 'target brokerage or agent is not eligible for attribution transfer'; END IF;
  UPDATE brokerage_attribution_transfers SET status='APPROVED',reviewed_by=p_actor_user_id,reviewed_at=clock_timestamp(),review_note=p_review_note WHERE id=p_transfer_id;
  RETURN p_transfer_id;
END;
$$;

CREATE FUNCTION preneura_apply_reviewed_attribution_transfer() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status='REQUESTED' AND NEW.status='APPROVED' THEN
    IF NOT EXISTS(SELECT 1 FROM buyer_profiles WHERE id=NEW.buyer_profile_id AND tenant_id=NEW.tenant_id AND status='ACTIVE') THEN
      RAISE EXCEPTION 'active buyer profile is required for attribution transfer'; END IF;
  INSERT INTO brokerage_attribution_history(tenant_id,buyer_profile_id,transfer_id,broker_company_id,broker_agent_user_id,event_type,actor_user_id)
  VALUES(NEW.tenant_id,NEW.buyer_profile_id,NEW.id,NEW.to_broker_company_id,NEW.to_broker_agent_user_id,'TRANSFER_APPROVED',NEW.reviewed_by);
  INSERT INTO domain_outbox_events(tenant_id,project_id,aggregate_type,aggregate_id,event_type,payload)
  VALUES(NEW.tenant_id,NEW.project_id,'BUYER_PROFILE',NEW.buyer_profile_id,'buyer.attribution.transferred',
    jsonb_build_object('transferId',NEW.id,'actorUserId',NEW.reviewed_by,'previousRevision',NEW.expected_revision,
      'newRevision',NEW.expected_revision+1,'brokerCompanyId',NEW.to_broker_company_id,'brokerAgentUserId',NEW.to_broker_agent_user_id));

  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER brokerage_transfer_applies_review AFTER UPDATE ON brokerage_attribution_transfers
FOR EACH ROW EXECUTE FUNCTION preneura_apply_reviewed_attribution_transfer();

CREATE FUNCTION preneura_ensure_eoi_project_attribution() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO buyer_project_attributions(tenant_id,project_id,buyer_profile_id,source,broker_company_id,broker_agent_user_id,created_by)
  SELECT NEW.tenant_id,NEW.project_id,id,source,broker_company_id,broker_agent_user_id,NEW.created_by FROM buyer_profiles
  WHERE id=NEW.buyer_profile_id AND tenant_id=NEW.tenant_id
  ON CONFLICT(buyer_profile_id,project_id) DO NOTHING;
  RETURN NEW;
END;
$$;
CREATE TRIGGER buyer_eois_ensure_project_attribution BEFORE INSERT ON buyer_eois FOR EACH ROW EXECUTE FUNCTION preneura_ensure_eoi_project_attribution();

ALTER TABLE reservations
  ADD COLUMN buyer_source_snapshot text CHECK(buyer_source_snapshot IN('DIRECT','BROKER','INTERNAL')),
  ADD COLUMN broker_company_id_snapshot uuid,
  ADD COLUMN broker_agent_user_id_snapshot uuid REFERENCES users(id) ON DELETE RESTRICT,
  ADD COLUMN attribution_revision_snapshot bigint,
  ADD CONSTRAINT reservation_broker_snapshot_tenant_fk FOREIGN KEY(broker_company_id_snapshot,tenant_id) REFERENCES broker_companies(id,tenant_id) ON DELETE RESTRICT;
-- Existing commission-case ownership is recorded financial evidence. Other
-- legacy deals remain unrecorded, never assigned from today's buyer profile.
UPDATE reservations reservation SET buyer_source_snapshot='BROKER',broker_company_id_snapshot=commission.broker_company_id,
  broker_agent_user_id_snapshot=commission.broker_agent_user_id
FROM transactions transaction JOIN broker_commission_cases commission ON commission.transaction_id=transaction.id
WHERE transaction.reservation_id=reservation.id AND transaction.tenant_id=reservation.tenant_id AND transaction.project_id=reservation.project_id;

CREATE FUNCTION preneura_reservation_attribution_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_buyer buyer_project_attributions%ROWTYPE;
BEGIN
  IF TG_OP='UPDATE' THEN
    IF ROW(NEW.buyer_source_snapshot,NEW.broker_company_id_snapshot,NEW.broker_agent_user_id_snapshot,NEW.attribution_revision_snapshot)
      IS DISTINCT FROM ROW(OLD.buyer_source_snapshot,OLD.broker_company_id_snapshot,OLD.broker_agent_user_id_snapshot,OLD.attribution_revision_snapshot) THEN
      RAISE EXCEPTION 'reservation attribution snapshot is immutable'; END IF;
    RETURN NEW;
  END IF;
  SELECT * INTO v_buyer FROM buyer_project_attributions WHERE buyer_profile_id=NEW.buyer_profile_id AND tenant_id=NEW.tenant_id AND project_id=NEW.project_id FOR SHARE;
  IF v_buyer.buyer_profile_id IS NULL THEN RAISE EXCEPTION 'project buyer registration is required for reservation attribution'; END IF;
  IF NEW.buyer_source_snapshot IS NOT NULL AND ROW(NEW.buyer_source_snapshot,NEW.broker_company_id_snapshot,NEW.broker_agent_user_id_snapshot,NEW.attribution_revision_snapshot)
    IS DISTINCT FROM ROW(v_buyer.source,v_buyer.broker_company_id,v_buyer.broker_agent_user_id,v_buyer.attribution_revision) THEN RAISE EXCEPTION 'reservation attribution must match its buyer'; END IF;
  NEW.buyer_source_snapshot:=v_buyer.source;NEW.broker_company_id_snapshot:=v_buyer.broker_company_id;
  NEW.broker_agent_user_id_snapshot:=v_buyer.broker_agent_user_id;NEW.attribution_revision_snapshot:=v_buyer.attribution_revision;
  RETURN NEW;
END;
$$;
CREATE TRIGGER reservations_attribution_snapshot BEFORE INSERT OR UPDATE ON reservations FOR EACH ROW EXECUTE FUNCTION preneura_reservation_attribution_guard();

CREATE FUNCTION preneura_transaction_buyer_identity_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='UPDATE' AND ROW(NEW.tenant_id,NEW.project_id,NEW.reservation_id,NEW.buyer_profile_id)
    IS DISTINCT FROM ROW(OLD.tenant_id,OLD.project_id,OLD.reservation_id,OLD.buyer_profile_id) THEN RAISE EXCEPTION 'transaction buyer and reservation identity is immutable'; END IF;
  IF NOT EXISTS(SELECT 1 FROM reservations WHERE id=NEW.reservation_id AND tenant_id=NEW.tenant_id AND project_id=NEW.project_id AND buyer_profile_id=NEW.buyer_profile_id) THEN
    RAISE EXCEPTION 'transaction must preserve reservation buyer identity'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER transactions_buyer_identity BEFORE INSERT OR UPDATE ON transactions FOR EACH ROW EXECUTE FUNCTION preneura_transaction_buyer_identity_guard();

CREATE FUNCTION preneura_commission_owner_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(NEW.tenant_id,NEW.project_id,NEW.transaction_id,NEW.broker_company_id,NEW.broker_agent_user_id,NEW.commission_plan_id,NEW.basis_amount,NEW.rate_percent,NEW.commission_amount)
    IS DISTINCT FROM ROW(OLD.tenant_id,OLD.project_id,OLD.transaction_id,OLD.broker_company_id,OLD.broker_agent_user_id,OLD.commission_plan_id,OLD.basis_amount,OLD.rate_percent,OLD.commission_amount) THEN
    RAISE EXCEPTION 'commission deal ownership and pricing evidence is immutable'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER commission_owner_snapshot BEFORE UPDATE ON broker_commission_cases FOR EACH ROW EXECUTE FUNCTION preneura_commission_owner_immutable();

CREATE OR REPLACE FUNCTION create_broker_commission_case_for_transaction()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_broker_company_id uuid;
  v_broker_agent_user_id uuid;
  v_basis_amount numeric(18,2);
  v_plan_id uuid;
  v_rate_percent numeric(7,4);
  v_commission_amount numeric(18,2);
BEGIN
  SELECT
    r.broker_company_id_snapshot,
    r.broker_agent_user_id_snapshot,
    r.quoted_total
  INTO
    v_broker_company_id,
    v_broker_agent_user_id,
    v_basis_amount
  FROM reservations r
  WHERE r.id=NEW.reservation_id AND r.buyer_profile_id=NEW.buyer_profile_id
    AND r.tenant_id=NEW.tenant_id AND r.project_id=NEW.project_id AND r.buyer_source_snapshot='BROKER';

  IF v_broker_company_id IS NULL OR v_basis_amount IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT p.id, p.rate_percent
  INTO v_plan_id, v_rate_percent
  FROM broker_commission_plans p
  WHERE p.tenant_id = NEW.tenant_id
    AND p.project_id = NEW.project_id
    AND p.broker_company_id = v_broker_company_id
    AND p.status = 'ACTIVE'
    AND p.effective_at <= NEW.opened_at
  ORDER BY p.effective_at DESC, p.version_number DESC
  LIMIT 1;

  IF v_plan_id IS NULL THEN
    RETURN NEW;
  END IF;

  v_commission_amount := round(v_basis_amount * v_rate_percent / 100, 2);

  INSERT INTO broker_commission_cases (
    tenant_id,
    project_id,
    transaction_id,
    broker_company_id,
    broker_agent_user_id,
    commission_plan_id,
    basis_amount,
    rate_percent,
    commission_amount,
    status,
    completion_percent_snapshot
  ) VALUES (
    NEW.tenant_id,
    NEW.project_id,
    NEW.id,
    v_broker_company_id,
    v_broker_agent_user_id,
    v_plan_id,
    v_basis_amount,
    v_rate_percent,
    v_commission_amount,
    'PENDING_PREREQUISITES',
    0
  )
  ON CONFLICT (transaction_id) DO NOTHING;

  PERFORM refresh_broker_commission_case(NEW.id);
  RETURN NEW;
END;
$$;



UPDATE platform_runtime_contract SET schema_version=48,minimum_runtime_version=48,migration_marker='0048_buyer_attribution_authority',updated_at=now() WHERE singleton_key='production';
COMMIT;
