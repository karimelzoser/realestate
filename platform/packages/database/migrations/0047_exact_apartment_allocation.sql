BEGIN;

ALTER TABLE inventory_slots ADD CONSTRAINT inventory_slots_exact_mapping_identity
  UNIQUE (id, tenant_id, project_id, unit_type_id, physical_unit_id);

CREATE TABLE allocation_quotes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  queue_entry_id uuid NOT NULL,
  buyer_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  allocator_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  unit_type_id uuid NOT NULL,
  physical_unit_id uuid NOT NULL,
  inventory_slot_id uuid NOT NULL,
  pricing_version_id uuid NOT NULL,
  quoted_total numeric(18,2) NOT NULL CHECK (quoted_total >= 0),
  currency char(3) NOT NULL,
  apartment_snapshot jsonb NOT NULL,
  price_components jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  valid_until timestamptz NOT NULL,
  FOREIGN KEY (queue_entry_id, tenant_id, project_id) REFERENCES queue_entries(id, tenant_id, project_id) ON DELETE RESTRICT,
  FOREIGN KEY (inventory_slot_id, tenant_id, project_id, unit_type_id, physical_unit_id)
    REFERENCES inventory_slots(id, tenant_id, project_id, unit_type_id, physical_unit_id) ON DELETE RESTRICT,
  FOREIGN KEY (pricing_version_id, tenant_id, project_id) REFERENCES pricing_versions(id, tenant_id, project_id) ON DELETE RESTRICT,
  UNIQUE (id, tenant_id, project_id, unit_type_id, inventory_slot_id, physical_unit_id),
  CHECK (valid_until > created_at)
);
CREATE INDEX allocation_quotes_session ON allocation_quotes(queue_entry_id, allocator_user_id, created_at DESC);

ALTER TABLE inventory_locks
  ADD COLUMN physical_unit_id uuid,
  ADD COLUMN allocation_quote_id uuid,
  ADD CONSTRAINT inventory_locks_exact_quote_fk
    FOREIGN KEY (allocation_quote_id, tenant_id, project_id, unit_type_id, inventory_slot_id, physical_unit_id)
    REFERENCES allocation_quotes(id, tenant_id, project_id, unit_type_id, inventory_slot_id, physical_unit_id) ON DELETE RESTRICT,
  ADD CONSTRAINT inventory_locks_exact_quote_pair CHECK (allocation_quote_id IS NULL OR physical_unit_id IS NOT NULL);

ALTER TABLE reservations
  ADD COLUMN physical_unit_id uuid,
  ADD COLUMN allocation_quote_id uuid,
  ADD COLUMN apartment_snapshot jsonb,
  ADD CONSTRAINT reservations_exact_quote_fk
    FOREIGN KEY (allocation_quote_id, tenant_id, project_id, unit_type_id, inventory_slot_id, physical_unit_id)
    REFERENCES allocation_quotes(id, tenant_id, project_id, unit_type_id, inventory_slot_id, physical_unit_id) ON DELETE RESTRICT;

CREATE TABLE allocation_lock_requests (
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  actor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  idempotency_key uuid NOT NULL,
  quote_id uuid NOT NULL REFERENCES allocation_quotes(id) ON DELETE RESTRICT,
  ttl_seconds integer NOT NULL CHECK (ttl_seconds BETWEEN 60 AND 900),
  lock_id uuid NOT NULL UNIQUE REFERENCES inventory_locks(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id, project_id, actor_user_id, idempotency_key)
);

CREATE FUNCTION preneura_exact_allocation_evidence_immutable()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'exact allocation evidence is immutable'; END;
$$;
CREATE TRIGGER allocation_quotes_immutable BEFORE UPDATE OR DELETE ON allocation_quotes
FOR EACH ROW EXECUTE FUNCTION preneura_exact_allocation_evidence_immutable();
CREATE TRIGGER allocation_lock_requests_immutable BEFORE UPDATE OR DELETE ON allocation_lock_requests
FOR EACH ROW EXECUTE FUNCTION preneura_exact_allocation_evidence_immutable();

