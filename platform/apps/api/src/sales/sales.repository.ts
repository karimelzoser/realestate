import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import type { Database } from '@preneura/database';
import type {
  CheckInQueueInput,
  CreateBuyerProfileInput,
  CreateEoiRefundPolicyInput,
  QueueEntrySnapshot,
  ReservationResult,
  TransactionMilestoneCode,
  TransactionProgressSnapshot,
} from '@preneura/contracts/sales';
import { DATABASE } from '../database/database.module.js';

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
    now: Date;
  }): Promise<{ eoiId: string; amount: string; currency: string }> {
    return this.db.transaction().execute(async (trx) => {
      const policy = await trx
        .selectFrom('eoi_refund_policies')
        .select(['id', 'eoi_amount', 'currency'])
        .where('tenant_id', '=', input.tenantId)
        .where('project_id', '=', input.projectId)
        .where('status', '=', 'ACTIVE')
        .where('effective_at', '<=', input.now)
        .orderBy('effective_at', 'desc')
        .orderBy('version_number', 'desc')
        .executeTakeFirst();
      if (!policy) throw new ConflictException('No active EOI refund policy is effective for this project.');

      const row = await trx
        .insertInto('buyer_eois')
        .values({
          tenant_id: input.tenantId,
          project_id: input.projectId,
          buyer_profile_id: input.buyerProfileId,
          refund_policy_id: policy.id,
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
        .returning(['id', 'amount', 'currency'])
        .executeTakeFirstOrThrow();

      await trx
        .insertInto('domain_outbox_events')
        .values({
          tenant_id: input.tenantId,
          project_id: input.projectId,
          aggregate_type: 'EOI',
          aggregate_id: row.id,
          event_type: 'eoi.created',
          payload: { buyerProfileId: input.buyerProfileId, actorUserId: input.actorUserId },
          published_at: null,
          attempts: 0,
        })
        .execute();

      return { eoiId: row.id, amount: row.amount as string, currency: row.currency };
    });
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
        .select(['id', 'status'])
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

      const price = await sql<{
        pricingVersionId: string;
        quotedTotal: string;
        currency: string;
      }>`
        SELECT
          pv.id AS "pricingVersionId",
          round(sum(
            CASE r.component
              WHEN 'INDOOR' THEN ut.indoor_area_sqm * r.rate_per_sqm
              WHEN 'ROOF' THEN ut.roof_area_sqm * r.rate_per_sqm
              WHEN 'GARDEN' THEN ut.garden_area_sqm * r.rate_per_sqm
            END
          ), 2)::text AS "quotedTotal",
          p.currency AS "currency"
        FROM pricing_versions pv
        JOIN pricing_rates r
          ON r.pricing_version_id = pv.id
         AND r.tenant_id = pv.tenant_id
         AND r.project_id = pv.project_id
        JOIN catalog_unit_types ut
          ON ut.id = r.unit_type_id
         AND ut.tenant_id = pv.tenant_id
         AND ut.project_id = pv.project_id
        JOIN projects p ON p.id = pv.project_id AND p.tenant_id = pv.tenant_id
        WHERE pv.tenant_id = ${input.tenantId}
          AND pv.project_id = ${input.projectId}
          AND pv.status IN ('PUBLISHED','SCHEDULED')
          AND pv.published_at IS NOT NULL
          AND pv.effective_at <= ${input.now}
          AND r.unit_type_id = ${lock.unit_type_id}
        GROUP BY pv.id, pv.effective_at, pv.version_number, p.currency
        ORDER BY pv.effective_at DESC, pv.version_number DESC
        LIMIT 1
      `.execute(trx);
      const quote = price.rows[0];
      if (!quote) throw new ConflictException('No effective published pricing exists for this unit type.');

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
            payload: { buyerProfileId: buyer.id, transactionId: transaction.id },
            published_at: null,
            attempts: 0,
          },
          {
            tenant_id: input.tenantId,
            project_id: input.projectId,
            aggregate_type: 'TRANSACTION',
            aggregate_id: transaction.id,
            event_type: 'transaction.opened',
            payload: { buyerProfileId: buyer.id, reservationId: reservation.id },
            published_at: null,
            attempts: 0,
          },
        ])
        .execute();

      return {
        reservationId: reservation.id,
        transactionId: transaction.id,
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
