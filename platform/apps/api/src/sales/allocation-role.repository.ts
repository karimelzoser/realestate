import { Inject, Injectable } from '@nestjs/common';
import type { Database } from '@preneura/database';
import type {
  AllocationSessionSnapshot,
  AssignedAllocationLockSnapshot,
  ExactApartmentQuoteSnapshot,
  EligibleApartmentPage,
  EligibleApartmentSnapshot,
  EligibleApartmentFilter,
  EligibleApartmentStructure,
} from '@preneura/contracts/allocation';
import { sql, type Kysely } from 'kysely';
import { DATABASE } from '../database/database.module.js';

@Injectable()
export class AllocationRoleRepository {
  constructor(@Inject(DATABASE) private readonly db: Kysely<Database>) {}

  async claimNext(input: {
    tenantId: string;
    projectId: string;
    allocatorUserId: string;
    now: Date;
  }): Promise<AllocationSessionSnapshot | null> {
    const result = await sql<{ queue_entry_id: string | null }>`
      SELECT preneura_claim_called_queue_entry(
        ${input.tenantId}::uuid,
        ${input.projectId}::uuid,
        ${input.allocatorUserId}::uuid,
        ${input.now}::timestamptz
      ) AS queue_entry_id
    `.execute(this.db);
    const queueEntryId = result.rows[0]?.queue_entry_id ?? null;
    if (!queueEntryId) return null;
    return this.getCurrent(input);
  }

  async getCurrent(input: {
    tenantId: string;
    projectId: string;
    allocatorUserId: string;
  }): Promise<AllocationSessionSnapshot | null> {
    const result = await sql<AllocationSessionSnapshot>`
      SELECT
        clock_timestamp()::text AS "serverTime",
        q.id AS "queueEntryId",
        q.buyer_profile_id AS "buyerProfileId",
        b.user_id AS "buyerUserId",
        u.display_name AS "buyerDisplayName",
        q.channel,
        q.priority_group AS "priorityGroup",
        q.priority_score AS "priorityScore",
        q.status,
        q.called_at::text AS "calledAt",
        q.allocator_user_id AS "allocatorUserId",
        q.allocator_assigned_at::text AS "allocatorAssignedAt",
        q.allocation_lock_id AS "allocationLockId",
        l.unit_type_id AS "lockUnitTypeId",
        l.expires_at::text AS "lockExpiresAt",
        e.selected_unit_type_id AS "eoiUnitTypeId",
        e.selected_unit_type_snapshot->>'name' AS "eoiUnitTypeName",
        l.physical_unit_id AS "lockPhysicalUnitId",
        l.allocation_quote_id AS "lockQuoteId",
        quote.quoted_total::text AS "lockQuotedTotal"
      FROM queue_entries q
      JOIN buyer_profiles b
        ON b.id = q.buyer_profile_id
       AND b.tenant_id = q.tenant_id
      JOIN users u ON u.id = b.user_id
      JOIN buyer_eois e ON e.id=q.eoi_id AND e.tenant_id=q.tenant_id AND e.project_id=q.project_id
      LEFT JOIN inventory_locks l ON l.id = q.allocation_lock_id
      LEFT JOIN allocation_quotes quote ON quote.id=l.allocation_quote_id
      WHERE q.tenant_id = ${input.tenantId}::uuid
        AND q.project_id = ${input.projectId}::uuid
        AND q.allocator_user_id = ${input.allocatorUserId}::uuid
        AND q.status IN ('CALLED','LOCKED')
      ORDER BY q.allocator_assigned_at DESC, q.id
      LIMIT 1
    `.execute(this.db);
    const row=result.rows[0];
    return row ? { ...row, serverTime:new Date(row.serverTime).toISOString(),
      calledAt:row.calledAt ? new Date(row.calledAt).toISOString() : null,
      allocatorAssignedAt:new Date(row.allocatorAssignedAt).toISOString(),
      lockExpiresAt:row.lockExpiresAt ? new Date(row.lockExpiresAt).toISOString() : null } : null;
  }