-- This shared predicate never chooses a replacement apartment or an anonymous slot.
CREATE FUNCTION preneura_exact_apartment_eligible(
  p_tenant uuid, p_project uuid, p_queue uuid, p_actor uuid, p_physical uuid, p_converting boolean DEFAULT false
) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM queue_entries q
    JOIN buyer_eois e ON e.id=q.eoi_id AND e.tenant_id=q.tenant_id AND e.project_id=q.project_id
    JOIN buyer_profiles bp ON bp.id=q.buyer_profile_id AND bp.tenant_id=q.tenant_id
    JOIN users buyer ON buyer.id=bp.user_id AND buyer.status='ACTIVE'
    JOIN tenant_memberships buyer_member ON buyer_member.user_id=buyer.id AND buyer_member.tenant_id=q.tenant_id AND buyer_member.status='ACTIVE'
    JOIN projects project ON project.id=q.project_id AND project.tenant_id=q.tenant_id AND project.status='ACTIVE'
    JOIN tenants tenant ON tenant.id=q.tenant_id AND tenant.status='ACTIVE'
    JOIN users actor ON actor.id=p_actor AND actor.status='ACTIVE'
    JOIN tenant_memberships actor_member ON actor_member.user_id=actor.id AND actor_member.tenant_id=q.tenant_id AND actor_member.status='ACTIVE'
    JOIN physical_units pu ON pu.id=p_physical AND pu.tenant_id=q.tenant_id AND pu.project_id=q.project_id
      AND pu.unit_type_id=e.selected_unit_type_id AND pu.status='ACTIVE' AND nullif(trim(pu.display_reference),'') IS NOT NULL
    JOIN catalog_unit_types ut ON ut.id=pu.unit_type_id AND ut.tenant_id=q.tenant_id AND ut.project_id=q.project_id AND ut.status='ACTIVE'
    JOIN project_buildings b ON b.id=pu.building_id AND b.tenant_id=q.tenant_id AND b.project_id=q.project_id AND b.status='ACTIVE'
    JOIN project_floors f ON f.id=pu.floor_id AND f.building_id=b.id AND f.tenant_id=q.tenant_id AND f.project_id=q.project_id AND f.status='ACTIVE'
    LEFT JOIN project_phases phase ON phase.id=b.phase_id AND phase.tenant_id=q.tenant_id AND phase.project_id=q.project_id
    WHERE q.id=p_queue AND q.tenant_id=p_tenant AND q.project_id=p_project
      AND q.allocator_user_id=p_actor
      AND ((NOT p_converting AND q.status='CALLED' AND q.allocation_lock_id IS NULL)
        OR (p_converting AND q.status='LOCKED' AND q.allocation_lock_id IS NOT NULL))
      AND e.buyer_profile_id=bp.id AND e.status='PAID' AND (e.expires_at IS NULL OR e.expires_at>clock_timestamp())
      AND bp.status='ACTIVE' AND (b.phase_id IS NULL OR phase.status='ACTIVE')
      AND EXISTS (SELECT 1 FROM access_role_assignments buyer_role WHERE buyer_role.user_id=buyer.id
        AND buyer_role.tenant_id=q.tenant_id AND buyer_role.project_id=q.project_id AND buyer_role.role_code='BUYER'
        AND buyer_role.scope_type='PROJECT' AND buyer_role.status='ACTIVE' AND buyer_role.revoked_at IS NULL)
      AND EXISTS (SELECT 1 FROM access_role_assignments a WHERE a.user_id=p_actor AND a.tenant_id=q.tenant_id
        AND a.project_id=q.project_id AND a.role_code='ALLOCATOR' AND a.scope_type='PROJECT' AND a.status='ACTIVE' AND a.revoked_at IS NULL)
  );
$$;

CREATE FUNCTION preneura_quote_exact_apartment(p_tenant uuid,p_project uuid,p_queue uuid,p_actor uuid,p_physical uuid)
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v_queue queue_entries%ROWTYPE; v_price uuid; v_slot uuid; v_type uuid;
  v_buyer uuid; v_total numeric(18,2); v_currency char(3); v_snapshot jsonb; v_components jsonb; v_quote uuid; v_now timestamptz;
