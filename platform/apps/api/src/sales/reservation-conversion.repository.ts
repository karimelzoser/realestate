import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { ReservationResult, TransactionMilestoneCode } from '@preneura/contracts/sales';
import type { Database } from '@preneura/database';
import { sql, type Kysely } from 'kysely';
import { DATABASE } from '../database/database.module.js';

const INITIAL_MILESTONES: ReadonlyArray<{
  code: TransactionMilestoneCode;
  label: string;
  weight: string;
}> = [
  { code: 'BUYER_DOCUMENTS_COMPLETE', label: 'Buyer documents complete', weight: '10.00' },
  { code: 'DOWN_PAYMENT_RECEIVED', label: 'Down payment received', weight: '25.00' },
  { code: 'CHEQUES_RECEIVED', label: 'All required cheques received', weight: '20.00' },
  { code: 'CONTRACT_GENERATED', label: 'Contract generated', weight: '10.00' },
  { code: 'CONTRACT_SIGNED', label: 'Contract signed', weight: '15.00' },
  { code: 'CONTRACT_STAMPED', label: 'Contract stamped', weight: '20.00' },
];

interface LockRow {
  id: string;
  unit_type_id: string;
  physical_unit_id: string | null;
  inventory_slot_id: string;
  buyer_user_id: string | null;
  status: string;
  expires_at: Date;
  display_reference: string | null;
  internal_reference: string;
  building_code: string;
  floor_code: string;
}

@Injectable()
export class ReservationConversionRepository {
  constructor(@Inject(DATABASE) private readonly db: Kysely<Database>) {}

