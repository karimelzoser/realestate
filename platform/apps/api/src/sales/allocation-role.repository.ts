import { Inject, Injectable } from '@nestjs/common';
import type { Database } from '@preneura/database';
import type {
  AllocationSessionSnapshot,
  AssignedAllocationLockSnapshot,
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
        l.expires_at::text AS "lockExpiresAt"
      FROM queue_entries q
      JOIN buyer_profiles b
        ON b.id = q.buyer_profile_id
       AND b.tenant_id = q.tenant_id
      JOIN users u ON u.id = b.user_id
      LEFT JOIN inventory_locks l ON l.id = q.allocation_lock_id
      WHERE q.tenant_id = ${input.tenantId}::uuid
        AND q.project_id = ${input.projectId}::uuid
        AND q.allocator_user_id = ${input.allocatorUserId}::uuid
        AND q.status IN ('CALLED','LOCKED')
      ORDER BY q.allocator_assigned_at DESC, q.id
      LIMIT 1
    `.execute(this.db);
    return result.rows[0] ?? null;
  }

  async createAssignedLock(input: {
    tenantId: string;
    projectId: string;
    allocatorUserId: string;
    unitTypeId: string;
    ttlSeconds: number;
    now: Date;
  }): Promise<AssignedAllocationLockSnapshot | null> {
    const result = await sql<{
      lock_id: string;
      queue_entry_id: string;
      buyer_user_id: string;
      inventory_slot_id: string;
      expires_at: Date;
    }>`
      SELECT * FROM preneura_create_assigned_inventory_lock(
        ${input.tenantId}::uuid,
        ${input.projectId}::uuid,
        ${input.allocatorUserId}::uuid,
        ${input.unitTypeId}::uuid,
        ${input.ttlSeconds}::integer,
        ${input.now}::timestamptz
      )
    `.execute(this.db);
    const row = result.rows[0];
    if (!row) return null;
    return {
      lockId: row.lock_id,
      queueEntryId: row.queue_entry_id,
      buyerUserId: row.buyer_user_id,
      inventorySlotId: row.inventory_slot_id,
      unitTypeId: input.unitTypeId,
      expiresAt: row.expires_at.toISOString(),
    };
  }

  async unitTypeExists(input: {
    tenantId: string;
    projectId: string;
    unitTypeId: string;
  }): Promise<boolean> {
    const result = await sql<{ present: boolean }>`
      SELECT EXISTS (
        SELECT 1 FROM catalog_unit_types
        WHERE id = ${input.unitTypeId}::uuid
          AND tenant_id = ${input.tenantId}::uuid
          AND project_id = ${input.projectId}::uuid
          AND status = 'ACTIVE'
      ) AS present
    `.execute(this.db);
    return result.rows[0]?.present ?? false;
  }
}