BEGIN
  PERFORM 1 FROM projects WHERE id=p_project AND tenant_id=p_tenant FOR SHARE;
  SELECT * INTO v_queue FROM queue_entries WHERE id=p_queue AND tenant_id=p_tenant AND project_id=p_project FOR SHARE;
  IF NOT preneura_exact_apartment_eligible(p_tenant,p_project,p_queue,p_actor,p_physical) THEN
    RAISE EXCEPTION 'apartment is not eligible for this assigned buyer session';
  END IF;
  SELECT s.id,pu.unit_type_id,bp.user_id,project.currency,
    jsonb_build_object('physicalUnitId',pu.id,'apartmentReference',pu.display_reference,
      'buildingId',b.id,'buildingCode',b.code,'buildingName',b.name,'floorId',f.id,'floorCode',f.code,'floorName',f.name,
      'floorLevel',f.level_number,'orientation',pu.orientation,'viewCode',pu.view_code,'unitTypeId',ut.id,'unitTypeCode',ut.code,'unitTypeName',ut.name)
  INTO v_slot,v_type,v_buyer,v_currency,v_snapshot
  FROM physical_units pu
  JOIN inventory_slots s ON s.physical_unit_id=pu.id AND s.tenant_id=pu.tenant_id AND s.project_id=pu.project_id AND s.unit_type_id=pu.unit_type_id
  JOIN project_buildings b ON b.id=pu.building_id
  JOIN project_floors f ON f.id=pu.floor_id
  JOIN catalog_unit_types ut ON ut.id=pu.unit_type_id
  JOIN projects project ON project.id=pu.project_id
  JOIN buyer_profiles bp ON bp.id=v_queue.buyer_profile_id
  WHERE pu.id=p_physical AND pu.tenant_id=p_tenant AND pu.project_id=p_project AND s.state='AVAILABLE'
  FOR SHARE OF pu,s,b,f,ut;
  IF v_slot IS NULL THEN RAISE EXCEPTION 'requested apartment is not mapped to available inventory'; END IF;
  v_now:=clock_timestamp();
  IF EXISTS (SELECT 1 FROM inventory_locks WHERE inventory_slot_id=v_slot AND status='ACTIVE' AND expires_at>v_now) THEN
    RAISE EXCEPTION 'requested apartment is already held';
  END IF;
  SELECT id INTO v_price FROM pricing_versions WHERE tenant_id=p_tenant AND project_id=p_project
    AND status IN ('PUBLISHED','SCHEDULED') AND published_at IS NOT NULL AND effective_at<=v_now
  ORDER BY effective_at DESC,version_number DESC LIMIT 1 FOR SHARE;
  v_total:=calculate_unit_type_price(v_price,v_type);
  IF v_price IS NULL OR v_total IS NULL THEN RAISE EXCEPTION 'certified effective apartment pricing is unavailable'; END IF;
  SELECT jsonb_agg(jsonb_build_object('component',component,'areaSqm',area_sqm::text,'ratePerSqm',rate_per_sqm::text,
    'amount',round(area_sqm*rate_per_sqm,2)::text) ORDER BY component)
  INTO v_components FROM pricing_rates WHERE pricing_version_id=v_price AND unit_type_id=v_type;
  INSERT INTO allocation_quotes(tenant_id,project_id,queue_entry_id,buyer_user_id,allocator_user_id,unit_type_id,
    physical_unit_id,inventory_slot_id,pricing_version_id,quoted_total,currency,apartment_snapshot,price_components,created_at,valid_until)
  VALUES(p_tenant,p_project,p_queue,v_buyer,p_actor,v_type,p_physical,v_slot,v_price,v_total,v_currency,v_snapshot,v_components,v_now,v_now+interval '5 minutes')
  RETURNING id INTO v_quote;
  RETURN v_quote;
END;
$$;

CREATE FUNCTION preneura_create_exact_allocation_lock(p_tenant uuid,p_project uuid,p_actor uuid,p_quote uuid,p_key uuid,p_ttl integer DEFAULT 900)
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v_quote allocation_quotes%ROWTYPE; v_request allocation_lock_requests%ROWTYPE;
  v_queue queue_entries%ROWTYPE; v_slot uuid; v_lock uuid; v_current_price uuid; v_now timestamptz;
