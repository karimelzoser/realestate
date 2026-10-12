import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import type { Database } from '@preneura/database';
import type {
  CheckInQueueInput,
  CreateBuyerProfileInput,
  CreateEoiRefundPolicyInput,
  EoiPolicySnapshot,
  QueueEntrySnapshot,
  ReservationResult,
  TransactionMilestoneCode,
  TransactionProgressSnapshot,
} from '@preneura/contracts/sales';
import { DATABASE } from '../database/database.module.js';
import type { PhysicalApartmentSnapshot } from '@preneura/contracts/allocation';

export interface BuyerProfileRecord {
  id: string;
  tenantId: string;
  userId: string;
  source: 'DIRECT' | 'BROKER' | 'INTERNAL';
  brokerCompanyId: string | null;
  brokerAgentUserId: string | null;
}

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

@Injectable()
export class SalesRepository {
  constructor(@Inject(DATABASE) private readonly db: Kysely<Database>) {}

  async projectExists(tenantId: string, projectId: string): Promise<boolean> {
    const row = await this.db
      .selectFrom('projects')
      .select('id')
      .where('tenant_id', '=', tenantId)
      .where('id', '=', projectId)
      .where('status', 'in', ['DRAFT', 'ACTIVE', 'PAUSED'])
      .executeTakeFirst();
    return Boolean(row);
  }

  async getBuyerProfile(input: {
    tenantId: string;
    buyerProfileId: string;
  }): Promise<BuyerProfileRecord | null> {
    const row = await this.db
      .selectFrom('buyer_profiles')
      .select([
        'id',
        'tenant_id',
        'user_id',
        'source',
        'broker_company_id',
        'broker_agent_user_id',
      ])
      .where('tenant_id', '=', input.tenantId)
      .where('id', '=', input.buyerProfileId)
      .where('status', '=', 'ACTIVE')
      .executeTakeFirst();
    if (!row) return null;
    return {
      id: row.id,
      tenantId: row.tenant_id,
      userId: row.user_id,
      source: row.source,
      brokerCompanyId: row.broker_company_id,
      brokerAgentUserId: row.broker_agent_user_id,
    };
  }

  async createBuyerProfile(input: {
    actorUserId: string;
    data: CreateBuyerProfileInput;
  }): Promise<string> {
    return this.db.transaction().execute(async (trx) => {
      const row = await trx
        .insertInto('buyer_profiles')
        .values({
          tenant_id: input.data.tenantId,
          user_id: input.data.userId,
          status: 'ACTIVE',
          source: input.data.source,
          broker_company_id: input.data.brokerCompanyId ?? null,
          broker_agent_user_id: input.data.brokerAgentUserId ?? null,
          created_by: input.actorUserId,
        })
        .onConflict((oc) =>
          oc.columns(['tenant_id', 'user_id']).doUpdateSet({
            status: 'ACTIVE',
            source: input.data.source,
            broker_company_id: input.data.brokerCompanyId ?? null,
            broker_agent_user_id: input.data.brokerAgentUserId ?? null,
            updated_at: new Date(),
          }),
        )
        .returning('id')
        .executeTakeFirstOrThrow();

      await trx
        .insertInto('domain_outbox_events')
        .values({
          tenant_id: input.data.tenantId,
          project_id: input.data.projectId,
          aggregate_type: 'BUYER_PROFILE',
          aggregate_id: row.id,
          event_type: 'buyer.profile.upserted',
          payload: {
            buyerUserId: input.data.userId,
            source: input.data.source,
            brokerCompanyId: input.data.brokerCompanyId ?? null,
            brokerAgentUserId: input.data.brokerAgentUserId ?? null,
            actorUserId: input.actorUserId,
          },
          published_at: null,
          attempts: 0,
        })
        .execute();
      return row.id;
    });
  }

