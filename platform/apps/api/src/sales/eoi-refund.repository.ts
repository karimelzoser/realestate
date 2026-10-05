import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { sql, type Kysely, type Transaction } from 'kysely';
import type { Database } from '@preneura/database';
import type {
  EoiRefundQuote,
  EoiRefundRequestSnapshot,
  EoiRefundStage,
} from '@preneura/contracts/sales';
import { DATABASE } from '../database/database.module.js';

interface RefundQuoteRow {
  eoiId: string;
  buyerProfileId: string;
  buyerUserId: string;
  eoiStatus: 'PAID' | 'APPLIED';
  stage: EoiRefundStage;
  originalAmount: string;
  refundPercent: string;
  processingFee: string;
  refundableAmount: string;
  currency: string;
  policyId: string;
}

@Injectable()
export class EoiRefundRepository {
  constructor(@Inject(DATABASE) private readonly db: Kysely<Database>) {}

  async list(input: {
    tenantId: string;
    projectId: string;
    buyerUserId?: string | null;
  }): Promise<EoiRefundRequestSnapshot[]> {
    let query = this.db
      .selectFrom('eoi_refund_requests as r')
      .innerJoin('buyer_profiles as b', (join) =>
        join.onRef('b.id', '=', 'r.buyer_profile_id').onRef('b.tenant_id', '=', 'r.tenant_id'),
      )
      .innerJoin('users as u', 'u.id', 'b.user_id')
      .select([
        'r.id',
        'r.eoi_id',
        'r.buyer_profile_id',
        'b.user_id as buyer_user_id',
        'u.display_name as buyer_display_name',
        'r.stage',
        'r.original_eoi_amount',
        'r.refund_percent',
        'r.processing_fee',
        'r.requested_amount',
        'r.currency',
        'r.status',
        'r.requested_at',
        'r.reviewed_at',
        'r.paid_at',
        'r.decision_note',
      ])
      .where('r.tenant_id', '=', input.tenantId)
      .where('r.project_id', '=', input.projectId);

    if (input.buyerUserId) query = query.where('b.user_id', '=', input.buyerUserId);

    const rows = await query
      .orderBy('r.requested_at', 'desc')
      .orderBy('r.id', 'desc')
      .execute();

    return rows.map((row) => ({
      refundRequestId: row.id,
      eoiId: row.eoi_id,
      buyerProfileId: row.buyer_profile_id,
      buyerUserId: row.buyer_user_id,
      buyerDisplayName: row.buyer_display_name,
      stage: row.stage,
      originalAmount: String(row.original_eoi_amount),
      refundPercent: String(row.refund_percent),
      processingFee: String(row.processing_fee),
      requestedAmount: String(row.requested_amount),
      currency: row.currency,
      status: row.status,
      requestedAt: (row.requested_at as Date).toISOString(),
      reviewedAt: row.reviewed_at ? (row.reviewed_at as Date).toISOString() : null,
      paidAt: row.paid_at ? (row.paid_at as Date).toISOString() : null,
      decisionNote: row.decision_note,
    }));
  }

  async quote(input: {
    tenantId: string;
    projectId: string;
    eoiId: string;
  }): Promise<(EoiRefundQuote & { buyerUserId: string; eoiStatus: 'PAID' | 'APPLIED' }) | null> {
    const row = await this.quoteIn(this.db, input);
    if (!row) return null;
    return this.toQuote(row);
  }