BEGIN
  IF p_ttl IS NULL OR p_ttl<60 OR p_ttl>900 OR p_key IS NULL THEN RAISE EXCEPTION 'invalid exact lock TTL or idempotency key'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_tenant::text||p_project::text||p_actor::text||p_key::text,0));
  SELECT * INTO v_request FROM allocation_lock_requests WHERE tenant_id=p_tenant AND project_id=p_project AND actor_user_id=p_actor AND idempotency_key=p_key;
  IF v_request.lock_id IS NOT NULL THEN
    IF v_request.quote_id<>p_quote OR v_request.ttl_seconds<>p_ttl THEN RAISE EXCEPTION 'idempotency key belongs to a different lock request'; END IF;
    RETURN v_request.lock_id;
  END IF;
  SELECT * INTO v_quote FROM allocation_quotes WHERE id=p_quote AND tenant_id=p_tenant AND project_id=p_project AND allocator_user_id=p_actor;
  IF v_quote.id IS NULL THEN RAISE EXCEPTION 'exact quote is not owned by this allocator project'; END IF;
  SELECT * INTO v_queue FROM queue_entries WHERE id=v_quote.queue_entry_id AND tenant_id=p_tenant AND project_id=p_project FOR UPDATE;
  PERFORM 1 FROM projects WHERE id=p_project AND tenant_id=p_tenant FOR SHARE;
  v_now:=clock_timestamp();
  IF v_quote.valid_until<=v_now THEN RAISE EXCEPTION 'exact quote expired; review a fresh quote'; END IF;
  IF NOT preneura_exact_apartment_eligible(p_tenant,p_project,v_quote.queue_entry_id,p_actor,v_quote.physical_unit_id) THEN
    RAISE EXCEPTION 'apartment is no longer eligible for this assigned buyer session';
  END IF;
  SELECT id INTO v_current_price FROM pricing_versions WHERE tenant_id=p_tenant AND project_id=p_project
    AND status IN ('PUBLISHED','SCHEDULED') AND published_at IS NOT NULL AND effective_at<=v_now
  ORDER BY effective_at DESC,version_number DESC LIMIT 1 FOR SHARE;
  IF v_current_price IS DISTINCT FROM v_quote.pricing_version_id THEN RAISE EXCEPTION 'apartment pricing changed; review a fresh quote'; END IF;
  SELECT id INTO v_slot FROM inventory_slots WHERE id=v_quote.inventory_slot_id AND physical_unit_id=v_quote.physical_unit_id
    AND tenant_id=p_tenant AND project_id=p_project AND unit_type_id=v_quote.unit_type_id AND state='AVAILABLE'
  FOR UPDATE SKIP LOCKED;
  IF v_slot IS NULL THEN RAISE EXCEPTION 'requested apartment is unavailable or contested'; END IF;
  -- Reclaim only already expired locks on the requested slot. Concurrent expiry
  -- or lock ownership never permits another slot to be substituted.
  UPDATE inventory_locks SET status='EXPIRED',released_at=v_now,release_reason='TTL_EXPIRED',updated_at=v_now
  WHERE id IN (SELECT id FROM inventory_locks WHERE inventory_slot_id=v_slot AND status='ACTIVE' AND expires_at<=v_now FOR UPDATE SKIP LOCKED);
  IF EXISTS(SELECT 1 FROM inventory_locks WHERE inventory_slot_id=v_slot AND status='ACTIVE') THEN RAISE EXCEPTION 'requested apartment is already held'; END IF;
  INSERT INTO inventory_locks(tenant_id,project_id,unit_type_id,inventory_slot_id,buyer_user_id,locked_by_user_id,status,expires_at,physical_unit_id,allocation_quote_id,created_at)
  VALUES(p_tenant,p_project,v_quote.unit_type_id,v_slot,v_quote.buyer_user_id,p_actor,'ACTIVE',v_now+make_interval(secs=>p_ttl),v_quote.physical_unit_id,p_quote,v_now)
  RETURNING id INTO v_lock;
  INSERT INTO allocation_lock_requests(tenant_id,project_id,actor_user_id,idempotency_key,quote_id,ttl_seconds,lock_id)
  VALUES(p_tenant,p_project,p_actor,p_key,p_quote,p_ttl,v_lock);
  INSERT INTO domain_outbox_events(tenant_id,project_id,aggregate_type,aggregate_id,event_type,payload)
  VALUES(p_tenant,p_project,'INVENTORY_LOCK',v_lock,'inventory.exact_lock.created',jsonb_build_object('physicalUnitId',v_quote.physical_unit_id,
    'unitTypeId',v_quote.unit_type_id,'queueEntryId',v_quote.queue_entry_id,'buyerUserId',v_quote.buyer_user_id,'allocatorUserId',p_actor,
    'quoteId',p_quote,'quotedTotal',v_quote.quoted_total::text,'currency',v_quote.currency,'expiresAt',v_now+make_interval(secs=>p_ttl)));
  RETURN v_lock;
