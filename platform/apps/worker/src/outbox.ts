import { sql, type Kysely } from 'kysely';
import type { Database, RealtimeTopic } from '@preneura/database';

export async function dispatchOutbox(db: Kysely<Database>, batchSize = 100): Promise<number> {
  return db.transaction().execute(async (trx) => {
    const rows = await trx
      .selectFrom('domain_outbox_events')
      .select([
        'id',
        'tenant_id',
        'project_id',
        'aggregate_type',
        'event_type',
        'occurred_at',
      ])
      .where('published_at', 'is', null)
      .orderBy('occurred_at', 'asc')
      .orderBy('id', 'asc')
      .forUpdate()
      .skipLocked()
      .limit(batchSize)
      .execute();

    for (const row of rows) {
      await trx
        .insertInto('realtime_events')
        .values({
          outbox_event_id: row.id,
          tenant_id: row.tenant_id,
          project_id: row.project_id,
          topic: topicFor(row.event_type),
          source_event_type: row.event_type,
          source_aggregate_type: row.aggregate_type,
          occurred_at: row.occurred_at as Date,
        })
        .onConflict((oc) => oc.column('outbox_event_id').doNothing())
        .execute();

      await trx
        .updateTable('domain_outbox_events')
        .set({
          published_at: new Date(),
          attempts: sql<number>`attempts + 1`,
        })
        .where('id', '=', row.id)
        .execute();
    }

    return rows.length;
  });
}

function topicFor(eventType: string): RealtimeTopic {
  if (eventType.startsWith('catalog.')) return 'CATALOG';
  if (eventType.startsWith('inventory.')) return 'INVENTORY';
  if (eventType.startsWith('pricing.')) return 'PRICING';
  if (eventType.startsWith('queue.')) return 'QUEUE';
  if (
    eventType.startsWith('transaction.') ||
    eventType.startsWith('document.') ||
    eventType.startsWith('documents.') ||
    eventType.startsWith('finance.') ||
    eventType.startsWith('contract.') ||
    eventType.startsWith('reservation.')
  ) return 'TRANSACTION';
  if (eventType.startsWith('commission.')) return 'COMMISSION';
  if (eventType.startsWith('refund.') || eventType.startsWith('eoi.refund.')) return 'REFUND';
  return 'DOMAIN';
}
