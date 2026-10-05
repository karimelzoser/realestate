import { hostname } from 'node:os';
import { createDatabase } from '@preneura/database';
import { refreshCommissionDueStates } from './commissions.js';
import { scheduleInstallmentReminders } from './installment-reminders.js';
import { dispatchOutbox } from './outbox.js';
import { dispatchNotifications } from './notifications.js';
import { scheduleMilestoneSlas } from './sla.js';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL is required');

const db = createDatabase(connectionString);
const workerId = process.env.WORKER_ID ?? `${hostname()}:${process.pid}`;
let stopping = false;

function log(level: 'info' | 'error', event: string, details: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ level, event, workerId, at: new Date().toISOString(), ...details }));
}

async function runLoop(
  name: string,
  delayMs: number,
  task: () => Promise<number>,
): Promise<void> {
  while (!stopping) {
    try {
      const processed = await task();
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
  log('info', 'worker.started');

  const loops = [
    runLoop('outbox', Number(process.env.OUTBOX_POLL_MS ?? 300), () => dispatchOutbox(db, 100)),
    runLoop('notifications', Number(process.env.NOTIFICATION_POLL_MS ?? 1000), () =>
      dispatchNotifications(db, workerId, 25),
    ),
    runLoop('sla', Number(process.env.SLA_SCAN_MS ?? 30_000), () => scheduleMilestoneSlas(db)),
    runLoop('installment_reminders', Number(process.env.INSTALLMENT_REMINDER_SCAN_MS ?? 30_000), () =>
      scheduleInstallmentReminders(db),
    ),
    runLoop('commission_due', Number(process.env.COMMISSION_DUE_SCAN_MS ?? 30_000), () =>
      refreshCommissionDueStates(db),
    ),
  ];

  await Promise.all(loops);
  await db.destroy();
  log('info', 'worker.stopped');
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
  await db.destroy().catch(() => undefined);
  process.exitCode = 1;
});

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.max(10, ms)));
}