END;
$$;

CREATE FUNCTION preneura_exact_lock_identity_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(NEW.tenant_id,NEW.project_id,NEW.unit_type_id,NEW.inventory_slot_id,NEW.buyer_user_id,NEW.locked_by_user_id,NEW.physical_unit_id,NEW.allocation_quote_id)
    IS DISTINCT FROM ROW(OLD.tenant_id,OLD.project_id,OLD.unit_type_id,OLD.inventory_slot_id,OLD.buyer_user_id,OLD.locked_by_user_id,OLD.physical_unit_id,OLD.allocation_quote_id) THEN
    RAISE EXCEPTION 'inventory lock commercial identity is immutable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER inventory_locks_identity_immutable BEFORE UPDATE ON inventory_locks
FOR EACH ROW EXECUTE FUNCTION preneura_exact_lock_identity_guard();

CREATE FUNCTION preneura_validate_exact_quote() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_type uuid; v_buyer uuid; v_slot uuid; v_price uuid; v_currency char(3); v_total numeric(18,2); v_snapshot jsonb;
BEGIN
  IF NOT preneura_exact_apartment_eligible(NEW.tenant_id,NEW.project_id,NEW.queue_entry_id,NEW.allocator_user_id,NEW.physical_unit_id) THEN
    RAISE EXCEPTION 'exact quote requires an eligible assigned buyer and apartment';
  END IF;
  SELECT pu.unit_type_id,bp.user_id,s.id,p.currency,
    jsonb_build_object('physicalUnitId',pu.id,'apartmentReference',pu.display_reference,
      'buildingId',b.id,'buildingCode',b.code,'buildingName',b.name,'floorId',f.id,'floorCode',f.code,'floorName',f.name,
      'floorLevel',f.level_number,'orientation',pu.orientation,'viewCode',pu.view_code,'unitTypeId',ut.id,'unitTypeCode',ut.code,'unitTypeName',ut.name)
  INTO v_type,v_buyer,v_slot,v_currency,v_snapshot
  FROM physical_units pu JOIN inventory_slots s ON s.physical_unit_id=pu.id AND s.unit_type_id=pu.unit_type_id
    AND s.tenant_id=pu.tenant_id AND s.project_id=pu.project_id AND s.state='AVAILABLE'
  JOIN project_buildings b ON b.id=pu.building_id JOIN project_floors f ON f.id=pu.floor_id
  JOIN catalog_unit_types ut ON ut.id=pu.unit_type_id JOIN projects p ON p.id=pu.project_id
  JOIN queue_entries q ON q.id=NEW.queue_entry_id JOIN buyer_profiles bp ON bp.id=q.buyer_profile_id
  WHERE pu.id=NEW.physical_unit_id AND pu.tenant_id=NEW.tenant_id AND pu.project_id=NEW.project_id;
  IF v_slot IS NULL OR ROW(NEW.unit_type_id,NEW.buyer_user_id,NEW.inventory_slot_id,NEW.currency)
    IS DISTINCT FROM ROW(v_type,v_buyer,v_slot,v_currency) THEN RAISE EXCEPTION 'exact quote apartment/buyer/mapping identity mismatch'; END IF;
  SELECT id INTO v_price FROM pricing_versions WHERE tenant_id=NEW.tenant_id AND project_id=NEW.project_id
    AND status IN ('PUBLISHED','SCHEDULED') AND published_at IS NOT NULL AND effective_at<=clock_timestamp()
  ORDER BY effective_at DESC,version_number DESC LIMIT 1;
  v_total:=calculate_unit_type_price(v_price,v_type);
  IF v_total IS NULL OR NEW.pricing_version_id IS DISTINCT FROM v_price OR NEW.quoted_total IS DISTINCT FROM v_total THEN
    RAISE EXCEPTION 'exact quote must match current certified pricing';
  END IF;
  NEW.apartment_snapshot:=v_snapshot;
  SELECT jsonb_agg(jsonb_build_object('component',component,'areaSqm',area_sqm::text,'ratePerSqm',rate_per_sqm::text,
    'amount',round(area_sqm*rate_per_sqm,2)::text) ORDER BY component)
  INTO NEW.price_components FROM pricing_rates WHERE pricing_version_id=v_price AND unit_type_id=v_type;
  NEW.created_at:=clock_timestamp(); NEW.valid_until:=NEW.created_at+interval '5 minutes';
  RETURN NEW;