  async createAssignedLock(input: {
    tenantId: string; projectId: string; allocatorUserId: string; quoteId: string;
    idempotencyKey: string; ttlSeconds: number;
  }): Promise<AssignedAllocationLockSnapshot | null> {
    const created = await sql<{ lockId: string }>`
      SELECT preneura_create_exact_allocation_lock(
        ${input.tenantId}::uuid, ${input.projectId}::uuid, ${input.allocatorUserId}::uuid,
        ${input.quoteId}::uuid, ${input.idempotencyKey}::uuid, ${input.ttlSeconds}::integer
      ) AS "lockId"
    `.execute(this.db);
    const lockId = created.rows[0]?.lockId;
    if (!lockId) return null;
    const result = await sql<AssignedAllocationLockSnapshot>`
      SELECT l.id AS "lockId", q.queue_entry_id AS "queueEntryId",l.buyer_user_id AS "buyerUserId",
        l.inventory_slot_id AS "inventorySlotId", l.unit_type_id AS "unitTypeId", l.physical_unit_id AS "physicalUnitId",
        q.id AS "quoteId",q.quoted_total::text AS "quotedTotal",q.currency,l.status,l.expires_at::text AS "expiresAt"
      FROM inventory_locks l JOIN allocation_quotes q ON q.id=l.allocation_quote_id
      WHERE l.id=${lockId}::uuid AND l.tenant_id=${input.tenantId}::uuid AND l.project_id=${input.projectId}::uuid
        AND l.locked_by_user_id=${input.allocatorUserId}::uuid
    `.execute(this.db);
    const row=result.rows[0];
    return row ? { ...row,expiresAt:new Date(row.expiresAt).toISOString() } : null;
  }

  async quoteApartment(input: { tenantId: string; projectId: string; allocatorUserId: string; queueEntryId: string; physicalUnitId: string }): Promise<ExactApartmentQuoteSnapshot | null> {
    const created = await sql<{ quoteId: string }>`
      SELECT preneura_quote_exact_apartment(${input.tenantId}::uuid,${input.projectId}::uuid,
        ${input.queueEntryId}::uuid,${input.allocatorUserId}::uuid,${input.physicalUnitId}::uuid) AS "quoteId"
    `.execute(this.db);
    const quoteId=created.rows[0]?.quoteId;
    return quoteId ? this.quote({ ...input, quoteId }) : null;
  }

  async quote(input: { tenantId: string; projectId: string; allocatorUserId: string; quoteId: string }): Promise<ExactApartmentQuoteSnapshot | null> {
    const result=await sql<ExactApartmentQuoteSnapshot>`
      SELECT id AS "quoteId",queue_entry_id AS "queueEntryId",apartment_snapshot AS apartment,
        pricing_version_id AS "pricingVersionId",quoted_total::text AS "quotedTotal",currency,
        created_at::text AS "createdAt",valid_until::text AS "validUntil",price_components AS components
      FROM allocation_quotes WHERE id=${input.quoteId}::uuid AND tenant_id=${input.tenantId}::uuid
        AND project_id=${input.projectId}::uuid AND allocator_user_id=${input.allocatorUserId}::uuid
    `.execute(this.db);
    const row=result.rows[0];
    return row ? { ...row,createdAt:new Date(row.createdAt).toISOString(),validUntil:new Date(row.validUntil).toISOString() } : null;
  }

  async structure(input: { tenantId: string; projectId: string; allocatorUserId: string }): Promise<EligibleApartmentStructure> {
    const session=await this.getCurrent(input);
    if (!session || session.status!=='CALLED' || !session.eoiUnitTypeId) return { buildings:[] };
    const result=await sql<{ buildingId:string; buildingName:string; buildingCode:string; floorId:string; floorName:string; floorCode:string; floorLevel:number|null; availableApartments:number }>`
      SELECT b.id AS "buildingId",b.name AS "buildingName",b.code AS "buildingCode",f.id AS "floorId",f.name AS "floorName",
        f.code AS "floorCode",f.level_number AS "floorLevel",count(*)::int AS "availableApartments"
      FROM physical_units pu JOIN inventory_slots s ON s.physical_unit_id=pu.id AND s.tenant_id=pu.tenant_id AND s.project_id=pu.project_id AND s.unit_type_id=pu.unit_type_id
      JOIN project_buildings b ON b.id=pu.building_id JOIN project_floors f ON f.id=pu.floor_id
      WHERE pu.tenant_id=${input.tenantId}::uuid AND pu.project_id=${input.projectId}::uuid AND pu.unit_type_id=${session.eoiUnitTypeId}::uuid
        AND s.state='AVAILABLE' AND preneura_exact_apartment_eligible(${input.tenantId}::uuid,${input.projectId}::uuid,${session.queueEntryId}::uuid,${input.allocatorUserId}::uuid,pu.id)
        AND NOT EXISTS(SELECT 1 FROM inventory_locks l WHERE l.inventory_slot_id=s.id AND l.status='ACTIVE' AND l.expires_at>clock_timestamp())
      GROUP BY b.id,b.name,b.code,f.id,f.name,f.code,f.level_number ORDER BY b.name,b.id,f.level_number NULLS FIRST,f.id
    `.execute(this.db);
    const buildings:EligibleApartmentStructure['buildings']=[];
    for(const row of result.rows) {
      let building=buildings.find(item=>item.buildingId===row.buildingId);
      if(!building) { building={buildingId:row.buildingId,buildingName:row.buildingName,buildingCode:row.buildingCode,floors:[]};buildings.push(building); }
      building.floors.push({floorId:row.floorId,floorName:row.floorName,floorCode:row.floorCode,floorLevel:row.floorLevel,availableApartments:row.availableApartments});
    }
    return { buildings };
  }

