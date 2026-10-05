import { Inject, Injectable } from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { Database } from '@preneura/database';
import type { TransactionTimelineEventSnapshot } from '@preneura/contracts/sales';
import { DATABASE } from '../database/database.module.js';

@Injectable()
export class TransactionTimelineRepository {
  constructor(@Inject(DATABASE) private readonly db: Kysely<Database>) {}

  async list(input: {
    tenantId: string;
    projectId: string;
    transactionId: string;
  }): Promise<TransactionTimelineEventSnapshot[]> {
    const rows = await this.db
      .selectFrom('transaction_events as e')
      .innerJoin('transactions as t', 't.id', 'e.transaction_id')
      .leftJoin('users as u', 'u.id', 'e.actor_user_id')
      .select([
        'e.id',
        'e.event_type',
        'e.actor_user_id',
        'u.display_name as actor_display_name',
        'e.metadata',
        'e.created_at',
      ])
      .where('t.id', '=', input.transactionId)
      .where('t.tenant_id', '=', input.tenantId)
      .where('t.project_id', '=', input.projectId)
      .orderBy('e.created_at', 'asc')
      .orderBy('e.id', 'asc')
      .execute();

    return rows.map((row) => ({
      eventId: row.id,
      eventType: row.event_type,
      actorUserId: row.actor_user_id,
      actorDisplayName: row.actor_display_name,
      metadata: row.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata)
        ? (row.metadata as Record<string, unknown>)
        : {},
      createdAt: (row.created_at as Date).toISOString(),
    }));
  }
}
