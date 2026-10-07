import { hostname } from 'node:os';
import {
  currentTelemetryIdentity,
  initializeObservability,
  shutdownObservability,
  withObservedSpan,
} from '@preneura/observability';

initializeObservability('preneura-worker');

const workerId = process.env.WORKER_ID ?? `${hostname()}:${process.pid}`;
let stopping = false;

function log(level: 'info' | 'error', event: string, details: Record<string, unknown> = {}): void {
  console.log(
    JSON.stringify({
      level,
      event,
      workerId,
      at: new Date().toISOString(),
      ...currentTelemetryIdentity(),
      ...details,
    }),
  );
}

async function runLoop(
  name: string,
  delayMs: number,
  task: () => Promise<number>,
): Promise<void> {
  while (!stopping) {
    try {
      const processed = await withObservedSpan(
        `worker.${name}`,
        { 'preneura.worker.loop': name, 'preneura.worker.id': workerId },
        task,
      );
      if (processed > 0) log('info', `${name}.processed`, { processed });
    } catch (error) {
      log('error', `${name}.failed`, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
    if (stopping) break;
    await sleep(delayMs);
  }
}

async function main(): Promise<void> {
  const [
    { createDatabase },
    { assertRuntimeReadiness },
    { refreshCommissionDueStates },
    { scheduleInstallmentReminders },
    { scheduleMilestoneReminders },
    { dispatchOutbox },
    { dispatchNotifications },
    { validateWorkerRuntimeConfig },
  ] = await Promise.all([
    import('@preneura/database'),
    import('@preneura/database/runtime-readiness'),
    import('./commissions.js'),
    import('./installment-reminders.js'),
    import('./milestone-reminders.js'),
    import('./outbox.js'),
    import('./notifications.js'),
    import('./runtime-config.js'),
  ]);

  validateWorkerRuntimeConfig();
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is required');
  const db = createDatabase(connectionString);

  try {
    log('info', 'worker.starting');
    const readiness = await assertRuntimeReadiness(db);
    log('info', 'worker.ready', {
      runtimeSchemaVersion: readiness.runtimeSchemaVersion,
      databaseSchemaVersion: readiness.databaseSchemaVersion,
      minimumRuntimeVersion: readiness.minimumRuntimeVersion,
      migrationMarker: readiness.migrationMarker,
      databaseLatencyMs: readiness.latencyMs,
    });

    const loops = [
      runLoop('outbox', parsePositiveInteger(process.env.OUTBOX_POLL_MS, 300), () => dispatchOutbox(db, 100)),
      runLoop('notifications', parsePositiveInteger(process.env.NOTIFICATION_POLL_MS, 1000), () =>
        dispatchNotifications(db, workerId, 25),
      ),
      runLoop('milestone_reminders', parsePositiveInteger(process.env.SLA_SCAN_MS, 30_000), () =>
        scheduleMilestoneReminders(db),
      ),
      runLoop(
        'installment_reminders',
        parsePositiveInteger(process.env.INSTALLMENT_REMINDER_SCAN_MS, 30_000),
        () => scheduleInstallmentReminders(db),
      ),
      runLoop('commission_due', parsePositiveInteger(process.env.COMMISSION_DUE_SCAN_MS, 30_000), () =>
        refreshCommissionDueStates(db),
      ),
    ];

    await Promise.all(loops);
    log('info', 'worker.stopped');
  } finally {
    await db.destroy().catch(() => undefined);
    await shutdownObservability().catch(() => undefined);
  }
}

async function shutdown(signal: string): Promise<void> {
  if (stopping) return;
  stopping = true;
  log('info', 'worker.shutdown_requested', { signal });
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

void main().catch(async (error) => {
  log('error', 'worker.fatal', { error: error instanceof Error ? error.message : String(error) });
  await shutdownObservability().catch(() => undefined);
  process.exitCode = 1;
});

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.max(10, ms)));
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