END;
$$;
CREATE TRIGGER allocation_quotes_scope_pricing_guard BEFORE INSERT ON allocation_quotes
FOR EACH ROW EXECUTE FUNCTION preneura_validate_exact_quote();

CREATE FUNCTION preneura_quoted_apartment_identity_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(NEW.tenant_id,NEW.project_id,NEW.building_id,NEW.floor_id,NEW.unit_type_id,NEW.internal_reference,NEW.display_reference,NEW.orientation,NEW.view_code,NEW.corner_position)
    IS DISTINCT FROM ROW(OLD.tenant_id,OLD.project_id,OLD.building_id,OLD.floor_id,OLD.unit_type_id,OLD.internal_reference,OLD.display_reference,OLD.orientation,OLD.view_code,OLD.corner_position)
    AND EXISTS(SELECT 1 FROM allocation_quotes WHERE physical_unit_id=OLD.id) THEN
    RAISE EXCEPTION 'quoted apartment commercial identity is immutable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER quoted_apartment_identity_immutable BEFORE UPDATE ON physical_units
FOR EACH ROW EXECUTE FUNCTION preneura_quoted_apartment_identity_guard();

CREATE FUNCTION preneura_exact_reservation_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_quote allocation_quotes%ROWTYPE; v_lock inventory_locks%ROWTYPE;
BEGIN
  IF TG_OP='UPDATE' THEN
    IF ROW(NEW.physical_unit_id,NEW.allocation_quote_id,NEW.apartment_snapshot,NEW.inventory_lock_id,NEW.inventory_slot_id,NEW.queue_entry_id,NEW.buyer_profile_id,NEW.tenant_id,NEW.project_id)
      IS DISTINCT FROM ROW(OLD.physical_unit_id,OLD.allocation_quote_id,OLD.apartment_snapshot,OLD.inventory_lock_id,OLD.inventory_slot_id,OLD.queue_entry_id,OLD.buyer_profile_id,OLD.tenant_id,OLD.project_id) THEN
      RAISE EXCEPTION 'reservation apartment and buyer evidence is immutable';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.allocation_quote_id IS NULL THEN RETURN NEW; END IF; -- Explicitly retained historical domain fixtures.
  SELECT * INTO v_quote FROM allocation_quotes WHERE id=NEW.allocation_quote_id;
  SELECT * INTO v_lock FROM inventory_locks WHERE id=NEW.inventory_lock_id;
  IF NOT preneura_exact_apartment_eligible(NEW.tenant_id,NEW.project_id,NEW.queue_entry_id,NEW.reserved_by,NEW.physical_unit_id,true) THEN
    RAISE EXCEPTION 'exact apartment reservation eligibility changed';
  END IF;
  IF v_quote.id IS NULL OR v_lock.id IS NULL OR v_lock.allocation_quote_id IS DISTINCT FROM v_quote.id
    OR v_lock.status<>'CONVERTED' OR v_lock.expires_at<=NEW.reserved_at
    OR v_quote.valid_until<=v_lock.created_at OR v_quote.created_at>v_lock.created_at
    OR ROW(NEW.tenant_id,NEW.project_id,NEW.unit_type_id,NEW.physical_unit_id,NEW.inventory_slot_id,NEW.queue_entry_id,NEW.reserved_by,NEW.pricing_version_id,NEW.quoted_total,NEW.currency)
      IS DISTINCT FROM ROW(v_quote.tenant_id,v_quote.project_id,v_quote.unit_type_id,v_quote.physical_unit_id,v_quote.inventory_slot_id,v_quote.queue_entry_id,v_quote.allocator_user_id,v_quote.pricing_version_id,v_quote.quoted_total,v_quote.currency)
    OR NOT EXISTS(SELECT 1 FROM buyer_profiles WHERE id=NEW.buyer_profile_id AND tenant_id=NEW.tenant_id AND user_id=v_quote.buyer_user_id) THEN
    RAISE EXCEPTION 'reservation must preserve the owned exact apartment and accepted lock quote';
  END IF;
  NEW.apartment_snapshot:=v_quote.apartment_snapshot;
  RETURN NEW;
END;
$$;
CREATE TRIGGER reservations_exact_evidence_guard BEFORE INSERT OR UPDATE ON reservations
FOR EACH ROW EXECUTE FUNCTION preneura_exact_reservation_guard();