  async request(input: {
    tenantId: string;
    projectId: string;
    eoiId: string;
    actorUserId: string;
    now: Date;
  }): Promise<{ refundRequestId: string; quote: EoiRefundQuote }> {
    return this.db.transaction().execute(async (trx) => {
      const eoi = await trx
        .selectFrom('buyer_eois')
        .select(['id', 'status'])
        .where('id', '=', input.eoiId)
        .where('tenant_id', '=', input.tenantId)
        .where('project_id', '=', input.projectId)
        .forUpdate()
        .executeTakeFirst();
      if (!eoi || !['PAID', 'APPLIED'].includes(eoi.status)) {
        throw new ConflictException('Only a paid or applied EOI can be refunded.');
      }

      const row = await this.quoteIn(trx, input);
      if (!row) throw new NotFoundException('EOI refund quote could not be resolved.');

      const request = await trx
        .insertInto('eoi_refund_requests')
        .values({
          tenant_id: input.tenantId,
          project_id: input.projectId,
          eoi_id: row.eoiId,
          buyer_profile_id: row.buyerProfileId,
          refund_policy_id: row.policyId,
          stage: row.stage,
          eoi_status_at_request: row.eoiStatus,
          original_eoi_amount: row.originalAmount,
          refund_percent: row.refundPercent,
          processing_fee: row.processingFee,
          requested_amount: row.refundableAmount,
          currency: row.currency,
          status: 'REQUESTED',
          requested_by: input.actorUserId,
          requested_at: input.now,
          reviewed_by: null,
          reviewed_at: null,
          paid_at: null,
          decision_note: null,
          updated_at: input.now,
        })
        .returning('id')
        .executeTakeFirstOrThrow();

      await trx
        .updateTable('buyer_eois')
        .set({
          status: 'REFUND_REQUESTED',
          refund_requested_at: input.now,
          updated_at: input.now,
        })
        .where('id', '=', row.eoiId)
        .executeTakeFirstOrThrow();

      await trx
        .insertInto('domain_outbox_events')
        .values({
          tenant_id: input.tenantId,
          project_id: input.projectId,
          aggregate_type: 'EOI_REFUND_REQUEST',
          aggregate_id: request.id,
          event_type: 'eoi.refund.requested',
          payload: {
            eoiId: row.eoiId,
            buyerProfileId: row.buyerProfileId,
            stage: row.stage,
            refundableAmount: row.refundableAmount,
            currency: row.currency,
            actorUserId: input.actorUserId,
          },
          published_at: null,
          attempts: 0,
        })
        .execute();

      return { refundRequestId: request.id, quote: this.toQuote(row) };
    });
  }

  async review(input: {
    tenantId: string;
    projectId: string;
    refundRequestId: string;
    actorUserId: string;
    decision: 'APPROVE' | 'REJECT';
    note: string | null;
    now: Date;
  }): Promise<{ status: 'APPROVED' | 'REJECTED'; requestedAmount: string; currency: string }> {
    return this.db.transaction().execute(async (trx) => {
      const request = await trx
        .selectFrom('eoi_refund_requests')
        .select([
          'id',
          'eoi_id',
          'buyer_profile_id',
          'eoi_status_at_request',
          'requested_amount',
          'currency',
          'status',
        ])
        .where('id', '=', input.refundRequestId)
        .where('tenant_id', '=', input.tenantId)
        .where('project_id', '=', input.projectId)
        .forUpdate()
        .executeTakeFirst();
      if (!request || request.status !== 'REQUESTED') {
        throw new ConflictException('Pending refund request not found.');
      }

      const status = input.decision === 'APPROVE' ? 'APPROVED' : 'REJECTED';
      await trx
        .updateTable('eoi_refund_requests')
        .set({
          status,
          reviewed_by: input.actorUserId,
          reviewed_at: input.now,
          decision_note: input.note,
          updated_at: input.now,
        })
        .where('id', '=', request.id)
        .executeTakeFirstOrThrow();

      if (status === 'REJECTED') {
        await trx
          .updateTable('buyer_eois')
          .set({
            status: request.eoi_status_at_request,
            refund_requested_at: null,
            updated_at: input.now,
          })
          .where('id', '=', request.eoi_id)
          .where('status', '=', 'REFUND_REQUESTED')
          .executeTakeFirstOrThrow();
      }

      await trx
        .insertInto('domain_outbox_events')
        .values({
          tenant_id: input.tenantId,
          project_id: input.projectId,
          aggregate_type: 'EOI_REFUND_REQUEST',
          aggregate_id: request.id,
          event_type: status === 'APPROVED' ? 'eoi.refund.approved' : 'eoi.refund.rejected',
          payload: {
            eoiId: request.eoi_id,
            buyerProfileId: request.buyer_profile_id,
            requestedAmount: request.requested_amount as string,
            currency: request.currency,
            actorUserId: input.actorUserId,
          },
          published_at: null,
          attempts: 0,
        })
        .execute();

      return {
        status,
        requestedAmount: request.requested_amount as string,
        currency: request.currency,
      };
    });
  }

