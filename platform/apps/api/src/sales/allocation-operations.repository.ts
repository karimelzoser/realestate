import { Inject, Injectable } from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { Database } from '@preneura/database';
import type { AllocationQueueEntrySnapshot } from '@preneura/contracts/allocation';
import { DATABASE } from '../database/database.module.js';

@Injectable()
export class AllocationOperationsRepository {
  constructor(@Inject(DATABASE) private readonly db: Kysely<Database>) {}

  async listQueue(input: {
    tenantId: string;
    projectId: string;
    now: Date;
  }): Promise<AllocationQueueEntrySnapshot[]> {
    const rows = await this.db
      .selectFrom('queue_entries as q')
      .innerJoin('buyer_profiles as b', (join) =>
        join.onRef('b.id', '=', 'q.buyer_profile_id').onRef('b.tenant_id', '=', 'q.tenant_id'),
      )
      .innerJoin('users as u', 'u.id', 'b.user_id')
      .leftJoin('inventory_locks as l', (join) =>
        join
          .onRef('l.tenant_id', '=', 'q.tenant_id')
          .onRef('l.project_id', '=', 'q.project_id')
          .onRef('l.buyer_user_id', '=', 'b.user_id')
          .on('l.status', '=', 'ACTIVE')
          .on('l.expires_at', '>', input.now),
      )
      .select([
        'q.id as queue_entry_id',
        'q.buyer_profile_id',
        'b.user_id as buyer_user_id',
        'u.display_name as buyer_display_name',
        'q.channel',
        'q.priority_group',
        'q.priority_score',
        'q.status',
        'q.checked_in_at',
        'q.called_at',
        'l.id as lock_id',
        'l.unit_type_id as lock_unit_type_id',
        'l.expires_at as lock_expires_at',
      ])
      .where('q.tenant_id', '=', input.tenantId)
      .where('q.project_id', '=', input.projectId)
      .where('q.status', 'in', ['WAITING', 'CALLED', 'LOCKED'])
      .orderBy('q.priority_group', 'desc')
      .orderBy('q.priority_score', 'desc')
      .orderBy('q.checked_in_at', 'asc')
      .orderBy('q.id', 'asc')
      .execute();

    return rows.map((row) => {
      const expiresAt = row.lock_expires_at ? (row.lock_expires_at as Date) : null;
      return {
        queueEntryId: row.queue_entry_id,
        buyerProfileId: row.buyer_profile_id,
        buyerUserId: row.buyer_user_id,
        buyerDisplayName: row.buyer_display_name,
        channel: row.channel,
        priorityGroup: row.priority_group,
        priorityScore: row.priority_score,
        status: row.status,
        checkedInAt: (row.checked_in_at as Date).toISOString(),
        calledAt: row.called_at ? (row.called_at as Date).toISOString() : null,
        activeLock:
          row.lock_id && row.lock_unit_type_id && expiresAt
            ? {
                lockId: row.lock_id,
                unitTypeId: row.lock_unit_type_id,
                expiresAt: expiresAt.toISOString(),
                remainingSeconds: Math.max(
                  0,
                  Math.ceil((expiresAt.getTime() - input.now.getTime()) / 1000),
                ),
              }
            : null,
      };
    });
  }
}
