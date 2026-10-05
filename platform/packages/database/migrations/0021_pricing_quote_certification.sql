BEGIN;

-- Every rate snapshots the priced area so a price version is independent from
-- later catalog geometry changes.
ALTER TABLE pricing_rates
  ADD COLUMN area_sqm numeric(12,2);

UPDATE pricing_rates r
SET area_sqm = CASE r.component
  WHEN 'INDOOR' THEN ut.indoor_area_sqm
  WHEN 'ROOF' THEN ut.roof_area_sqm
  WHEN 'GARDEN' THEN ut.garden_area_sqm
END
FROM catalog_unit_types ut
WHERE ut.id = r.unit_type_id
  AND ut.tenant_id = r.tenant_id
  AND ut.project_id = r.project_id;

ALTER TABLE pricing_rates
  ALTER COLUMN area_sqm SET NOT NULL,
  ADD CONSTRAINT pricing_rates_area_nonnegative CHECK (area_sqm >= 0);

CREATE OR REPLACE FUNCTION preneura_set_pricing_rate_area()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_area numeric(12,2);
BEGIN
  SELECT CASE NEW.component
    WHEN 'INDOOR' THEN ut.indoor_area_sqm
    WHEN 'ROOF' THEN ut.roof_area_sqm
    WHEN 'GARDEN' THEN ut.garden_area_sqm
  END
  INTO v_area
  FROM catalog_unit_types ut
  WHERE ut.id = NEW.unit_type_id
    AND ut.tenant_id = NEW.tenant_id
    AND ut.project_id = NEW.project_id;

  IF NOT FOUND OR v_area IS NULL THEN
    RAISE EXCEPTION 'pricing rate unit type/component does not resolve to a project area';
  END IF;

  NEW.area_sqm := v_area;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_pricing_rates_20_snapshot_area
BEFORE INSERT OR UPDATE OF unit_type_id, component ON pricing_rates
FOR EACH ROW EXECUTE FUNCTION preneura_set_pricing_rate_area();

CREATE OR REPLACE FUNCTION preneura_pricing_rate_mutable()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_version_id uuid;
  v_status text;
BEGIN
  v_version_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.pricing_version_id ELSE NEW.pricing_version_id END;
  SELECT status INTO v_status FROM pricing_versions WHERE id = v_version_id;

  -- A cascading delete from an already deleted DRAFT parent may no longer find
  -- the parent row. The pricing-version trigger below protects non-draft parents.
  IF v_status IS NOT NULL AND v_status <> 'DRAFT' THEN
    RAISE EXCEPTION 'pricing rates are immutable once the pricing version leaves DRAFT';
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_pricing_rates_00_mutable
BEFORE INSERT OR UPDATE OR DELETE ON pricing_rates
FOR EACH ROW EXECUTE FUNCTION preneura_pricing_rate_mutable();

CREATE OR REPLACE FUNCTION preneura_pricing_version_immutable()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'DRAFT' THEN
      RAISE EXCEPTION 'non-draft pricing versions are immutable historical records';
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.status <> 'DRAFT' AND (
    NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR
    NEW.project_id IS DISTINCT FROM OLD.project_id OR
    NEW.version_number IS DISTINCT FROM OLD.version_number OR
    NEW.label IS DISTINCT FROM OLD.label OR
    NEW.effective_at IS DISTINCT FROM OLD.effective_at
  ) THEN
    RAISE EXCEPTION 'published/scheduled pricing version identity and effective terms are immutable';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_pricing_versions_immutable
BEFORE UPDATE OR DELETE ON pricing_versions
FOR EACH ROW EXECUTE FUNCTION preneura_pricing_version_immutable();

-- Draft catalog area corrections propagate into draft rate snapshots. Once any
-- version using the unit type leaves DRAFT, geometry becomes historical pricing
-- input and must be changed by creating a new versioned commercial definition.
CREATE OR REPLACE FUNCTION preneura_unit_type_priced_area_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.indoor_area_sqm IS NOT DISTINCT FROM OLD.indoor_area_sqm
     AND NEW.roof_area_sqm IS NOT DISTINCT FROM OLD.roof_area_sqm
     AND NEW.garden_area_sqm IS NOT DISTINCT FROM OLD.garden_area_sqm THEN
    RETURN NEW;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pricing_rates r
    JOIN pricing_versions pv ON pv.id = r.pricing_version_id
    WHERE r.unit_type_id = OLD.id
      AND pv.status <> 'DRAFT'
  ) THEN
    RAISE EXCEPTION 'priced unit-type areas are immutable after pricing publication/scheduling';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_catalog_unit_types_priced_area_guard
