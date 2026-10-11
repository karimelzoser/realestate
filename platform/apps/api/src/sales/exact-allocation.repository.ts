import { ConflictException, Inject, Injectable } from '@nestjs/common';
import type {
  ExactAllocationContextSnapshot,
  ExactAllocationLockResult,
} from '@preneura/contracts/allocation';
import type { Database } from '@preneura/database';
import { sql, type Kysely } from 'kysely';
import { DATABASE } from '../database/database.module.js';

interface AllocationContextRow {
  queue_entry_id: string;
  buyer_profile_id: string;
  buyer_user_id: string;
  eoi_id: string;
  queue_status: 'CALLED' | 'LOCKED';
  unit_type_id: string;
  unit_type_code: string;
  unit_type_name: string;
}

interface AllocationUnitRow {
  physical_unit_id: string;
  inventory_slot_id: string;
  internal_reference: string;
  display_reference: string | null;
  building_id: string;
  building_code: string;
  building_name: string;
  floor_id: string;
  floor_code: string;
  floor_name: string;
  level_number: number | null;
  orientation: string | null;
  view_code: string | null;
  corner_position: string | null;
  inventory_updated_at: string;
}

interface PriceRow {
  pricing_version_id: string;
  total_price: string;
  currency: string;
  effective_at: string;
}

interface LockRow {
  lock_id: string;
  buyer_user_id: string;
  unit_type_id: string;
  physical_unit_id: string;
  inventory_slot_id: string;
  expires_at: Date | string;
  display_reference: string | null;
  internal_reference: string;
  building_id: string;
  building_code: string;
  building_name: string;
  floor_id: string;
  floor_code: string;
  floor_name: string;
}

@Injectable()
export class ExactAllocationRepository {
  constructor(@Inject(DATABASE) private readonly db: Kysely<Database>) {}

  async getContext(input: {
    tenantId: string;
    projectId: string;
    queueEntryId: string;
    now: Date;
  }): Promise<ExactAllocationContextSnapshot | null> {
    const contextResult = await sql<AllocationContextRow>`
      SELECT
        q.id AS queue_entry_id,
        q.buyer_profile_id,
        b.user_id AS buyer_user_id,
        e.id AS eoi_id,
        q.status AS queue_status,
        e.unit_type_id,
        ut.code AS unit_type_code,
        ut.name AS unit_type_name
      FROM queue_entries q
      JOIN buyer_profiles b
        ON b.id = q.buyer_profile_id
       AND b.tenant_id = q.tenant_id
       AND b.status = 'ACTIVE'
      JOIN buyer_eois e
        ON e.id = q.eoi_id
       AND e.tenant_id = q.tenant_id
       AND e.project_id = q.project_id
       AND e.buyer_profile_id = q.buyer_profile_id
      JOIN catalog_unit_types ut
        ON ut.id = e.unit_type_id
       AND ut.tenant_id = e.tenant_id
       AND ut.project_id = e.project_id
      WHERE q.id = ${input.queueEntryId}::uuid
        AND q.tenant_id = ${input.tenantId}::uuid
        AND q.project_id = ${input.projectId}::uuid
        AND q.status IN ('CALLED','LOCKED')
        AND e.status = 'PAID'
        AND e.unit_type_id IS NOT NULL
      LIMIT 1
    `.execute(this.db);
    const context = contextResult.rows[0];
    if (!context) return null;

    const priceResult = await sql<PriceRow>`
      SELECT
        pv.id AS pricing_version_id,
        calculate_unit_type_price(pv.id, ${context.unit_type_id}::uuid)::text AS total_price,
        p.currency,
        pv.effective_at::text AS effective_at
      FROM pricing_versions pv
      JOIN projects p ON p.id = pv.project_id AND p.tenant_id = pv.tenant_id
      WHERE pv.tenant_id = ${input.tenantId}::uuid
        AND pv.project_id = ${input.projectId}::uuid
        AND pv.status IN ('PUBLISHED','SCHEDULED')
        AND pv.published_at IS NOT NULL
        AND pv.effective_at <= ${input.now}
      ORDER BY pv.effective_at DESC, pv.version_number DESC
      LIMIT 1
    `.execute(this.db);
    const price = priceResult.rows[0];
    if (!price || !price.total_price) {
      throw new ConflictException('No effective published pricing exists for the EOI unit type.');
    }

    const activeLockResult = await sql<LockRow>`
      SELECT
        l.id AS lock_id,
        l.buyer_user_id,
        l.unit_type_id,
        l.physical_unit_id,
        l.inventory_slot_id,
        l.expires_at,
        u.display_reference,
        u.internal_reference,
        bld.id AS building_id,
        bld.code AS building_code,
        bld.name AS building_name,
        fl.id AS floor_id,
        fl.code AS floor_code,
        fl.name AS floor_name
      FROM inventory_locks l
      JOIN physical_units u
        ON u.id = l.physical_unit_id
       AND u.tenant_id = l.tenant_id
       AND u.project_id = l.project_id
       AND u.unit_type_id = l.unit_type_id
      JOIN project_buildings bld ON bld.id = u.building_id
      JOIN project_floors fl ON fl.id = u.floor_id
      WHERE l.tenant_id = ${input.tenantId}::uuid
        AND l.project_id = ${input.projectId}::uuid
        AND l.buyer_user_id = ${context.buyer_user_id}::uuid
        AND l.status = 'ACTIVE'
        AND l.expires_at > ${input.now}
      LIMIT 1
    `.execute(this.db);
    const activeLock = activeLockResult.rows[0]
      ? this.lockSnapshot(activeLockResult.rows[0]!, input.now)
      : null;

    const unitResult = await sql<AllocationUnitRow>`
      SELECT
        u.id AS physical_unit_id,
        s.id AS inventory_slot_id,
        u.internal_reference,
        u.display_reference,
        bld.id AS building_id,
        bld.code AS building_code,
        bld.name AS building_name,
        fl.id AS floor_id,
        fl.code AS floor_code,
        fl.name AS floor_name,
        fl.level_number,
        u.orientation,
        u.view_code,
        u.corner_position,
        greatest(u.updated_at, s.updated_at, bld.updated_at, fl.updated_at)::text AS inventory_updated_at
      FROM physical_units u
      JOIN project_buildings bld
        ON bld.id = u.building_id
       AND bld.tenant_id = u.tenant_id
       AND bld.project_id = u.project_id
      JOIN project_floors fl
        ON fl.id = u.floor_id
       AND fl.tenant_id = u.tenant_id
       AND fl.project_id = u.project_id
       AND fl.building_id = u.building_id
      JOIN inventory_slots s
        ON s.physical_unit_id = u.id
       AND s.tenant_id = u.tenant_id
       AND s.project_id = u.project_id
       AND s.unit_type_id = u.unit_type_id
      WHERE u.tenant_id = ${input.tenantId}::uuid
        AND u.project_id = ${input.projectId}::uuid
        AND u.unit_type_id = ${context.unit_type_id}::uuid
        AND u.status = 'ACTIVE'
        AND bld.status = 'ACTIVE'
        AND fl.status = 'ACTIVE'
        AND s.state = 'AVAILABLE'
        AND NOT EXISTS (
          SELECT 1
          FROM inventory_locks l
          WHERE l.physical_unit_id = u.id
            AND l.status = 'ACTIVE'
            AND l.expires_at > ${input.now}
        )
      ORDER BY bld.sort_order, bld.name, fl.sort_order, fl.level_number NULLS LAST, u.internal_reference
    `.execute(this.db);

    return {
      queueEntryId: context.queue_entry_id,
      buyerProfileId: context.buyer_profile_id,
      buyerUserId: context.buyer_user_id,
      eoiId: context.eoi_id,
      eoiUnitTypeId: context.unit_type_id,
      eoiUnitTypeCode: context.unit_type_code,
      eoiUnitTypeName: context.unit_type_name,
      queueStatus: context.queue_status,
      activeLock,
      units: unitResult.rows.map((row) => ({
        physicalUnitId: row.physical_unit_id,
        inventorySlotId: row.inventory_slot_id,
        unitTypeId: context.unit_type_id,
        unitTypeCode: context.unit_type_code,
        unitTypeName: context.unit_type_name,
        internalReference: row.internal_reference,
        displayReference: row.display_reference,
        buildingId: row.building_id,
        buildingCode: row.building_code,
        buildingName: row.building_name,
        floorId: row.floor_id,
        floorCode: row.floor_code,
        floorName: row.floor_name,
        levelNumber: row.level_number,
        orientation: row.orientation,
        viewCode: row.view_code,
        cornerPosition: row.corner_position,
        currency: price.currency,
        currentTotalPrice: price.total_price,
        pricingVersionId: price.pricing_version_id,
        priceEffectiveAt: price.effective_at,
        inventoryUpdatedAt: row.inventory_updated_at,
      })),
    };
  }