  async eligibleApartments(input: { tenantId: string; projectId: string; allocatorUserId: string; filters: EligibleApartmentFilter }): Promise<EligibleApartmentPage> {
    const session=await this.getCurrent(input);
    if (!session || session.status !== 'CALLED' || !session.eoiUnitTypeId) return { items: [], nextCursor: null };
    const rows=await sql<EligibleApartmentSnapshot>`
      SELECT pu.id AS "physicalUnitId",pu.display_reference AS "apartmentReference",
        b.id AS "buildingId",b.code AS "buildingCode",b.name AS "buildingName",
        f.id AS "floorId",f.code AS "floorCode",f.name AS "floorName",f.level_number AS "floorLevel",
        pu.orientation,pu.view_code AS "viewCode",ut.id AS "unitTypeId",ut.code AS "unitTypeCode",ut.name AS "unitTypeName",
        ut.indoor_area_sqm::text AS "indoorAreaSqm",ut.roof_area_sqm::text AS "roofAreaSqm",ut.garden_area_sqm::text AS "gardenAreaSqm",
        calculate_unit_type_price(pv.id,ut.id)::text AS "currentTotalPrice",p.currency
      FROM physical_units pu
      JOIN inventory_slots s ON s.physical_unit_id=pu.id AND s.tenant_id=pu.tenant_id AND s.project_id=pu.project_id AND s.unit_type_id=pu.unit_type_id
      JOIN project_buildings b ON b.id=pu.building_id JOIN project_floors f ON f.id=pu.floor_id
      JOIN catalog_unit_types ut ON ut.id=pu.unit_type_id JOIN projects p ON p.id=pu.project_id
      LEFT JOIN LATERAL(SELECT id FROM pricing_versions WHERE tenant_id=pu.tenant_id AND project_id=pu.project_id
        AND status IN ('PUBLISHED','SCHEDULED') AND published_at IS NOT NULL AND effective_at<=clock_timestamp()
        ORDER BY effective_at DESC,version_number DESC LIMIT 1) pv ON true
      WHERE pu.tenant_id=${input.tenantId}::uuid AND pu.project_id=${input.projectId}::uuid
        AND pu.unit_type_id=${session.eoiUnitTypeId}::uuid AND s.state='AVAILABLE'
        AND preneura_exact_apartment_eligible(${input.tenantId}::uuid,${input.projectId}::uuid,${session.queueEntryId}::uuid,${input.allocatorUserId}::uuid,pu.id)
        AND NOT EXISTS(SELECT 1 FROM inventory_locks l WHERE l.inventory_slot_id=s.id AND l.status='ACTIVE' AND l.expires_at>clock_timestamp())
        AND ${input.filters.buildingId ? sql`pu.building_id=${input.filters.buildingId}::uuid` : sql`TRUE`}
        AND ${input.filters.floorId ? sql`pu.floor_id=${input.filters.floorId}::uuid` : sql`TRUE`}
        AND ${input.filters.after ? sql`pu.id>${input.filters.after}::uuid` : sql`TRUE`}
      ORDER BY pu.id ASC LIMIT ${input.filters.limit+1}
    `.execute(this.db);
    const items=rows.rows.slice(0,input.filters.limit);
    return { items, nextCursor: rows.rows.length>input.filters.limit ? items.at(-1)?.physicalUnitId ?? null : null };
  }
}