BEFORE UPDATE OF indoor_area_sqm, roof_area_sqm, garden_area_sqm ON catalog_unit_types
FOR EACH ROW EXECUTE FUNCTION preneura_unit_type_priced_area_guard();

CREATE OR REPLACE FUNCTION preneura_refresh_draft_pricing_rate_areas()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE pricing_rates r
  SET area_sqm = CASE r.component
    WHEN 'INDOOR' THEN NEW.indoor_area_sqm
    WHEN 'ROOF' THEN NEW.roof_area_sqm
    WHEN 'GARDEN' THEN NEW.garden_area_sqm
  END
  FROM pricing_versions pv
  WHERE r.unit_type_id = NEW.id
    AND pv.id = r.pricing_version_id
    AND pv.status = 'DRAFT';
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_catalog_unit_types_refresh_draft_pricing
AFTER UPDATE OF indoor_area_sqm, roof_area_sqm, garden_area_sqm ON catalog_unit_types
FOR EACH ROW EXECUTE FUNCTION preneura_refresh_draft_pricing_rate_areas();

CREATE OR REPLACE FUNCTION calculate_unit_type_price(
  p_pricing_version_id uuid,
  p_unit_type_id uuid
)
RETURNS numeric(18,2)
LANGUAGE sql
STABLE
STRICT
AS $$
  SELECT CASE
    WHEN count(*) = 3 AND count(DISTINCT r.component) = 3
      THEN round(sum(r.area_sqm * r.rate_per_sqm), 2)::numeric(18,2)
    ELSE NULL
  END
  FROM pricing_rates r
  JOIN pricing_versions pv
    ON pv.id = r.pricing_version_id
   AND pv.tenant_id = r.tenant_id
   AND pv.project_id = r.project_id
  WHERE r.pricing_version_id = p_pricing_version_id
    AND r.unit_type_id = p_unit_type_id;
$$;

