import { createDatabase } from '@preneura/database';
import { dispatchNotifications } from '../dist/notifications.js';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL is required');

const db = createDatabase(connectionString);
const TENANT_ID = '00000000-0000-0000-0000-000000001000';
const PROJECT_ID = '00000000-0000-0000-0000-000000002000';
const RECIPIENT_USER_ID = '00000000-0000-0000-0000-000000000001';
const PREFIX = `concurrency-worker-${Date.now()}`;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function main() {
  try {
    const now = new Date(Date.now() - 60_000);
    const values = Array.from({ length: 100 }, (_, index) => ({
      tenant_id: TENANT_ID,
      project_id: PROJECT_ID,
      transaction_id: null,
      recipient_user_id: RECIPIENT_USER_ID,
      audience: 'BUYER',
      channel: 'IN_APP',
      template_code: 'concurrency.certification',
      locale: 'en',
      payload: { index, certification: true },
      scheduled_for: now,
      status: 'PENDING',
      idempotency_key: `${PREFIX}-${index}`,
      attempts: 0,
      provider_message_id: null,
      last_error: null,
      sent_at: null,
      processing_started_at: null,
      processing_by: null,
    }));

    await db.insertInto('notification_jobs').values(values).execute();

    const startedAt = Date.now();
    const workers = Array.from({ length: 8 }, (_, index) =>
      dispatchNotifications(db, `concurrency-worker-${index}`, 25),
    );
    const claimedCounts = await Promise.all(workers);
    const elapsedMs = Date.now() - startedAt;

    const jobs = await db
      .selectFrom('notification_jobs')
      .select(['id', 'status', 'attempts', 'processing_by'])
      .where('idempotency_key', 'like', `${PREFIX}-%`)
      .execute();
    assert(jobs.length === 100, `expected 100 certification jobs, got ${jobs.length}`);
    assert(jobs.every((job) => job.status === 'SENT'), 'not all certification notification jobs are SENT');
    assert(jobs.every((job) => job.attempts === 1), 'a certification notification job was claimed more than once');
    assert(jobs.every((job) => job.processing_by === null), 'a certification notification job remained claimed');

    const jobIds = jobs.map((job) => job.id);
    const userNotifications = await db
      .selectFrom('user_notifications')
      .select(({ fn }) => fn.countAll<number>().as('count'))
      .where('notification_job_id', 'in', jobIds)
      .executeTakeFirstOrThrow();
    assert(Number(userNotifications.count) === 100, `expected 100 materialized notifications, got ${userNotifications.count}`);

    const attempts = await db
      .selectFrom('notification_delivery_attempts')
      .select(({ fn }) => [
        fn.countAll<number>().as('count'),
        fn.max('attempt_number').as('max_attempt'),
      ])
      .where('notification_job_id', 'in', jobIds)
      .executeTakeFirstOrThrow();
    assert(Number(attempts.count) === 100, `expected 100 delivery attempts, got ${attempts.count}`);
    assert(Number(attempts.max_attempt) === 1, `max delivery attempt was ${attempts.max_attempt}`);

    console.log(JSON.stringify({
      status: 'passed',
      jobs: 100,
      workers: 8,
      claimedByCalls: claimedCounts.reduce((sum, value) => sum + value, 0),
      elapsedMs,
    }, null, 2));
  } finally {
    await db.destroy();
  }
}

await main();
