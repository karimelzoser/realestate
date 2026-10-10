import { hostname } from 'node:os';
import { createDatabase } from '@preneura/database';
import { assertRuntimeReadiness } from '@preneura/database/runtime-readiness';
import { createLogger, recordWorkerLoop, withRuntimeSpan } from '@preneura/observability';
import { refreshCommissionDueStates } from './commissions.js';
import { expireInventoryLocks } from './inventory-lock-expiry.js';
import { scheduleInstallmentReminders } from './installment-reminders.js';
import { scheduleMilestoneReminders } from './milestone-reminders.js';
import { dispatchOutbox } from './outbox.js';
import { dispatchNotifications } from './notifications.js';
import { validateWorkerRuntimeConfig } from './runtime-config.js';

validateWorkerRuntimeConfig();

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL is required');

const db = createDatabase(connectionString);
const workerId = process.env.WORKER_ID ?? `${hostname()}:${process.pid}`;
const logger = createLogger('preneura-worker', { workerId });
let stopping = false;
const shutdownWakeups = new Set<() => void>();

async function runLoop(
  name: string,
  delayMs: number,
  task: () => Promise<number>,
): Promise<void> {
  while (!stopping) {
    const startedAt = performance.now();
    let processed = 0;
    let success = false;
    try {
      processed = await withRuntimeSpan(
        `worker.${name}`,
        { 'preneura.worker.loop': name },
        task,
      );
      success = true;
      if (processed > 0) logger.info({ event: `${name}.processed`, processed });
    } catch (error) {
      logger.error({
        event: `${name}.failed`,
        err: error instanceof Error ? error : new Error(String(error)),
      });
    } finally {
      recordWorkerLoop({
        loop: name,
        durationMs: Math.max(0, performance.now() - startedAt),
        processed,
        success,
      });
    }
    if (stopping) break;
    await sleep(delayMs);
  }
}

async function main(): Promise<void> {
  logger.info({ event: 'worker.starting' });
  const readiness = await assertRuntimeReadiness(db);
  logger.info({
    event: 'worker.ready',
    runtimeSchemaVersion: readiness.runtimeSchemaVersion,
    databaseSchemaVersion: readiness.databaseSchemaVersion,
    minimumRuntimeVersion: readiness.minimumRuntimeVersion,
    migrationMarker: readiness.migrationMarker,
    databaseLatencyMs: readiness.latencyMs,
  });

  const loops = [
    runLoop('inventory_lock_expiry', Number(process.env.INVENTORY_LOCK_EXPIRY_SCAN_MS ?? 1000), () =>
      expireInventoryLocks(db, Number(process.env.INVENTORY_LOCK_EXPIRY_BATCH_SIZE ?? 500)),
    ),
    runLoop('outbox', Number(process.env.OUTBOX_POLL_MS ?? 300), () => dispatchOutbox(db, 100)),
    runLoop('notifications', Number(process.env.NOTIFICATION_POLL_MS ?? 1000), () =>
      dispatchNotifications(db, workerId, 25),
    ),
    runLoop('milestone_reminders', Number(process.env.SLA_SCAN_MS ?? 30_000), () =>
      scheduleMilestoneReminders(db),
    ),
    runLoop('installment_reminders', Number(process.env.INSTALLMENT_REMINDER_SCAN_MS ?? 30_000), () =>
      scheduleInstallmentReminders(db),
    ),
    runLoop('commission_due', Number(process.env.COMMISSION_DUE_SCAN_MS ?? 30_000), () =>
      refreshCommissionDueStates(db),
    ),
  ];

  await Promise.all(loops);
  await db.destroy();
  logger.info({ event: 'worker.stopped' });
}

async function shutdown(signal: string): Promise<void> {
  if (stopping) return;
  stopping = true;
  for (const wake of [...shutdownWakeups]) wake();
  logger.info({ event: 'worker.shutdown_requested', signal });
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

void main().catch(async (error) => {
  logger.fatal({
    event: 'worker.fatal',
    err: error instanceof Error ? error : new Error(String(error)),
  });
  await db.destroy().catch(() => undefined);
  process.exitCode = 1;
});

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      shutdownWakeups.delete(finish);
      resolve();
    };
    const timer = setTimeout(finish, Math.max(10, ms));
    shutdownWakeups.add(finish);
    if (stopping) finish();
  });
}