  async convert(input: {
    actorUserId: string;
    tenantId: string;
    projectId: string;
    buyerProfileId: string;
    queueEntryId: string;
    lockId: string;
    now: Date;
  }): Promise<ReservationResult> {
    return this.db.transaction().execute(async (trx) => {
      const buyer = await trx
        .selectFrom('buyer_profiles')
        .select(['id', 'user_id'])
        .where('id', '=', input.buyerProfileId)
        .where('tenant_id', '=', input.tenantId)
        .where('status', '=', 'ACTIVE')
        .forUpdate()
        .executeTakeFirst();
      if (!buyer) throw new NotFoundException('Buyer profile not found.');

      const queue = await trx
        .selectFrom('queue_entries')
        .select(['id', 'buyer_profile_id', 'eoi_id', 'status'])
        .where('id', '=', input.queueEntryId)
        .where('tenant_id', '=', input.tenantId)
        .where('project_id', '=', input.projectId)
        .forUpdate()
        .executeTakeFirst();
      if (!queue || queue.buyer_profile_id !== buyer.id || queue.status !== 'LOCKED') {
        throw new ConflictException('Buyer must hold an exact-unit allocation lock before reservation.');
      }

      const eoiResult = await sql<{ id: string; status: string; unit_type_id: string | null }>`
        SELECT id, status, unit_type_id
        FROM buyer_eois
        WHERE id = ${queue.eoi_id}::uuid
          AND tenant_id = ${input.tenantId}::uuid
          AND project_id = ${input.projectId}::uuid
          AND buyer_profile_id = ${buyer.id}::uuid
        FOR UPDATE
      `.execute(trx);
      const eoi = eoiResult.rows[0];
      if (!eoi || eoi.status !== 'PAID' || !eoi.unit_type_id) {
        throw new ConflictException('A paid typed EOI is required for reservation.');
      }

      const lockResult = await sql<LockRow>`
        SELECT
          l.id,
          l.unit_type_id,
          l.physical_unit_id,
          l.inventory_slot_id,
          l.buyer_user_id,
          l.status,
          l.expires_at,
          u.display_reference,
          u.internal_reference,
          bld.code AS building_code,
          fl.code AS floor_code
        FROM inventory_locks l
        LEFT JOIN physical_units u
          ON u.id = l.physical_unit_id
         AND u.tenant_id = l.tenant_id
         AND u.project_id = l.project_id
         AND u.unit_type_id = l.unit_type_id
        LEFT JOIN project_buildings bld ON bld.id = u.building_id
        LEFT JOIN project_floors fl ON fl.id = u.floor_id
        WHERE l.id = ${input.lockId}::uuid
          AND l.tenant_id = ${input.tenantId}::uuid
          AND l.project_id = ${input.projectId}::uuid
        FOR UPDATE OF l
      `.execute(trx);
      const lock = lockResult.rows[0];
      if (
        !lock ||
        lock.status !== 'ACTIVE' ||
        lock.expires_at.getTime() <= input.now.getTime() ||
        !lock.physical_unit_id
      ) {
        throw new ConflictException('The exact-unit lock is missing, anonymous, or expired.');
      }
      if (lock.buyer_user_id !== buyer.user_id) {
        throw new ConflictException('The exact-unit lock belongs to a different buyer.');
      }
      if (lock.unit_type_id !== eoi.unit_type_id) {
        throw new ConflictException('The exact unit does not match the EOI unit type.');
      }

      const priceResult = await sql<{
        pricing_version_id: string;
        quoted_total: string;
        currency: string;
      }>`
        SELECT
          pv.id AS pricing_version_id,
          calculate_unit_type_price(pv.id, ${lock.unit_type_id}::uuid)::text AS quoted_total,
          p.currency
        FROM pricing_versions pv
        JOIN projects p ON p.id = pv.project_id AND p.tenant_id = pv.tenant_id
        WHERE pv.tenant_id = ${input.tenantId}::uuid
          AND pv.project_id = ${input.projectId}::uuid
          AND pv.status IN ('PUBLISHED','SCHEDULED')
          AND pv.published_at IS NOT NULL
          AND pv.effective_at <= ${input.now}
        ORDER BY pv.effective_at DESC, pv.version_number DESC
        LIMIT 1
      `.execute(trx);
      const quote = priceResult.rows[0];
      if (!quote || !quote.quoted_total) {
        throw new ConflictException('No effective published pricing exists for this unit type.');
      }

      await trx
        .updateTable('inventory_locks')
        .set({ status: 'CONVERTED', converted_at: input.now, updated_at: input.now })
        .where('id', '=', lock.id)
        .where('status', '=', 'ACTIVE')
        .executeTakeFirstOrThrow();

      await trx
        .updateTable('inventory_slots')
        .set({ state: 'RESERVED', updated_at: input.now })
        .where('id', '=', lock.inventory_slot_id)
        .where('state', '=', 'AVAILABLE')
        .executeTakeFirstOrThrow();

      const reservationResult = await sql<{ id: string }>`
        INSERT INTO reservations (
          tenant_id,
          project_id,
          buyer_profile_id,
          queue_entry_id,
          inventory_lock_id,
          inventory_slot_id,
          unit_type_id,
          physical_unit_id,
          pricing_version_id,
          quoted_total,
          currency,
          status,
          reserved_by,
          reserved_at,
          created_at,
          updated_at
        ) VALUES (
          ${input.tenantId}::uuid,
          ${input.projectId}::uuid,
          ${buyer.id}::uuid,
          ${queue.id}::uuid,
          ${lock.id}::uuid,
          ${lock.inventory_slot_id}::uuid,
          ${lock.unit_type_id}::uuid,
          ${lock.physical_unit_id}::uuid,
          ${quote.pricing_version_id}::uuid,
          ${quote.quoted_total}::numeric,
          ${quote.currency},
          'ACTIVE',
          ${input.actorUserId}::uuid,
          ${input.now},
          ${input.now},
          ${input.now}
        )
        RETURNING id
      `.execute(trx);
      const reservationId = reservationResult.rows[0]!.id;

      await sql`
        UPDATE buyer_eois
        SET status = 'APPLIED', applied_at = ${input.now}, updated_at = ${input.now}
        WHERE id = ${eoi.id}::uuid AND status = 'PAID'
      `.execute(trx);

      await trx
        .updateTable('queue_entries')
        .set({ status: 'COMPLETED', completed_at: input.now, updated_at: input.now })
        .where('id', '=', queue.id)
        .executeTakeFirstOrThrow();

      const transaction = await trx
        .insertInto('transactions')
        .values({
          tenant_id: input.tenantId,
          project_id: input.projectId,
          reservation_id: reservationId,
          buyer_profile_id: buyer.id,
          status: 'IN_PROGRESS',
          opened_at: input.now,
          completed_at: null,
          cancelled_at: null,
          created_at: input.now,
          updated_at: input.now,
        })
        .returning('id')
        .executeTakeFirstOrThrow();

      await trx
        .insertInto('transaction_milestones')
        .values(
          INITIAL_MILESTONES.map((milestone) => ({
            transaction_id: transaction.id,
            code: milestone.code,
            label: milestone.label,
            weight_percent: milestone.weight,
            status: 'PENDING' as const,
            completed_at: null,
            completed_by: null,
            evidence_document_id: null,
            updated_at: input.now,
          })),
        )
        .execute();

      await trx
        .insertInto('transaction_events')
        .values({
          transaction_id: transaction.id,
          actor_user_id: input.actorUserId,
          event_type: 'reservation.created',
          metadata: {
            reservationId,
            unitTypeId: lock.unit_type_id,
            physicalUnitId: lock.physical_unit_id,
            physicalUnitReference: lock.display_reference ?? lock.internal_reference,
            quotedTotal: quote.quoted_total,
            currency: quote.currency,
          },
        })
        .execute();

      await trx
        .insertInto('domain_outbox_events')
        .values([
          {
            tenant_id: input.tenantId,
            project_id: input.projectId,
            aggregate_type: 'RESERVATION',
            aggregate_id: reservationId,
            event_type: 'reservation.created',
            payload: {
              buyerProfileId: buyer.id,
              transactionId: transaction.id,
              physicalUnitId: lock.physical_unit_id,
            },
            published_at: null,
            attempts: 0,
          },
          {
            tenant_id: input.tenantId,
            project_id: input.projectId,
            aggregate_type: 'TRANSACTION',
            aggregate_id: transaction.id,
            event_type: 'transaction.opened',
            payload: {
              buyerProfileId: buyer.id,
              reservationId,
              physicalUnitId: lock.physical_unit_id,
            },
            published_at: null,
            attempts: 0,
          },
        ])
        .execute();

      return {
        reservationId,
        transactionId: transaction.id,
        unitTypeId: lock.unit_type_id,
        physicalUnitId: lock.physical_unit_id,
        physicalUnitReference: lock.display_reference ?? lock.internal_reference,
        buildingCode: lock.building_code,
        floorCode: lock.floor_code,
        quotedTotal: quote.quoted_total,
        currency: quote.currency,
        reservedAt: input.now.toISOString(),
      };
    });
  }
}