  async lock(input: {
    tenantId: string;
    projectId: string;
    queueEntryId: string;
    physicalUnitId: string;
    lockedByUserId: string;
    ttlSeconds: number;
    now: Date;
  }): Promise<ExactAllocationLockResult> {
    try {
      const result = await sql<LockRow>`
        SELECT *
        FROM preneura_lock_exact_physical_unit(
          ${input.tenantId}::uuid,
          ${input.projectId}::uuid,
          ${input.queueEntryId}::uuid,
          ${input.physicalUnitId}::uuid,
          ${input.lockedByUserId}::uuid,
          ${input.ttlSeconds}::integer,
          ${input.now}::timestamptz
        )
      `.execute(this.db);
      const row = result.rows[0];
      if (!row) throw new ConflictException('Exact unit could not be locked.');
      return this.lockSnapshot(row, input.now);
    } catch (error) {
      if (error instanceof ConflictException) throw error;
      const message = error instanceof Error ? error.message : 'Exact unit could not be locked.';
      throw new ConflictException(message.replace(/^.*ERROR:\s*/i, '').slice(0, 300));
    }
  }

  private lockSnapshot(row: LockRow, now: Date): ExactAllocationLockResult {
    const expiresAt = row.expires_at instanceof Date ? row.expires_at : new Date(row.expires_at);
    return {
      lockId: row.lock_id,
      buyerUserId: row.buyer_user_id,
      unitTypeId: row.unit_type_id,
      physicalUnitId: row.physical_unit_id,
      inventorySlotId: row.inventory_slot_id,
      expiresAt: expiresAt.toISOString(),
      remainingSeconds: Math.max(0, Math.ceil((expiresAt.getTime() - now.getTime()) / 1000)),
      displayReference: row.display_reference,
      internalReference: row.internal_reference,
      buildingId: row.building_id,
      buildingCode: row.building_code,
      buildingName: row.building_name,
      floorId: row.floor_id,
      floorCode: row.floor_code,
      floorName: row.floor_name,
    };
  }
}
