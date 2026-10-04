import { Inject, Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import type { Database } from '@preneura/database';
import type { QueueEntrySnapshot } from '@preneura/contracts/sales';
import { DATABASE } from '../database/database.module.js';

@Injectable()
export class QueueDispatchRepository {
  constructor(@Inject(DATABASE) private readonly db: Kysely<Database>) {}

  async callNext(input: {
    tenantId: string;
    projectId: string;
    actorUserId: string;
    now: Date;
  }): Promise<QueueEntrySnapshot | null> {
    return this.db.transaction().execute(async (trx) => {
      const candidate = await sql<{
        id: string;
        buyerProfileId: string;
        buyerUserId: string;
        channel: 'ONSITE' | 'ONLINE' | 'BROKER';
        priorityGroup: 'STANDARD' | 'VIP' | 'RECOVERY';
        priorityScore: number;
        checkedInAt: Date;
      }>`
        SELECT
          q.id,
          q.buyer_profile_id AS "buyerProfileId",
          b.user_id AS "buyerUserId",
          q.channel,
          q.priority_group AS "priorityGroup",
          q.priority_score AS "priorityScore",
          q.checked_in_at AS "checkedInAt"
        FROM queue_entries q
        JOIN buyer_profiles b
          ON b.id = q.buyer_profile_id
         AND b.tenant_id = q.tenant_id
        WHERE q.tenant_id = ${input.tenantId}
          AND q.project_id = ${input.projectId}
          AND q.status = 'WAITING'
        ORDER BY
          CASE q.priority_group
            WHEN 'VIP' THEN 3
            WHEN 'RECOVERY' THEN 2
            ELSE 1
          END DESC,
          q.priority_score DESC,
          q.checked_in_at ASC,
          q.id ASC
        FOR UPDATE OF q SKIP LOCKED
        LIMIT 1
      `.execute(trx);
      const row = candidate.rows[0];
      if (!row) return null;

      await trx
        .updateTable('queue_entries')
        .set({ status: 'CALLED', called_at: input.now, updated_at: input.now })
        .where('id', '=', row.id)
        .where('status', '=', 'WAITING')
        .executeTakeFirstOrThrow();

      await trx
        .insertInto('domain_outbox_events')
        .values({
          tenant_id: input.tenantId,
          project_id: input.projectId,
          aggregate_type: 'QUEUE_ENTRY',
          aggregate_id: row.id,
          event_type: 'queue.called',
          payload: {
            buyerProfileId: row.buyerProfileId,
            actorUserId: input.actorUserId,
          },
          published_at: null,
          attempts: 0,
        })
        .execute();

      return {
        queueEntryId: row.id,
        buyerProfileId: row.buyerProfileId,
        buyerUserId: row.buyerUserId,
        channel: row.channel,
        priorityGroup: row.priorityGroup,
        priorityScore: row.priorityScore,
        status: 'CALLED',
        checkedInAt: row.checkedInAt.toISOString(),
        calledAt: input.now.toISOString(),
      };
    });
  }
}
