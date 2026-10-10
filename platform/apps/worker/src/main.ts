import { hostname } from 'node:os';
import { createDatabase } from '@preneura/database';
import { assertRuntimeReadiness } from '@preneura/database/runtime-readiness';
import {
  createLogger,
  recordWorkerLoop,
  safeErrorType,
  withRuntimeSpan,
} from '@preneura/observability';
import { shutdownObservability } from '@preneura/observability/register';
import { refreshCommissionDueStates } from './commissions.js';
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

async function runLoop(
  name: string,
  delayMs: number,
  task: () => Promise<number>,
): Promise<void> {
  while (!stopping) {
    const startedAt = performance.now();
    try {
      const processed = await withRuntimeSpan(
        `worker.${name}`,
        { 'preneura.worker.loop': name },
        task,
      );
      const durationMs = Math.max(0, performance.now() - startedAt);
      recordWorkerLoop({ loop: name, durationMs, processed, success: true });
      if (processed > 0) {
        logger.info({
          event: 'worker.loop.processed',
          loop: name,
          processed,
          durationMs: Math.round(durationMs),
        });
      }
    } catch (error) {
      const durationMs = Math.max(0, performance.now() - startedAt);
      recordWorkerLoop({ loop: name, durationMs, processed: 0, success: false });
      logger.error({
        event: 'worker.loop.failed',
        loop: name,
        errorType: safeErrorType(error),
        durationMs: Math.round(durationMs),
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
  await shutdownObservabilityWithin(5_000);
}

async function shutdown(signal: string): Promise<void> {
  if (stopping) return;
  stopping = true;
  logger.info({ event: 'worker.shutdown_requested', signal });
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

void main().catch(async (error) => {
  logger.error({ event: 'worker.fatal', errorType: safeErrorType(error) });
  await db.destroy().catch(() => undefined);
  await shutdownObservabilityWithin(1_500);
  // Startup/readiness failure is unrecoverable. Do not let an unreachable telemetry exporter
  // keep a stale-schema worker alive after best-effort telemetry drain.
  process.exit(1);
});

async function shutdownObservabilityWithin(timeoutMs: number): Promise<void> {
  let timeout: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      shutdownObservability().catch(() => undefined),
      new Promise<void>((resolve) => {
        timeout = setTimeout(resolve, timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.max(10, ms)));
}
