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
    const buyerClause = input.buyerUserId
      ? sql`AND b.user_id = ${input.buyerUserId}::uuid`
      : sql``;

    const result = await sql<{
      id: string;
      eoi_id: string;
      buyer_profile_id: string;
      buyer_user_id: string;
      buyer_display_name: string;
      stage: EoiRefundStage;
      original_eoi_amount: string;
      refund_percent: string;
      processing_fee: string;
      requested_amount: string;
      currency: string;
      status: EoiRefundRequestSnapshot['status'];
      requested_at: Date;
      reviewed_at: Date | null;
      paid_at: Date | null;
      decision_note: string | null;
      payout_reference: string | null;
      finance_event_id: string | null;
      retained_amount: string | null;
    }>`
      SELECT
        r.id,
        r.eoi_id,
        r.buyer_profile_id,
        b.user_id AS buyer_user_id,
        u.display_name AS buyer_display_name,
        r.stage,
        r.original_eoi_amount::text,
        r.refund_percent::text,
        r.processing_fee::text,
        r.requested_amount::text,
        r.currency,
        r.status,
        r.requested_at,
        r.reviewed_at,
        r.paid_at,
        r.decision_note,
        payout.external_reference AS payout_reference,
        payout.id AS finance_event_id,
        retained.amount::text AS retained_amount
      FROM eoi_refund_requests r
      JOIN buyer_profiles b
        ON b.id = r.buyer_profile_id
       AND b.tenant_id = r.tenant_id
      JOIN users u ON u.id = b.user_id
      LEFT JOIN eoi_finance_events payout
        ON payout.refund_request_id = r.id
       AND payout.event_type = 'REFUND_ISSUED'
      LEFT JOIN eoi_finance_events retained
        ON retained.refund_request_id = r.id
       AND retained.event_type = 'RETAINED_AMOUNT_RECOGNIZED'
      WHERE r.tenant_id = ${input.tenantId}::uuid
        AND r.project_id = ${input.projectId}::uuid
        ${buyerClause}
      ORDER BY r.requested_at DESC, r.id DESC
    `.execute(this.db);

    return result.rows.map((row) => ({
      refundRequestId: row.id,
      eoiId: row.eoi_id,
      buyerProfileId: row.buyer_profile_id,
      buyerUserId: row.buyer_user_id,
      buyerDisplayName: row.buyer_display_name,
      stage: row.stage,
      originalAmount: row.original_eoi_amount,
      refundPercent: row.refund_percent,
      processingFee: row.processing_fee,
      requestedAmount: row.requested_amount,
      currency: row.currency,
      status: row.status,
      requestedAt: row.requested_at.toISOString(),
      reviewedAt: row.reviewed_at?.toISOString() ?? null,
      paidAt: row.paid_at?.toISOString() ?? null,
      decisionNote: row.decision_note,
      payoutReference: row.payout_reference,
      financeEventId: row.finance_event_id,
      retainedAmount: row.retained_amount,
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
