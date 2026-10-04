import { ConflictException, Inject, Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import type { Database, JsonValue } from '@preneura/database';
import type {
  CreatePricingVersionInput,
  CreateUnitTypeInput,
  InventoryLockResult,
  PricingComponent,
  UnitTypeCommercialSnapshot,
} from '@preneura/contracts/catalog';
import { DATABASE } from '../database/database.module.js';

interface PricingCoverage {
  expectedRates: number;
  actualRates: number;
}

@Injectable()
export class CatalogRepository {
  constructor(@Inject(DATABASE) private readonly db: Kysely<Database>) {}

  async projectExists(input: { tenantId: string; projectId: string }): Promise<boolean> {
    const row = await this.db
      .selectFrom('projects')
      .select('id')
      .where('tenant_id', '=', input.tenantId)
      .where('id', '=', input.projectId)
      .where('status', 'in', ['DRAFT', 'ACTIVE', 'PAUSED'])
      .executeTakeFirst();
    return Boolean(row);
  }

  async unitTypesBelongToProject(input: {
    tenantId: string;
    projectId: string;
    unitTypeIds: readonly string[];
  }): Promise<boolean> {
    const uniqueIds = [...new Set(input.unitTypeIds)];
    if (uniqueIds.length === 0) return false;
    const rows = await this.db
      .selectFrom('catalog_unit_types')
      .select('id')
      .where('tenant_id', '=', input.tenantId)
      .where('project_id', '=', input.projectId)
      .where('id', 'in', uniqueIds)
      .where('status', '<>', 'ARCHIVED')
      .execute();
    return rows.length === uniqueIds.length;
  }

  async createUnitType(input: CreateUnitTypeInput): Promise<string> {
    const row = await this.db
      .insertInto('catalog_unit_types')
      .values({
        tenant_id: input.tenantId,
        project_id: input.projectId,
        code: input.code,
        name: input.name,
        description: input.description ?? null,
        bedroom_count: input.bedroomCount ?? null,
        indoor_area_sqm: input.indoorAreaSqm,
        roof_area_sqm: input.roofAreaSqm,
        garden_area_sqm: input.gardenAreaSqm,
        status: 'ACTIVE',
        sort_order: input.sortOrder,
      })
      .returning('id')
      .executeTakeFirstOrThrow();

    await this.emitEvent({
      tenantId: input.tenantId,
      projectId: input.projectId,
      aggregateType: 'UNIT_TYPE',
      aggregateId: row.id,
      eventType: 'catalog.unit_type.created',
      payload: { code: input.code, name: input.name },
    });
    return row.id;
  }

  async addInventoryCapacity(input: {
    tenantId: string;
    projectId: string;
    unitTypeId: string;
    quantity: number;
    actorUserId: string;
  }): Promise<void> {
    await this.db.transaction().execute(async (trx) => {
      const chunks = Math.ceil(input.quantity / 500);
      for (let chunk = 0; chunk < chunks; chunk += 1) {
        const size = Math.min(500, input.quantity - chunk * 500);
        await trx
          .insertInto('inventory_slots')
          .values(
            Array.from({ length: size }, () => ({
              tenant_id: input.tenantId,
              project_id: input.projectId,
              unit_type_id: input.unitTypeId,
              state: 'AVAILABLE' as const,
              internal_reference: null,
            })),
          )
          .execute();
      }

      await trx
        .insertInto('domain_outbox_events')
        .values({
          tenant_id: input.tenantId,
          project_id: input.projectId,
          aggregate_type: 'UNIT_TYPE',
          aggregate_id: input.unitTypeId,
          event_type: 'inventory.capacity.added',
          payload: {
            quantity: input.quantity,
            actorUserId: input.actorUserId,
          },
          published_at: null,
          attempts: 0,
        })
        .execute();
    });
  }

  async createDraftPricingVersion(input: {
    actorUserId: string;
    data: CreatePricingVersionInput;
  }): Promise<{ id: string; versionNumber: number }> {
    return this.db.transaction().execute(async (trx) => {
      await trx
        .selectFrom('projects')
        .select('id')
        .where('id', '=', input.data.projectId)
        .where('tenant_id', '=', input.data.tenantId)
        .forUpdate()
        .executeTakeFirstOrThrow();

      const latest = await trx
        .selectFrom('pricing_versions')
        .select((eb) => eb.fn.max<number>('version_number').as('max_version'))
        .where('project_id', '=', input.data.projectId)
        .executeTakeFirst();
      const versionNumber = Number(latest?.max_version ?? 0) + 1;

      const version = await trx
        .insertInto('pricing_versions')
        .values({
          tenant_id: input.data.tenantId,
          project_id: input.data.projectId,
          version_number: versionNumber,
          label: input.data.label,
          status: 'DRAFT',
          effective_at: new Date(input.data.effectiveAt),
          published_at: null,
          published_by: null,
          created_by: input.actorUserId,
        })
        .returning('id')
        .executeTakeFirstOrThrow();

      await trx
        .insertInto('pricing_rates')
        .values(
          input.data.rates.map((rate) => ({
            pricing_version_id: version.id,
            unit_type_id: rate.unitTypeId,
            component: rate.component,
            rate_per_sqm: rate.ratePerSqm,
          })),
        )
        .execute();

      await trx
        .insertInto('domain_outbox_events')
        .values({
          tenant_id: input.data.tenantId,
          project_id: input.data.projectId,
          aggregate_type: 'PRICING_VERSION',
          aggregate_id: version.id,
          event_type: 'pricing.version.created',
          payload: {
            versionNumber,
            effectiveAt: input.data.effectiveAt,
            actorUserId: input.actorUserId,
          },
          published_at: null,
          attempts: 0,
        })
        .execute();

      return { id: version.id, versionNumber };
    });
  }

  async pricingCoverage(input: {
    tenantId: string;
    projectId: string;
    pricingVersionId: string;
  }): Promise<PricingCoverage | null> {
    const result = await sql<PricingCoverage>`
      SELECT
        ((SELECT count(*) FROM catalog_unit_types ut
          WHERE ut.tenant_id = ${input.tenantId}
            AND ut.project_id = ${input.projectId}
            AND ut.status = 'ACTIVE') * 3)::int AS "expectedRates",
        (SELECT count(*) FROM pricing_rates r
          JOIN pricing_versions pv ON pv.id = r.pricing_version_id
          WHERE pv.id = ${input.pricingVersionId}
            AND pv.tenant_id = ${input.tenantId}
            AND pv.project_id = ${input.projectId})::int AS "actualRates"
    `.execute(this.db);
    return result.rows[0] ?? null;
  }

  async publishPricingVersion(input: {
    tenantId: string;
    projectId: string;
    pricingVersionId: string;
    actorUserId: string;
    now: Date;
  }): Promise<{ status: 'PUBLISHED' | 'SCHEDULED'; effectiveAt: Date } | null> {
    return this.db.transaction().execute(async (trx) => {
      const version = await trx
        .selectFrom('pricing_versions')
        .select(['id', 'effective_at', 'status'])
        .where('id', '=', input.pricingVersionId)
        .where('tenant_id', '=', input.tenantId)
        .where('project_id', '=', input.projectId)
        .forUpdate()
        .executeTakeFirst();
      if (!version || version.status !== 'DRAFT') return null;

      const status =
        (version.effective_at as Date).getTime() <= input.now.getTime()
          ? 'PUBLISHED'
          : 'SCHEDULED';

      if (status === 'PUBLISHED') {
        await trx
          .updateTable('pricing_versions')
          .set({ status: 'SUPERSEDED' })
          .where('project_id', '=', input.projectId)
          .where('status', '=', 'PUBLISHED')
          .where('id', '<>', input.pricingVersionId)
          .execute();
      }

      await trx
        .updateTable('pricing_versions')
        .set({
          status,
          published_at: input.now,
          published_by: input.actorUserId,
          updated_at: input.now,
        })
        .where('id', '=', input.pricingVersionId)
        .execute();

      await trx
        .insertInto('domain_outbox_events')
        .values({
          tenant_id: input.tenantId,
          project_id: input.projectId,
          aggregate_type: 'PRICING_VERSION',
          aggregate_id: input.pricingVersionId,
          event_type: status === 'PUBLISHED' ? 'pricing.version.published' : 'pricing.version.scheduled',
          payload: {
            effectiveAt: (version.effective_at as Date).toISOString(),
            actorUserId: input.actorUserId,
          },
          published_at: null,
          attempts: 0,
        })
        .execute();

      return { status, effectiveAt: version.effective_at as Date };
    });
  }

  async listCommercialSnapshots(input: {
    tenantId: string;
    projectId: string;
    now: Date;
  }): Promise<UnitTypeCommercialSnapshot[]> {
    await this.expireLocks(input.tenantId, input.projectId, input.now);
    const horizon = new Date(input.now.getTime() + 24 * 60 * 60 * 1000);

    const result = await sql<UnitTypeCommercialSnapshot>`
      WITH current_version AS (
        SELECT id, effective_at, published_at
        FROM pricing_versions
        WHERE tenant_id = ${input.tenantId}
          AND project_id = ${input.projectId}
          AND status IN ('PUBLISHED','SCHEDULED')
          AND published_at IS NOT NULL
          AND effective_at <= ${input.now}
        ORDER BY effective_at DESC, version_number DESC
        LIMIT 1
      ),
      next_version AS (
        SELECT id, effective_at
        FROM pricing_versions
        WHERE tenant_id = ${input.tenantId}
          AND project_id = ${input.projectId}
          AND status = 'SCHEDULED'
          AND published_at IS NOT NULL
          AND effective_at > ${input.now}
          AND effective_at <= ${horizon}
        ORDER BY effective_at ASC, version_number ASC
        LIMIT 1
      ),
      slot_counts AS (
        SELECT
          s.unit_type_id,
          count(*) FILTER (WHERE s.state = 'AVAILABLE')::int AS available_slots,
          count(*) FILTER (WHERE s.state = 'RESERVED')::int AS reserved_quantity,
          count(*) FILTER (WHERE s.state = 'SOLD')::int AS sold_quantity,
          max(s.updated_at) AS slot_updated_at
        FROM inventory_slots s
        WHERE s.tenant_id = ${input.tenantId}
          AND s.project_id = ${input.projectId}
        GROUP BY s.unit_type_id
      ),
      active_locks AS (
        SELECT
          l.unit_type_id,
          count(*)::int AS locked_quantity,
          max(l.updated_at) AS lock_updated_at
        FROM inventory_locks l
        WHERE l.tenant_id = ${input.tenantId}
          AND l.project_id = ${input.projectId}
          AND l.status = 'ACTIVE'
          AND l.expires_at > ${input.now}
        GROUP BY l.unit_type_id
      ),
      current_prices AS (
        SELECT
          r.unit_type_id,
          round(sum(
            CASE r.component
              WHEN 'INDOOR' THEN ut.indoor_area_sqm * r.rate_per_sqm
              WHEN 'ROOF' THEN ut.roof_area_sqm * r.rate_per_sqm
              WHEN 'GARDEN' THEN ut.garden_area_sqm * r.rate_per_sqm
            END
          ), 2)::text AS total_price
        FROM current_version cv
        JOIN pricing_rates r ON r.pricing_version_id = cv.id
        JOIN catalog_unit_types ut ON ut.id = r.unit_type_id
        GROUP BY r.unit_type_id
      ),
      next_prices AS (
        SELECT
          r.unit_type_id,
          round(sum(
            CASE r.component
              WHEN 'INDOOR' THEN ut.indoor_area_sqm * r.rate_per_sqm
              WHEN 'ROOF' THEN ut.roof_area_sqm * r.rate_per_sqm
              WHEN 'GARDEN' THEN ut.garden_area_sqm * r.rate_per_sqm
            END
          ), 2)::text AS total_price
        FROM next_version nv
        JOIN pricing_rates r ON r.pricing_version_id = nv.id
        JOIN catalog_unit_types ut ON ut.id = r.unit_type_id
        GROUP BY r.unit_type_id
      )
      SELECT
        ut.id AS "unitTypeId",
        ut.code AS "code",
        ut.name AS "name",
        ut.bedroom_count AS "bedroomCount",
        ut.indoor_area_sqm::text AS "indoorAreaSqm",
        ut.roof_area_sqm::text AS "roofAreaSqm",
        ut.garden_area_sqm::text AS "gardenAreaSqm",
        p.currency AS "currency",
        greatest(coalesce(sc.available_slots, 0) - coalesce(al.locked_quantity, 0), 0)::int AS "availableQuantity",
        coalesce(al.locked_quantity, 0)::int AS "lockedQuantity",
        coalesce(sc.reserved_quantity, 0)::int AS "reservedQuantity",
        coalesce(sc.sold_quantity, 0)::int AS "soldQuantity",
        cp.total_price AS "currentTotalPrice",
        (SELECT effective_at::text FROM current_version) AS "currentPriceEffectiveAt",
        (SELECT published_at::text FROM current_version) AS "currentPricePublishedAt",
        (SELECT effective_at::text FROM next_version) AS "nextPriceEffectiveAt",
        np.total_price AS "nextTotalPrice",
        CASE
          WHEN cp.total_price IS NOT NULL AND np.total_price IS NOT NULL AND cp.total_price::numeric > 0
          THEN round(((np.total_price::numeric - cp.total_price::numeric) / cp.total_price::numeric) * 100, 2)::text
          ELSE NULL
        END AS "nextPriceChangePercent",
        greatest(
          coalesce(sc.slot_updated_at, ut.updated_at),
          coalesce(al.lock_updated_at, ut.updated_at),
          ut.updated_at
        )::text AS "inventoryUpdatedAt"
      FROM catalog_unit_types ut
      JOIN projects p ON p.id = ut.project_id AND p.tenant_id = ut.tenant_id
      LEFT JOIN slot_counts sc ON sc.unit_type_id = ut.id
      LEFT JOIN active_locks al ON al.unit_type_id = ut.id
      LEFT JOIN current_prices cp ON cp.unit_type_id = ut.id
      LEFT JOIN next_prices np ON np.unit_type_id = ut.id
      WHERE ut.tenant_id = ${input.tenantId}
        AND ut.project_id = ${input.projectId}
        AND ut.status = 'ACTIVE'
      ORDER BY ut.sort_order ASC, ut.name ASC
    `.execute(this.db);

    return result.rows;
  }

  async createInventoryLock(input: {
    tenantId: string;
    projectId: string;
    unitTypeId: string;
    buyerUserId: string | null;
    lockedByUserId: string;
    ttlSeconds: number;
    now: Date;
  }): Promise<InventoryLockResult | null> {
    return this.db.transaction().execute(async (trx) => {
      await trx
        .updateTable('inventory_locks')
        .set({
          status: 'EXPIRED',
          released_at: input.now,
          release_reason: 'TTL expired',
          updated_at: input.now,
        })
        .where('tenant_id', '=', input.tenantId)
        .where('project_id', '=', input.projectId)
        .where('unit_type_id', '=', input.unitTypeId)
        .where('status', '=', 'ACTIVE')
        .where('expires_at', '<=', input.now)
        .execute();

      const candidate = await sql<{ id: string }>`
        SELECT s.id
        FROM inventory_slots s
        WHERE s.tenant_id = ${input.tenantId}
          AND s.project_id = ${input.projectId}
          AND s.unit_type_id = ${input.unitTypeId}
          AND s.state = 'AVAILABLE'
          AND NOT EXISTS (
            SELECT 1
            FROM inventory_locks l
            WHERE l.inventory_slot_id = s.id
              AND l.status = 'ACTIVE'
          )
        ORDER BY s.created_at ASC, s.id ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      `.execute(trx);
      const slot = candidate.rows[0];
      if (!slot) return null;

      const expiresAt = new Date(input.now.getTime() + input.ttlSeconds * 1000);
      const lock = await trx
        .insertInto('inventory_locks')
        .values({
          tenant_id: input.tenantId,
          project_id: input.projectId,
          unit_type_id: input.unitTypeId,
          inventory_slot_id: slot.id,
          buyer_user_id: input.buyerUserId,
          locked_by_user_id: input.lockedByUserId,
          status: 'ACTIVE',
          expires_at: expiresAt,
          released_at: null,
          converted_at: null,
          release_reason: null,
        })
        .returning('id')
        .executeTakeFirstOrThrow();

      await trx
        .insertInto('domain_outbox_events')
        .values({
          tenant_id: input.tenantId,
          project_id: input.projectId,
          aggregate_type: 'INVENTORY_LOCK',
          aggregate_id: lock.id,
          event_type: 'inventory.lock.created',
          payload: {
            unitTypeId: input.unitTypeId,
            buyerUserId: input.buyerUserId,
            expiresAt: expiresAt.toISOString(),
            lockedByUserId: input.lockedByUserId,
          },
          published_at: null,
          attempts: 0,
        })
        .execute();

      return {
        lockId: lock.id,
        unitTypeId: input.unitTypeId,
        buyerUserId: input.buyerUserId,
        expiresAt: expiresAt.toISOString(),
        remainingSeconds: input.ttlSeconds,
      };
    });
  }

  async releaseInventoryLock(input: {
    tenantId: string;
    projectId: string;
    lockId: string;
    actorUserId: string;
    reason: string;
    now: Date;
  }): Promise<boolean> {
    return this.db.transaction().execute(async (trx) => {
      const released = await trx
        .updateTable('inventory_locks')
        .set({
          status: 'RELEASED',
          released_at: input.now,
          release_reason: input.reason,
          updated_at: input.now,
        })
        .where('id', '=', input.lockId)
        .where('tenant_id', '=', input.tenantId)
        .where('project_id', '=', input.projectId)
        .where('status', '=', 'ACTIVE')
        .returning(['id', 'unit_type_id'])
        .executeTakeFirst();
      if (!released) return false;

      await trx
        .insertInto('domain_outbox_events')
        .values({
          tenant_id: input.tenantId,
          project_id: input.projectId,
          aggregate_type: 'INVENTORY_LOCK',
          aggregate_id: input.lockId,
          event_type: 'inventory.lock.released',
          payload: {
            unitTypeId: released.unit_type_id,
            actorUserId: input.actorUserId,
            reason: input.reason,
          },
          published_at: null,
          attempts: 0,
        })
        .execute();
      return true;
    });
  }

  async getPricingVersionProject(input: {
    pricingVersionId: string;
    tenantId: string;
    projectId: string;
  }): Promise<boolean> {
    const row = await this.db
      .selectFrom('pricing_versions')
      .select('id')
      .where('id', '=', input.pricingVersionId)
      .where('tenant_id', '=', input.tenantId)
      .where('project_id', '=', input.projectId)
      .executeTakeFirst();
    return Boolean(row);
  }

  private async expireLocks(tenantId: string, projectId: string, now: Date): Promise<void> {
    await this.db
      .updateTable('inventory_locks')
      .set({
        status: 'EXPIRED',
        released_at: now,
        release_reason: 'TTL expired',
        updated_at: now,
      })
      .where('tenant_id', '=', tenantId)
      .where('project_id', '=', projectId)
      .where('status', '=', 'ACTIVE')
      .where('expires_at', '<=', now)
      .execute();
  }

  private async emitEvent(input: {
    tenantId: string;
    projectId: string;
    aggregateType: string;
    aggregateId: string;
    eventType: string;
    payload: Record<string, JsonValue>;
  }): Promise<void> {
    try {
      await this.db
        .insertInto('domain_outbox_events')
        .values({
          tenant_id: input.tenantId,
          project_id: input.projectId,
          aggregate_type: input.aggregateType,
          aggregate_id: input.aggregateId,
          event_type: input.eventType,
          payload: input.payload,
          published_at: null,
          attempts: 0,
        })
        .execute();
    } catch (error) {
      throw new ConflictException('The catalog change could not be recorded.', { cause: error });
    }
  }
}
