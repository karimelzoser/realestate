import { createDatabase } from '@preneura/database';
import { scheduleInstallmentReminders } from '../installment-reminders.js';
import { scheduleMilestoneReminders } from '../milestone-reminders.js';

const IDS = {
  transaction: '40000000-0000-0000-0000-000000001001',
} as const;

function expect(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function countJobs(db: ReturnType<typeof createDatabase>, prefix: string, status: 'PENDING' | 'CANCELLED'): Promise<number> {
  const rows = await db
    .selectFrom('notification_jobs')
    .select('id')
    .where('idempotency_key', 'like', `${prefix}%`)
    .where('status', '=', status)
    .execute();
  return rows.length;
}

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is required');

  const db = createDatabase(connectionString);
  const now = new Date('2026-01-15T00:00:00Z');

  try {
    // Two audiences (buyer + attributed broker agent) are desired for each policy.
    await scheduleMilestoneReminders(db, now);
    await scheduleMilestoneReminders(db, now);
    expect(
      (await countJobs(db, 'milestone:v3:', 'PENDING')) === 2,
      'milestone reminder rerun created duplicate logical jobs or lost an audience',
    );

    await scheduleInstallmentReminders(db, now);
    await scheduleInstallmentReminders(db, now);
    expect(
      (await countJobs(db, 'installment:v1:', 'PENDING')) === 2,
      'installment reminder rerun created duplicate logical jobs or lost an audience',
    );

    // Authoritative state is re-read on every reconciliation pass. Once the
    // transaction is no longer actionable, every still-pending reminder is cancelled.
    await db
      .updateTable('transactions')
      .set({ status: 'CANCELLED', cancelled_at: now, updated_at: now })
      .where('id', '=', IDS.transaction)
      .executeTakeFirstOrThrow();

    await scheduleMilestoneReminders(db, new Date('2026-01-15T00:01:00Z'));
    await scheduleInstallmentReminders(db, new Date('2026-01-15T00:01:00Z'));

    expect(
      (await countJobs(db, 'milestone:v3:', 'PENDING')) === 0 &&
        (await countJobs(db, 'milestone:v3:', 'CANCELLED')) === 2,
      'milestone reminders were not cancelled after authoritative transaction state changed',
    );
    expect(
      (await countJobs(db, 'installment:v1:', 'PENDING')) === 0 &&
        (await countJobs(db, 'installment:v1:', 'CANCELLED')) === 2,
      'installment reminders were not cancelled after authoritative transaction state changed',
    );

    console.log('Gate 4 reminder certification passed.');
  } finally {
    await db.destroy();
  }
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
