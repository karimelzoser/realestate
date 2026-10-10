import { createServer } from 'node:http';
import { createDatabase } from '@preneura/database';
import { dispatchNotifications } from '../dist/notifications.js';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL is required');

const db = createDatabase(connectionString);
const TENANT_ID = '00000000-0000-0000-0000-000000001000';
const PROJECT_ID = '00000000-0000-0000-0000-000000002000';
const RECIPIENT_USER_ID = '00000000-0000-0000-0000-000000000001';
const PREFIX = `gate6-resilience-${Date.now()}`;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function insertJob(overrides) {
  const inserted = await db
    .insertInto('notification_jobs')
    .values({
      tenant_id: TENANT_ID,
      project_id: PROJECT_ID,
      transaction_id: null,
      recipient_user_id: RECIPIENT_USER_ID,
      audience: 'BUYER',
      channel: 'IN_APP',
      template_code: 'gate6.resilience',
      locale: 'en',
      payload: { certification: true },
      scheduled_for: new Date(Date.now() - 60_000),
      status: 'PENDING',
      idempotency_key: `${PREFIX}-${crypto.randomUUID()}`,
      attempts: 0,
      provider_message_id: null,
      last_error: null,
      sent_at: null,
      processing_started_at: null,
      processing_by: null,
      ...overrides,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  return inserted.id;
}

async function certifyStaleClaimRecovery() {
  const jobId = await insertJob({
    channel: 'IN_APP',
    template_code: 'gate6.resilience.stale',
    status: 'PROCESSING',
    attempts: 1,
    processing_started_at: new Date(Date.now() - 6 * 60_000),
    processing_by: 'dead-worker',
  });

  const processed = await dispatchNotifications(db, 'gate6-recovery-worker', 1);
  assert(processed === 1, `expected one reclaimed job, processed ${processed}`);

  const job = await db
    .selectFrom('notification_jobs')
    .select(['status', 'attempts', 'processing_by', 'processing_started_at'])
    .where('id', '=', jobId)
    .executeTakeFirstOrThrow();
  assert(job.status === 'SENT', `reclaimed job status is ${job.status}`);
  assert(job.attempts === 2, `reclaimed job attempts is ${job.attempts}, expected 2`);
  assert(job.processing_by === null && job.processing_started_at === null, 'reclaimed job remained claimed');

  const notification = await db
    .selectFrom('user_notifications')
    .select(({ fn }) => fn.countAll().as('count'))
    .where('notification_job_id', '=', jobId)
    .executeTakeFirstOrThrow();
  assert(Number(notification.count) === 1, `reclaimed job materialized ${notification.count} user notifications`);

  const attempts = await db
    .selectFrom('notification_delivery_attempts')
    .select(['attempt_number', 'result'])
    .where('notification_job_id', '=', jobId)
    .execute();
  assert(attempts.length === 1, `expected one recovery delivery record, got ${attempts.length}`);
  assert(attempts[0].attempt_number === 2 && attempts[0].result === 'SENT', 'recovery attempt evidence is incorrect');

  return { jobId, attempts: job.attempts };
}

async function certifyGatewayFailurePolicy() {
  const server = createServer((request, response) => {
    request.resume();
    response.statusCode = 503;
    response.setHeader('content-type', 'text/plain');
    response.end('planned Gate 6 provider outage');
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });

  try {
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Unable to resolve local failure gateway port.');
    process.env.NOTIFICATION_GATEWAY_URL = `http://127.0.0.1:${address.port}`;
    process.env.NOTIFICATION_GATEWAY_TOKEN = 'gate6-certification-only-token';

    const transientId = await insertJob({
      channel: 'WHATSAPP',
      template_code: 'gate6.resilience.transient',
      attempts: 0,
    });
    const terminalId = await insertJob({
      channel: 'WHATSAPP',
      template_code: 'gate6.resilience.terminal',
      attempts: 4,
    });

    const before = new Date();
    const processed = await dispatchNotifications(db, 'gate6-provider-failure-worker', 10);
    assert(processed === 2, `expected two failed provider jobs to be processed, got ${processed}`);

    const rows = await db
      .selectFrom('notification_jobs')
      .select(['id', 'status', 'attempts', 'scheduled_for', 'last_error', 'processing_by'])
      .where('id', 'in', [transientId, terminalId])
      .execute();
    const transient = rows.find((row) => row.id === transientId);
    const terminal = rows.find((row) => row.id === terminalId);
    assert(transient && terminal, 'provider failure jobs were not found after dispatch');

    assert(transient.status === 'PENDING', `transient failure status is ${transient.status}`);
    assert(transient.attempts === 1, `transient failure attempts is ${transient.attempts}`);
    assert(transient.scheduled_for.getTime() > before.getTime(), 'transient failure did not schedule a future retry');
    assert(transient.last_error?.includes('503'), 'transient failure did not preserve provider error evidence');
    assert(transient.processing_by === null, 'transient failure remained claimed');

    assert(terminal.status === 'FAILED', `terminal failure status is ${terminal.status}`);
    assert(terminal.attempts === 5, `terminal failure attempts is ${terminal.attempts}`);
    assert(terminal.last_error?.includes('503'), 'terminal failure did not preserve provider error evidence');
    assert(terminal.processing_by === null, 'terminal failure remained claimed');

    const deliveryAttempts = await db
      .selectFrom('notification_delivery_attempts')
      .select(['notification_job_id', 'attempt_number', 'result'])
      .where('notification_job_id', 'in', [transientId, terminalId])
      .execute();
    assert(deliveryAttempts.length === 2, `expected two provider failure attempt records, got ${deliveryAttempts.length}`);
    assert(deliveryAttempts.every((attempt) => attempt.result === 'FAILED'), 'provider failure attempt evidence is not FAILED');
    assert(deliveryAttempts.some((attempt) => attempt.notification_job_id === transientId && attempt.attempt_number === 1), 'transient failure attempt #1 missing');
    assert(deliveryAttempts.some((attempt) => attempt.notification_job_id === terminalId && attempt.attempt_number === 5), 'terminal failure attempt #5 missing');

    return { transientAttempts: transient.attempts, terminalAttempts: terminal.attempts };
  } finally {
    await new Promise((resolve) => server.close(() => resolve()));
  }
}

async function main() {
  const startedAt = Date.now();
  try {
    const staleClaim = await certifyStaleClaimRecovery();
    const providerFailure = await certifyGatewayFailurePolicy();
    console.log(JSON.stringify({
      status: 'passed',
      elapsedMs: Date.now() - startedAt,
      staleClaim,
      providerFailure,
    }, null, 2));
  } finally {
    await db.destroy();
  }
}

await main();