  private async quoteIn(
    executor: Kysely<Database> | Transaction<Database>,
    input: { tenantId: string; projectId: string; eoiId: string },
  ): Promise<RefundQuoteRow | null> {
    const result = await sql<RefundQuoteRow>`
      WITH eoi_scope AS (
        SELECT
          e.id,
          e.buyer_profile_id,
          b.user_id AS buyer_user_id,
          e.status,
          e.amount,
          e.currency,
          e.refund_policy_id
        FROM buyer_eois e
        JOIN buyer_profiles b
          ON b.id = e.buyer_profile_id
         AND b.tenant_id = e.tenant_id
        WHERE e.id = ${input.eoiId}
          AND e.tenant_id = ${input.tenantId}
          AND e.project_id = ${input.projectId}
          AND e.status IN ('PAID','APPLIED')
      ),
      reservation_scope AS (
        SELECT r.id, r.buyer_profile_id
        FROM reservations r
        JOIN queue_entries q
          ON q.id = r.queue_entry_id
         AND q.tenant_id = r.tenant_id
         AND q.project_id = r.project_id
        JOIN eoi_scope e ON e.id = q.eoi_id
        WHERE r.tenant_id = ${input.tenantId}
          AND r.project_id = ${input.projectId}
        ORDER BY r.reserved_at DESC
        LIMIT 1
      ),
      contract_scope AS (
        SELECT EXISTS (
          SELECT 1
          FROM transactions t
          JOIN reservation_scope r ON r.id = t.reservation_id
          JOIN transaction_milestones m ON m.transaction_id = t.id
          WHERE m.code IN ('CONTRACT_SIGNED','CONTRACT_STAMPED')
            AND m.status = 'COMPLETED'
        ) AS contract_executed
      ),
      stage_scope AS (
        SELECT CASE
          WHEN (SELECT contract_executed FROM contract_scope) THEN 'AFTER_CONTRACT'
          WHEN EXISTS (SELECT 1 FROM reservation_scope) THEN 'AFTER_RESERVATION_BEFORE_CONTRACT'
          ELSE 'BEFORE_RESERVATION'
        END AS stage
      )
      SELECT
        e.id AS "eoiId",
        e.buyer_profile_id AS "buyerProfileId",
        e.buyer_user_id AS "buyerUserId",
        e.status AS "eoiStatus",
        s.stage AS "stage",
        e.amount::text AS "originalAmount",
        (CASE s.stage
          WHEN 'BEFORE_RESERVATION' THEN p.before_reservation_refund_percent
          WHEN 'AFTER_RESERVATION_BEFORE_CONTRACT' THEN p.after_reservation_before_contract_refund_percent
          ELSE p.after_contract_refund_percent
        END)::text AS "refundPercent",
        p.processing_fee::text AS "processingFee",
        greatest(
          round(
            e.amount * (
              CASE s.stage
                WHEN 'BEFORE_RESERVATION' THEN p.before_reservation_refund_percent
                WHEN 'AFTER_RESERVATION_BEFORE_CONTRACT' THEN p.after_reservation_before_contract_refund_percent
                ELSE p.after_contract_refund_percent
              END
            ) / 100 - p.processing_fee,
            2
          ),
          0
        )::text AS "refundableAmount",
        e.currency AS "currency",
        p.id AS "policyId"
      FROM eoi_scope e
      JOIN eoi_refund_policies p ON p.id = e.refund_policy_id
      CROSS JOIN stage_scope s
    `.execute(executor);
    return result.rows[0] ?? null;
  }

  private toQuote(row: RefundQuoteRow): EoiRefundQuote & { buyerUserId: string; eoiStatus: 'PAID' | 'APPLIED' } {
    return {
      eoiId: row.eoiId,
      buyerProfileId: row.buyerProfileId,
      buyerUserId: row.buyerUserId,
      eoiStatus: row.eoiStatus,
      stage: row.stage,
      originalAmount: row.originalAmount,
      refundPercent: row.refundPercent,
      processingFee: row.processingFee,
      refundableAmount: row.refundableAmount,
      currency: row.currency,
      policyId: row.policyId,
    };
  }
}