  async createActiveRefundPolicy(input: {
    actorUserId: string;
    data: CreateEoiRefundPolicyInput;
    now: Date;
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
        .selectFrom('eoi_refund_policies')
        .select((eb) => eb.fn.max<number>('version_number').as('max_version'))
        .where('project_id', '=', input.data.projectId)
        .executeTakeFirst();
      const versionNumber = Number(latest?.max_version ?? 0) + 1;

      await trx
        .updateTable('eoi_refund_policies')
        .set({ status: 'RETIRED', updated_at: input.now })
        .where('tenant_id', '=', input.data.tenantId)
        .where('project_id', '=', input.data.projectId)
        .where('status', '=', 'ACTIVE')
        .execute();

      const row = await trx
        .insertInto('eoi_refund_policies')
        .values({
          tenant_id: input.data.tenantId,
          project_id: input.data.projectId,
          version_number: versionNumber,
          name: input.data.name,
          status: 'ACTIVE',
          eoi_amount: input.data.eoiAmount,
          currency: input.data.currency,
          before_reservation_refund_percent: input.data.beforeReservationRefundPercent,
          after_reservation_before_contract_refund_percent:
            input.data.afterReservationBeforeContractRefundPercent,
          after_contract_refund_percent: input.data.afterContractRefundPercent,
          processing_fee: input.data.processingFee,
          effective_at: new Date(input.data.effectiveAt),
          published_at: input.now,
          created_by: input.actorUserId,
          published_by: input.actorUserId,
        })
        .returning('id')
        .executeTakeFirstOrThrow();

      await trx
        .insertInto('domain_outbox_events')
        .values({
          tenant_id: input.data.tenantId,
          project_id: input.data.projectId,
          aggregate_type: 'EOI_REFUND_POLICY',
          aggregate_id: row.id,
          event_type: 'eoi.refund_policy.published',
          payload: {
            versionNumber,
            effectiveAt: input.data.effectiveAt,
            actorUserId: input.actorUserId,
          },
          published_at: null,
          attempts: 0,
        })
        .execute();

      return { id: row.id, versionNumber };
    });
  }

  async createEoi(input: {
    actorUserId: string;
    tenantId: string;
    projectId: string;
    buyerProfileId: string;
    unitTypeId: string;
    refundPolicyId: string;
    now: Date;
  }): Promise<{ eoiId: string; amount: string; currency: string }> {
    return this.db.transaction().execute(async (trx) => {
      const project = await trx.selectFrom('projects').select('id')
        .where('id', '=', input.projectId).where('tenant_id', '=', input.tenantId)
        .where('status', '=', 'ACTIVE').forShare().executeTakeFirst();
      if (!project) throw new ConflictException('This project is not open for EOI.');
      const policy = await trx
        .selectFrom('eoi_refund_policies')
        .select(['id', 'eoi_amount', 'currency'])
        .where('tenant_id', '=', input.tenantId)
        .where('project_id', '=', input.projectId)
        .where('status', '=', 'ACTIVE')
        .where('effective_at', '<=', input.now)
        .orderBy('effective_at', 'desc')
        .orderBy('version_number', 'desc')
        .forShare()
        .executeTakeFirst();
      if (!policy) throw new ConflictException('No active EOI refund policy is effective for this project.');
      if (policy.id !== input.refundPolicyId) throw new ConflictException('The EOI policy changed. Review the current policy before continuing.');
      const unitType = await trx.selectFrom('catalog_unit_types').select('id')
        .where('id', '=', input.unitTypeId).where('tenant_id', '=', input.tenantId)
        .where('project_id', '=', input.projectId).where('status', '=', 'ACTIVE')
        .forShare().executeTakeFirst();
      if (!unitType) throw new NotFoundException('Active apartment type not found in this project.');

      const row = await trx
        .insertInto('buyer_eois')
        .values({
          tenant_id: input.tenantId,
          project_id: input.projectId,
          buyer_profile_id: input.buyerProfileId,
          refund_policy_id: policy.id,
          selected_unit_type_id: input.unitTypeId,
          policy_accepted_by: input.actorUserId,
          amount: policy.eoi_amount as string,
          currency: policy.currency,
          status: 'PAYMENT_PENDING',
          payment_reference: null,
          paid_at: null,
          applied_at: null,
          refund_requested_at: null,
          refunded_at: null,
          expires_at: null,
          created_by: input.actorUserId,
        })
        .onConflict((oc) => oc.columns(['buyer_profile_id', 'project_id'])
          .where(sql<boolean>`status IN ('PAYMENT_PENDING','PAID','APPLIED','REFUND_REQUESTED')`).doNothing())
        .returning(['id', 'amount', 'currency'])
        .executeTakeFirst();
      if (!row) {
        const existing = await trx.selectFrom('buyer_eois').select(['id', 'amount', 'currency', 'selected_unit_type_id', 'refund_policy_id'])
          .where('buyer_profile_id', '=', input.buyerProfileId).where('tenant_id', '=', input.tenantId)
          .where('project_id', '=', input.projectId).where('status', 'in', ['PAYMENT_PENDING','PAID','APPLIED','REFUND_REQUESTED'])
          .executeTakeFirst();
        if (existing?.selected_unit_type_id === input.unitTypeId && existing.refund_policy_id === input.refundPolicyId) {
          return { eoiId: existing.id, amount: String(existing.amount), currency: existing.currency };
        }
        throw new ConflictException('A live EOI already exists with a different selection or policy.');
      }

      await trx
        .insertInto('domain_outbox_events')
        .values({
          tenant_id: input.tenantId,
          project_id: input.projectId,
          aggregate_type: 'EOI',
          aggregate_id: row.id,
          event_type: 'eoi.created',
          payload: { buyerProfileId: input.buyerProfileId, actorUserId: input.actorUserId,
            selectedUnitTypeId: input.unitTypeId, refundPolicyId: policy.id },
          published_at: null,
          attempts: 0,
        })
        .execute();

      return { eoiId: row.id, amount: row.amount as string, currency: row.currency };
    });
  }

  async activeEoiPolicy(input: { tenantId: string; projectId: string; now: Date }): Promise<EoiPolicySnapshot | null> {
    const row = await this.db.selectFrom('eoi_refund_policies')
      .select(['id', 'version_number', 'name', 'eoi_amount', 'currency',
        'before_reservation_refund_percent', 'after_reservation_before_contract_refund_percent',
        'after_contract_refund_percent', 'processing_fee'])
      .where('tenant_id', '=', input.tenantId).where('project_id', '=', input.projectId)
      .where('status', '=', 'ACTIVE').where('effective_at', '<=', input.now)
      .orderBy('effective_at', 'desc').orderBy('version_number', 'desc').executeTakeFirst();
    return row ? { refundPolicyId: row.id, versionNumber: row.version_number, name: row.name,
      amount: String(row.eoi_amount), currency: row.currency,
      beforeReservationRefundPercent: String(row.before_reservation_refund_percent),
      afterReservationBeforeContractRefundPercent: String(row.after_reservation_before_contract_refund_percent),
      afterContractRefundPercent: String(row.after_contract_refund_percent), processingFee: String(row.processing_fee) } : null;
  }

  async markEoiPaid(input: {
    actorUserId: string;
    tenantId: string;
    projectId: string;
    eoiId: string;
    paymentReference: string;
    now: Date;
  }): Promise<boolean> {
    return this.db.transaction().execute(async (trx) => {
      const row = await trx
        .updateTable('buyer_eois')
        .set({
          status: 'PAID',
          payment_reference: input.paymentReference,
          paid_at: input.now,
          updated_at: input.now,
        })
        .where('id', '=', input.eoiId)
        .where('tenant_id', '=', input.tenantId)
        .where('project_id', '=', input.projectId)
        .where('status', '=', 'PAYMENT_PENDING')
        .returning(['id', 'buyer_profile_id'])
        .executeTakeFirst();
      if (!row) return false;

      await trx
        .insertInto('domain_outbox_events')
        .values({
          tenant_id: input.tenantId,
          project_id: input.projectId,
          aggregate_type: 'EOI',
          aggregate_id: input.eoiId,
          event_type: 'eoi.paid',
          payload: {
            buyerProfileId: row.buyer_profile_id,
            paymentReference: input.paymentReference,
            actorUserId: input.actorUserId,
          },
          published_at: null,
          attempts: 0,
        })
        .execute();
      return true;
    });
  }

  async checkInQueue(input: {
    actorUserId: string;
    data: CheckInQueueInput;
    now: Date;
  }): Promise<{ queueEntryId: string }> {
    return this.db.transaction().execute(async (trx) => {
      const eoi = await trx
        .selectFrom('buyer_eois')
        .select(['id', 'buyer_profile_id', 'status'])
        .where('id', '=', input.data.eoiId)
        .where('tenant_id', '=', input.data.tenantId)
        .where('project_id', '=', input.data.projectId)
        .forUpdate()
        .executeTakeFirst();
      if (!eoi || eoi.buyer_profile_id !== input.data.buyerProfileId || eoi.status !== 'PAID') {
        throw new ConflictException('A paid EOI for this buyer and project is required before check-in.');
      }

      const row = await trx
        .insertInto('queue_entries')
        .values({
          tenant_id: input.data.tenantId,
          project_id: input.data.projectId,
          buyer_profile_id: input.data.buyerProfileId,
          eoi_id: input.data.eoiId,
          channel: input.data.channel,
          priority_group: input.data.priorityGroup,
          priority_score: input.data.priorityScore,
          status: 'WAITING',
          checked_in_at: input.now,
          called_at: null,
          completed_at: null,
          cancelled_at: null,
          created_by: input.actorUserId,
          updated_at: input.now,
        })
        .returning('id')
        .executeTakeFirstOrThrow();

      await trx
        .insertInto('domain_outbox_events')
        .values({
          tenant_id: input.data.tenantId,
          project_id: input.data.projectId,
          aggregate_type: 'QUEUE_ENTRY',
          aggregate_id: row.id,
          event_type: 'queue.checked_in',
          payload: {
            buyerProfileId: input.data.buyerProfileId,
            priorityGroup: input.data.priorityGroup,
            priorityScore: input.data.priorityScore,
            actorUserId: input.actorUserId,
          },
          published_at: null,
          attempts: 0,
        })
        .execute();
      return { queueEntryId: row.id };
    });
  }

  async listQueue(input: {
    tenantId: string;
    projectId: string;
  }): Promise<QueueEntrySnapshot[]> {
    const rows = await this.db
      .selectFrom('queue_entries as q')
      .innerJoin('buyer_profiles as b', 'b.id', 'q.buyer_profile_id')
      .select([
        'q.id as queue_entry_id',
        'q.buyer_profile_id',
        'b.user_id as buyer_user_id',
        'q.channel',
        'q.priority_group',
        'q.priority_score',
        'q.status',
        'q.checked_in_at',
        'q.called_at',
      ])
      .where('q.tenant_id', '=', input.tenantId)
      .where('q.project_id', '=', input.projectId)
      .where('q.status', 'in', ['WAITING', 'CALLED', 'LOCKED'])
      .orderBy('q.priority_group', 'desc')
      .orderBy('q.priority_score', 'desc')
      .orderBy('q.checked_in_at', 'asc')
      .orderBy('q.id', 'asc')
      .execute();

    return rows.map((row) => ({
      queueEntryId: row.queue_entry_id,
      buyerProfileId: row.buyer_profile_id,
      buyerUserId: row.buyer_user_id,
      channel: row.channel,
      priorityGroup: row.priority_group,
      priorityScore: row.priority_score,
      status: row.status,
      checkedInAt: (row.checked_in_at as Date).toISOString(),
      calledAt: row.called_at ? (row.called_at as Date).toISOString() : null,
    }));
  }

  async convertLockToReservation(input: {
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

      const existing = await trx.selectFrom('reservations as r').innerJoin('transactions as t','t.reservation_id','r.id')
        .select(['r.id','t.id as transaction_id','r.unit_type_id','r.physical_unit_id','r.apartment_snapshot','r.quoted_total','r.currency','r.reserved_at'])
        .where('r.inventory_lock_id','=',input.lockId).where('r.tenant_id','=',input.tenantId)
        .where('r.project_id','=',input.projectId).where('r.buyer_profile_id','=',buyer.id)
        .where('r.queue_entry_id','=',input.queueEntryId).where('r.reserved_by','=',input.actorUserId)
        .where('r.status','in',['ACTIVE','COMPLETED']).executeTakeFirst();
      if (existing?.physical_unit_id && existing.apartment_snapshot) {
        return { reservationId:existing.id,transactionId:existing.transaction_id,unitTypeId:existing.unit_type_id,
          physicalUnitId:existing.physical_unit_id,apartment:existing.apartment_snapshot as unknown as PhysicalApartmentSnapshot,
          quotedTotal:existing.quoted_total===null ? null : String(existing.quoted_total),currency:existing.currency,
          reservedAt:(existing.reserved_at as Date).toISOString() };
      }

      const queue = await trx
        .selectFrom('queue_entries')
        .select(['id', 'buyer_profile_id', 'eoi_id', 'status'])
        .where('id', '=', input.queueEntryId)
        .where('tenant_id', '=', input.tenantId)
        .where('project_id', '=', input.projectId)
        .forUpdate()
        .executeTakeFirst();
      if (!queue || queue.buyer_profile_id !== buyer.id || !['WAITING', 'CALLED', 'LOCKED'].includes(queue.status)) {
        throw new ConflictException('The buyer does not have an active queue position.');
      }

      const eoi = await trx
        .selectFrom('buyer_eois')
        .select(['id', 'status', 'selected_unit_type_id'])
        .where('id', '=', queue.eoi_id)
        .where('tenant_id', '=', input.tenantId)
        .where('project_id', '=', input.projectId)
        .where('buyer_profile_id', '=', buyer.id)
        .forUpdate()
        .executeTakeFirst();
      if (!eoi || eoi.status !== 'PAID') {
        throw new ConflictException('A paid, unapplied EOI is required for reservation.');
      }

      const lock = await trx
        .selectFrom('inventory_locks')
        .select([
          'id',
          'unit_type_id',
          'inventory_slot_id',
          'physical_unit_id',
          'allocation_quote_id',
          'buyer_user_id',
          'status',
          'expires_at',
        ])
        .where('id', '=', input.lockId)
        .where('tenant_id', '=', input.tenantId)
        .where('project_id', '=', input.projectId)
        .forUpdate()
        .executeTakeFirst();
      if (!lock || lock.status !== 'ACTIVE' || (lock.expires_at as Date).getTime() <= input.now.getTime()) {
        throw new ConflictException('The inventory lock is missing or expired.');
      }
      if (lock.buyer_user_id && lock.buyer_user_id !== buyer.user_id) {
        throw new ConflictException('The inventory lock belongs to a different buyer.');
      }
      if (!lock.physical_unit_id || !lock.allocation_quote_id || eoi.selected_unit_type_id !== lock.unit_type_id) {
        throw new ConflictException('Reservation requires the exact apartment quote selected for this EOI type.');
      }

      const quote = await trx.selectFrom('allocation_quotes')
        .select(['id','pricing_version_id as pricingVersionId','quoted_total as quotedTotal','currency','apartment_snapshot'])
        .where('id','=',lock.allocation_quote_id).where('tenant_id','=',input.tenantId).where('project_id','=',input.projectId)
        .where('queue_entry_id','=',queue.id).where('buyer_user_id','=',buyer.user_id)
        .where('allocator_user_id','=',input.actorUserId).where('physical_unit_id','=',lock.physical_unit_id)
        .forShare().executeTakeFirst();
      if (!quote) throw new ConflictException('Owned exact apartment quote not found for this reservation.');

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

      const reservation = await trx
        .insertInto('reservations')
        .values({
          tenant_id: input.tenantId,
          project_id: input.projectId,
          buyer_profile_id: buyer.id,
          queue_entry_id: queue.id,
          inventory_lock_id: lock.id,
          inventory_slot_id: lock.inventory_slot_id,
          unit_type_id: lock.unit_type_id,
          physical_unit_id: lock.physical_unit_id,
          allocation_quote_id: quote.id,
          apartment_snapshot: quote.apartment_snapshot,
          pricing_version_id: quote.pricingVersionId,
          quoted_total: quote.quotedTotal,
          currency: quote.currency,
          status: 'ACTIVE',
          reserved_by: input.actorUserId,
          reserved_at: input.now,
          cancelled_at: null,
          completed_at: null,
          created_at: input.now,
          updated_at: input.now,
        })
        .returning('id')
        .executeTakeFirstOrThrow();

      await trx
        .updateTable('buyer_eois')
        .set({ status: 'APPLIED', applied_at: input.now, updated_at: input.now })
        .where('id', '=', eoi.id)
        .where('status', '=', 'PAID')
        .executeTakeFirstOrThrow();

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
          reservation_id: reservation.id,
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
            reservationId: reservation.id,
            physicalUnitId: lock.physical_unit_id,
            quoteId: quote.id,
            unitTypeId: lock.unit_type_id,
            quotedTotal: quote.quotedTotal,
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
            aggregate_id: reservation.id,
            event_type: 'reservation.created',
            payload: { buyerProfileId: buyer.id, transactionId: transaction.id, physicalUnitId: lock.physical_unit_id, quoteId: quote.id },
            published_at: null,
            attempts: 0,
          },
          {
            tenant_id: input.tenantId,
            project_id: input.projectId,
            aggregate_type: 'TRANSACTION',
            aggregate_id: transaction.id,
            event_type: 'transaction.opened',
            payload: { buyerProfileId: buyer.id, reservationId: reservation.id, physicalUnitId: lock.physical_unit_id, quoteId: quote.id },
            published_at: null,
            attempts: 0,
          },
        ])
        .execute();

      return {
        reservationId: reservation.id,
        transactionId: transaction.id,
        physicalUnitId: lock.physical_unit_id,
        apartment: quote.apartment_snapshot as unknown as PhysicalApartmentSnapshot,
        unitTypeId: lock.unit_type_id,
        quotedTotal: quote.quotedTotal,
        currency: quote.currency,
        reservedAt: input.now.toISOString(),
      };
    });
  }

  async completeMilestone(input: {
    actorUserId: string;
    tenantId: string;
    projectId: string;
    transactionId: string;
    milestoneCode: TransactionMilestoneCode;
    evidenceDocumentId: string | null;
    now: Date;
  }): Promise<boolean> {
    return this.db.transaction().execute(async (trx) => {
      const transaction = await trx
        .selectFrom('transactions')
        .select(['id', 'status'])
        .where('id', '=', input.transactionId)
        .where('tenant_id', '=', input.tenantId)
        .where('project_id', '=', input.projectId)
        .forUpdate()
        .executeTakeFirst();
      if (!transaction || transaction.status === 'CANCELLED' || transaction.status === 'COMPLETED') return false;

      const milestone = await trx
        .updateTable('transaction_milestones')
        .set({
          status: 'COMPLETED',
          completed_at: input.now,
          completed_by: input.actorUserId,
          evidence_document_id: input.evidenceDocumentId,
          updated_at: input.now,
        })
        .where('transaction_id', '=', input.transactionId)
        .where('code', '=', input.milestoneCode)
        .where('status', 'in', ['PENDING', 'BLOCKED'])
        .returning('id')
        .executeTakeFirst();
      if (!milestone) return false;

      const remaining = await trx
        .selectFrom('transaction_milestones')
        .select((eb) => eb.fn.countAll<number>().as('count'))
        .where('transaction_id', '=', input.transactionId)
        .where('status', 'not in', ['COMPLETED', 'WAIVED'])
        .executeTakeFirstOrThrow();
      if (Number(remaining.count) === 0) {
        await trx
          .updateTable('transactions')
          .set({ status: 'READY_FOR_COMPLETION', updated_at: input.now })
          .where('id', '=', input.transactionId)
          .where('status', '=', 'IN_PROGRESS')
          .execute();
      }

      await trx
        .insertInto('transaction_events')
        .values({
          transaction_id: input.transactionId,
          actor_user_id: input.actorUserId,
          event_type: 'transaction.milestone.completed',
          metadata: {
            milestoneCode: input.milestoneCode,
            evidenceDocumentId: input.evidenceDocumentId,
          },
        })
        .execute();

      await trx
        .insertInto('domain_outbox_events')
        .values({
          tenant_id: input.tenantId,
          project_id: input.projectId,
          aggregate_type: 'TRANSACTION',
          aggregate_id: input.transactionId,
          event_type: 'transaction.milestone.completed',
          payload: { milestoneCode: input.milestoneCode, actorUserId: input.actorUserId },
          published_at: null,
          attempts: 0,
        })
        .execute();
      return true;
    });
  }

  async getTransactionProgress(input: {
    tenantId: string;
    projectId: string;
    transactionId: string;
  }): Promise<TransactionProgressSnapshot | null> {
    const transaction = await this.db
      .selectFrom('transactions')
      .select(['id', 'reservation_id', 'buyer_profile_id', 'status'])
      .where('id', '=', input.transactionId)
      .where('tenant_id', '=', input.tenantId)
      .where('project_id', '=', input.projectId)
      .executeTakeFirst();
    if (!transaction) return null;

    const milestones = await this.db
      .selectFrom('transaction_milestones')
      .select(['code', 'label', 'weight_percent', 'status', 'completed_at'])
      .where('transaction_id', '=', input.transactionId)
      .orderBy('id', 'asc')
      .execute();

    const completion = milestones.reduce((sum, milestone) => {
      return ['COMPLETED', 'WAIVED'].includes(milestone.status)
        ? sum + Number(milestone.weight_percent)
        : sum;
    }, 0);

    const prerequisiteCodes = new Set<TransactionMilestoneCode>([
      'DOWN_PAYMENT_RECEIVED',
      'CHEQUES_RECEIVED',
      'CONTRACT_SIGNED',
      'CONTRACT_STAMPED',
    ]);
    const commissionPrerequisitesComplete = [...prerequisiteCodes].every((code) =>
      milestones.some((milestone) => milestone.code === code && milestone.status === 'COMPLETED'),
    );

    return {
      transactionId: transaction.id,
      reservationId: transaction.reservation_id,
      buyerProfileId: transaction.buyer_profile_id,
      status: transaction.status,
      completionPercent: completion.toFixed(2),
      commissionPrerequisitesComplete,
      milestones: milestones.map((milestone) => ({
        code: milestone.code,
        label: milestone.label,
        weightPercent: milestone.weight_percent as string,
        status: milestone.status,
        completedAt: milestone.completed_at ? (milestone.completed_at as Date).toISOString() : null,
      })),
    };
  }
}