-- A valid exact hold retains its accepted immutable quote if the version is
-- retired while the buyer completes the short handoff. Legacy pricing remains
-- governed by its existing effective-publication requirements.
CREATE OR REPLACE FUNCTION preneura_validate_reservation_price() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_expected numeric(18,2); v_currency char(3); v_status text; v_effective_at timestamptz; v_published_at timestamptz;
BEGIN
  IF TG_OP='UPDATE' THEN
    IF ROW(NEW.pricing_version_id,NEW.unit_type_id,NEW.quoted_total,NEW.currency)
      IS DISTINCT FROM ROW(OLD.pricing_version_id,OLD.unit_type_id,OLD.quoted_total,OLD.currency) THEN
      RAISE EXCEPTION 'reservation pricing snapshot is immutable';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.pricing_version_id IS NULL OR NEW.quoted_total IS NULL THEN RAISE EXCEPTION 'new reservations require a pricing version and quoted total'; END IF;
  SELECT pv.status,pv.effective_at,pv.published_at,p.currency INTO v_status,v_effective_at,v_published_at,v_currency
  FROM pricing_versions pv JOIN projects p ON p.id=pv.project_id AND p.tenant_id=pv.tenant_id
  WHERE pv.id=NEW.pricing_version_id AND pv.tenant_id=NEW.tenant_id AND pv.project_id=NEW.project_id;
  IF NOT FOUND OR v_published_at IS NULL OR v_effective_at>NEW.reserved_at
    OR (NEW.allocation_quote_id IS NULL AND v_status NOT IN ('PUBLISHED','SCHEDULED'))
    OR (NEW.allocation_quote_id IS NOT NULL AND v_status NOT IN ('PUBLISHED','SCHEDULED','SUPERSEDED')) THEN
    RAISE EXCEPTION 'reservation must use an effective published pricing version';
  END IF;
  IF NEW.currency<>v_currency THEN RAISE EXCEPTION 'reservation currency must match project currency'; END IF;
  v_expected:=calculate_unit_type_price(NEW.pricing_version_id,NEW.unit_type_id);
  IF v_expected IS NULL OR round(NEW.quoted_total,2)<>v_expected THEN RAISE EXCEPTION 'reservation quoted total does not match canonical pricing'; END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION preneura_capture_contract_execution(p_document_id uuid, p_allow_legacy boolean DEFAULT false)
RETURNS uuid
LANGUAGE plpgsql
AS $$
DECLARE
  v_doc record;
  v_prices jsonb;
  v_signatures jsonb;
  v_manifest jsonb;
  v_hash text;
  v_snapshot_id uuid;
