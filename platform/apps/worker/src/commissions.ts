import { sql, type Kysely } from 'kysely';
import type { Database } from '@preneura/database';

export async function refreshCommissionDueStates(
  db: Kysely<Database>,
  now = new Date(),
  limit = 200,
): Promise<number> {
  const rows = await db
    .selectFrom('broker_commission_cases')
    .select('transaction_id')
    .where('status', 'in', ['ELIGIBLE', 'INVOICED'])
    .where('due_at', 'is not', null)
    .where('due_at', '<=', now)
    .orderBy('due_at', 'asc')
    .limit(limit)
    .execute();

  for (const row of rows) {
    await sql`SELECT refresh_broker_commission_case(${row.transaction_id}::uuid)`.execute(db);
  }
  return rows.length;
}