CREATE TABLE reservation_price_components (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  reservation_id uuid NOT NULL,
  pricing_version_id uuid NOT NULL,
  unit_type_id uuid NOT NULL,
  component text NOT NULL CHECK (component IN ('INDOOR','ROOF','GARDEN')),
  area_sqm numeric(12,2) NOT NULL CHECK (area_sqm >= 0),
  rate_per_sqm numeric(18,2) NOT NULL CHECK (rate_per_sqm >= 0),
  amount numeric(18,2) NOT NULL CHECK (amount >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (reservation_id, tenant_id, project_id)
    REFERENCES reservations(id, tenant_id, project_id) ON DELETE RESTRICT,
  FOREIGN KEY (pricing_version_id, tenant_id, project_id)
    REFERENCES pricing_versions(id, tenant_id, project_id) ON DELETE RESTRICT,
  FOREIGN KEY (unit_type_id, tenant_id, project_id)
    REFERENCES catalog_unit_types(id, tenant_id, project_id) ON DELETE RESTRICT,
  UNIQUE (reservation_id, component),
  CHECK (amount = round(area_sqm * rate_per_sqm, 2))
);

CREATE INDEX reservation_price_components_reservation
  ON reservation_price_components(reservation_id, component);

-- Upgrade-safe backfill for any reservations created before this migration.
INSERT INTO reservation_price_components (
  tenant_id, project_id, reservation_id, pricing_version_id, unit_type_id,
  component, area_sqm, rate_per_sqm, amount
)
SELECT
  res.tenant_id,
  res.project_id,
  res.id,
  res.pricing_version_id,
  res.unit_type_id,
  r.component,
  r.area_sqm,
  r.rate_per_sqm,
  round(r.area_sqm * r.rate_per_sqm, 2)
FROM reservations res
JOIN pricing_rates r
  ON r.pricing_version_id = res.pricing_version_id
 AND r.unit_type_id = res.unit_type_id
WHERE res.pricing_version_id IS NOT NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM reservations res
    WHERE res.pricing_version_id IS NOT NULL
      AND (
        SELECT count(*) FROM reservation_price_components c WHERE c.reservation_id = res.id
      ) <> 3
  ) THEN
    RAISE EXCEPTION 'existing priced reservation is missing a complete three-component quote snapshot';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM reservations res
    WHERE res.pricing_version_id IS NOT NULL
      AND res.quoted_total IS DISTINCT FROM (
        SELECT round(sum(c.amount), 2)
        FROM reservation_price_components c
        WHERE c.reservation_id = res.id
      )
  ) THEN
    RAISE EXCEPTION 'existing reservation quote does not reconcile to pricing components';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION preneura_validate_reservation_price()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_expected numeric(18,2);
  v_currency char(3);
  v_status text;
  v_effective_at timestamptz;
  v_published_at timestamptz;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.pricing_version_id IS DISTINCT FROM OLD.pricing_version_id
       OR NEW.unit_type_id IS DISTINCT FROM OLD.unit_type_id
       OR NEW.quoted_total IS DISTINCT FROM OLD.quoted_total
       OR NEW.currency IS DISTINCT FROM OLD.currency THEN
      RAISE EXCEPTION 'reservation pricing snapshot is immutable';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.pricing_version_id IS NULL OR NEW.quoted_total IS NULL THEN
    RAISE EXCEPTION 'new reservations require a pricing version and quoted total';
  END IF;

  SELECT pv.status, pv.effective_at, pv.published_at, p.currency
  INTO v_status, v_effective_at, v_published_at, v_currency
  FROM pricing_versions pv
  JOIN projects p ON p.id = pv.project_id AND p.tenant_id = pv.tenant_id
  WHERE pv.id = NEW.pricing_version_id
    AND pv.tenant_id = NEW.tenant_id
    AND pv.project_id = NEW.project_id;

  IF NOT FOUND OR v_status NOT IN ('PUBLISHED','SCHEDULED') OR v_published_at IS NULL
     OR v_effective_at > NEW.reserved_at THEN
    RAISE EXCEPTION 'reservation must use an effective published pricing version';
  END IF;

  IF NEW.currency <> v_currency THEN
    RAISE EXCEPTION 'reservation currency must match project currency';
  END IF;

  v_expected := calculate_unit_type_price(NEW.pricing_version_id, NEW.unit_type_id);
  IF v_expected IS NULL OR round(NEW.quoted_total, 2) <> v_expected THEN
    RAISE EXCEPTION 'reservation quoted total does not match canonical pricing';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_reservations_price_snapshot
BEFORE INSERT OR UPDATE OF pricing_version_id, unit_type_id, quoted_total, currency ON reservations
FOR EACH ROW EXECUTE FUNCTION preneura_validate_reservation_price();

CREATE OR REPLACE FUNCTION preneura_snapshot_reservation_price_components()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_count integer;
BEGIN
  INSERT INTO reservation_price_components (
    tenant_id, project_id, reservation_id, pricing_version_id, unit_type_id,
    component, area_sqm, rate_per_sqm, amount
  )
  SELECT
    NEW.tenant_id,
    NEW.project_id,
    NEW.id,
    NEW.pricing_version_id,
    NEW.unit_type_id,
    r.component,
    r.area_sqm,
    r.rate_per_sqm,
    round(r.area_sqm * r.rate_per_sqm, 2)
  FROM pricing_rates r
  WHERE r.pricing_version_id = NEW.pricing_version_id
    AND r.unit_type_id = NEW.unit_type_id
  ORDER BY r.component;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count <> 3 THEN
    RAISE EXCEPTION 'reservation pricing snapshot must contain exactly three components';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_reservations_snapshot_price_components
AFTER INSERT ON reservations
FOR EACH ROW EXECUTE FUNCTION preneura_snapshot_reservation_price_components();

CREATE OR REPLACE FUNCTION preneura_reservation_price_components_immutable()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'reservation price components are immutable';
END;
$$;

CREATE TRIGGER trg_reservation_price_components_immutable
BEFORE UPDATE OR DELETE ON reservation_price_components
FOR EACH ROW EXECUTE FUNCTION preneura_reservation_price_components_immutable();

COMMIT;