BEGIN
  SELECT
    d.id AS document_id,
    d.tenant_id,
    d.project_id,
    d.transaction_id,
    d.sha256_hex AS document_sha256_hex,
    d.stamped_at,
    d.stamped_by,
    trust.status AS object_trust_status,
    d.template_id,
    tpl.version_number AS template_version_number,
    tpl.sha256_hex AS template_sha256_hex,
    t.reservation_id,
    r.pricing_version_id,
    r.quoted_total,
    r.currency,
    r.physical_unit_id,
    r.allocation_quote_id,
    r.apartment_snapshot
  INTO v_doc
  FROM transaction_documents d
  JOIN transactions t ON t.id = d.transaction_id
    AND t.tenant_id = d.tenant_id AND t.project_id = d.project_id
  JOIN reservations r ON r.id = t.reservation_id
    AND r.tenant_id = t.tenant_id AND r.project_id = t.project_id
  JOIN document_templates tpl ON tpl.id = d.template_id
  LEFT JOIN storage_object_trust trust ON trust.id = d.object_trust_id
  WHERE d.id = p_document_id
    AND d.category = 'CONTRACT'
    AND d.status = 'STAMPED';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'stamped contract not found for execution snapshot';
  END IF;
  IF v_doc.pricing_version_id IS NULL OR v_doc.quoted_total IS NULL THEN
    RAISE EXCEPTION 'executed contract requires certified reservation pricing';
  END IF;
  IF v_doc.object_trust_status <> 'CLEAN' AND NOT (p_allow_legacy AND v_doc.object_trust_status = 'LEGACY_UNSCANNED') THEN
    RAISE EXCEPTION 'executed contract requires CLEAN object trust';
  END IF;

  SELECT jsonb_agg(
    jsonb_build_object(
      'component', c.component,
      'areaSqm', c.area_sqm::text,
      'ratePerSqm', c.rate_per_sqm::text,
      'amount', c.amount::text
    ) ORDER BY CASE c.component WHEN 'INDOOR' THEN 1 WHEN 'ROOF' THEN 2 ELSE 3 END
  ) INTO v_prices
  FROM reservation_price_components c
  WHERE c.reservation_id = v_doc.reservation_id;

  IF jsonb_array_length(COALESCE(v_prices, '[]'::jsonb)) <> 3 THEN
    RAISE EXCEPTION 'executed contract requires complete certified price components';
  END IF;

  SELECT jsonb_agg(
    jsonb_build_object(
      'signerRole', s.signer_role,
      'signerUserId', s.signer_user_id,
      'method', s.method,
      'typedName', s.typed_name,
      'signatureSha256Hex', s.signature_sha256_hex,
      'provider', s.provider,
      'providerEnvelopeId', s.provider_envelope_id,
      'signedAt', s.signed_at
    ) ORDER BY req.signing_order, s.signer_role
  ) INTO v_signatures
  FROM document_signatures s
  JOIN document_template_signer_requirements req
    ON req.template_id = v_doc.template_id AND req.signer_role = s.signer_role
  WHERE s.document_id = v_doc.document_id;

  IF v_signatures IS NULL THEN
    RAISE EXCEPTION 'executed contract requires signature evidence';
  END IF;

  v_manifest := jsonb_build_object(
    'schemaVersion', 1,
    'tenantId', v_doc.tenant_id,
    'projectId', v_doc.project_id,
    'transactionId', v_doc.transaction_id,
    'reservationId', v_doc.reservation_id,
    'documentId', v_doc.document_id,
    'documentSha256Hex', v_doc.document_sha256_hex,
    'objectTrustStatus', v_doc.object_trust_status,
    'templateId', v_doc.template_id,
    'templateVersionNumber', v_doc.template_version_number,
    'templateSha256Hex', v_doc.template_sha256_hex,
    'pricingVersionId', v_doc.pricing_version_id,
    'quotedTotal', v_doc.quoted_total::text,
    'currency', v_doc.currency,
    'priceComponents', v_prices,
    'signatures', v_signatures,
    'executedAt', v_doc.stamped_at,
    'executedBy', v_doc.stamped_by
  );
  IF v_doc.allocation_quote_id IS NOT NULL THEN
    v_manifest := v_manifest || jsonb_build_object('schemaVersion',2,'physicalUnitId',v_doc.physical_unit_id,
      'allocationQuoteId',v_doc.allocation_quote_id,'apartment',v_doc.apartment_snapshot);
  END IF;
  v_hash := encode(digest(convert_to(v_manifest::text, 'UTF8'), 'sha256'), 'hex');

  INSERT INTO contract_execution_snapshots (
    tenant_id, project_id, transaction_id, reservation_id, document_id,
    document_sha256_hex, object_trust_status, template_id, template_version_number,
    template_sha256_hex, pricing_version_id, quoted_total, currency,
    price_components, signatures, manifest, manifest_sha256_hex, executed_at, executed_by
  ) VALUES (
    v_doc.tenant_id, v_doc.project_id, v_doc.transaction_id, v_doc.reservation_id, v_doc.document_id,
    lower(v_doc.document_sha256_hex), v_doc.object_trust_status, v_doc.template_id, v_doc.template_version_number,
    lower(v_doc.template_sha256_hex), v_doc.pricing_version_id, v_doc.quoted_total, v_doc.currency,
    v_prices, v_signatures, v_manifest, v_hash, v_doc.stamped_at, v_doc.stamped_by
  )
  ON CONFLICT (document_id) DO NOTHING
  RETURNING id INTO v_snapshot_id;

  IF v_snapshot_id IS NULL THEN
    SELECT id INTO v_snapshot_id FROM contract_execution_snapshots WHERE document_id = p_document_id;
  END IF;
  RETURN v_snapshot_id;
END;
$$;

UPDATE platform_runtime_contract SET schema_version=47,minimum_runtime_version=47,
  migration_marker='0047_exact_apartment_allocation',updated_at=now() WHERE singleton_key='production';
COMMIT;
