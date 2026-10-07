import { ConflictException, Inject, Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import type { Database } from '@preneura/database';
import { DATABASE } from '../database/database.module.js';


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

  private publicMessage(error: unknown, fallback: string): string {
    if (!(error instanceof Error)) return fallback;
    const known = [
      'EOI not found',
      'only a payment-pending EOI can receive payment',
      'EOI already has a different immutable payment receipt',
    ];
    return known.find((message) => error.message.includes(message)) ?? fallback;
  }
}
