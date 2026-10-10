import { sql, type Kysely } from 'kysely';
import type { Database } from '@preneura/database';

export async function expireInventoryLocks(
  db: Kysely<Database>,
  batchSize = 500,
): Promise<number> {
  const boundedBatchSize = Math.max(1, Math.min(5000, Math.trunc(batchSize)));
  const result = await sql<{ expired_count: number }>`
    SELECT preneura_expire_inventory_locks(${boundedBatchSize}, now()) AS expired_count
  `.execute(db);
  return Number(result.rows[0]?.expired_count ?? 0);
}
