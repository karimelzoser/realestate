import { ConflictException, Inject, Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import type { Database } from '@preneura/database';
import { DATABASE } from '../database/database.module.js';

export interface EoiRefundPayoutResult {
  financeEventId: string;
  payoutReference: string;
}

@Injectable()
export class EoiFinanceRepository {
  constructor(@Inject(DATABASE) private readonly db: Kysely<Database>) {}

  async postPayment(input: {
    tenantId: string;
    projectId: string;
    eoiId: string;
    externalReference: string;
    actorUserId: string;
    occurredAt: Date;
  }): Promise<{ financeEventId: string }> {
    try {
      const result = await sql<{ finance_event_id: string }>`
        SELECT preneura_post_eoi_payment(
          ${input.tenantId}::uuid,
          ${input.projectId}::uuid,
          ${input.eoiId}::uuid,
          ${input.externalReference},
          ${input.actorUserId}::uuid,
          ${input.occurredAt},
          'MANUAL',
          NULL,
          NULL
        ) AS finance_event_id
      `.execute(this.db);
      const row = result.rows[0];
      if (!row) throw new ConflictException('EOI payment could not be recorded.');
      return { financeEventId: row.finance_event_id };
    } catch (error) {
      if (error instanceof ConflictException) throw error;
      throw new ConflictException(this.publicMessage(error, 'EOI payment could not be recorded.'));
    }
  }

  async payRefund(input: {
    tenantId: string;
    projectId: string;
    refundRequestId: string;
    payoutReference: string;
    actorUserId: string;
    occurredAt: Date;
  }): Promise<EoiRefundPayoutResult> {
    try {
      const result = await sql<{ finance_event_id: string }>`
        SELECT preneura_pay_eoi_refund(
          ${input.tenantId}::uuid,
          ${input.projectId}::uuid,
          ${input.refundRequestId}::uuid,
          ${input.payoutReference},
          ${input.actorUserId}::uuid,
          ${input.occurredAt}
        ) AS finance_event_id
      `.execute(this.db);
      const row = result.rows[0];
      if (!row) throw new ConflictException('EOI refund payout could not be recorded.');
      return { financeEventId: row.finance_event_id, payoutReference: input.payoutReference };
    } catch (error) {
      if (error instanceof ConflictException) throw error;
      throw new ConflictException(this.publicMessage(error, 'EOI refund payout could not be recorded.'));
    }
  }

  async payoutEvidence(input: {
    tenantId: string;
    projectId: string;
    refundRequestIds: readonly string[];
  }): Promise<Map<string, { payoutReference: string; financeEventId: string; retainedAmount: string | null }>> {
    if (input.refundRequestIds.length === 0) return new Map();
    const ids = sql.join(input.refundRequestIds.map((id) => sql`${id}::uuid`));

    const result = await sql<{
      refund_request_id: string;
      payout_reference: string;
      finance_event_id: string;
      retained_amount: string | null;
    }>`
      SELECT
        r.id AS refund_request_id,
        f.external_reference AS payout_reference,
        f.id AS finance_event_id,
        retained.amount::text AS retained_amount
      FROM eoi_refund_requests r
      JOIN eoi_finance_events f
        ON f.refund_request_id = r.id
       AND f.event_type = 'REFUND_ISSUED'
      LEFT JOIN eoi_finance_events retained
        ON retained.refund_request_id = r.id
       AND retained.event_type = 'RETAINED_AMOUNT_RECOGNIZED'
      WHERE r.tenant_id = ${input.tenantId}::uuid
        AND r.project_id = ${input.projectId}::uuid
        AND r.id IN (${ids})
    `.execute(this.db);

    return new Map(
      result.rows.map((row) => [
        row.refund_request_id,
        {
          payoutReference: row.payout_reference,
          financeEventId: row.finance_event_id,
          retainedAmount: row.retained_amount,
        },
      ]),
    );
  }

  private publicMessage(error: unknown, fallback: string): string {
    if (!(error instanceof Error)) return fallback;
    const known = [
      'EOI not found',
      'only a payment-pending EOI can receive payment',
      'EOI already has a different immutable payment receipt',
      'refund request not found',
      'refund request already has a different immutable payout',
      'only an approved refund request can be paid',
      'EOI is not awaiting an approved refund payout',
      'immutable EOI payment receipt is required before refund payout',
      'refund financial snapshot does not reconcile to the original EOI receipt',
      'refund cannot exceed original EOI receipt',
    ];
    return known.find((message) => error.message.includes(message)) ?? fallback;
  }
}
