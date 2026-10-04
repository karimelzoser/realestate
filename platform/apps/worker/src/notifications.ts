import { sql, type Kysely } from 'kysely';
import type {
  Database,
  JsonValue,
  NotificationAudience,
  NotificationChannel,
} from '@preneura/database';
import {
  deliverExternalNotification,
  type ClaimedNotification,
  type DeliveryResult,
} from './notification-delivery.js';

const MAX_ATTEMPTS = 5;
const PROCESSING_STALE_MS = 5 * 60 * 1000;

export async function dispatchNotifications(
  db: Kysely<Database>,
  workerId: string,
  batchSize = 25,
): Promise<number> {
  const now = new Date();
  await reclaimStaleNotifications(db, now);
  const jobs = await claimNotifications(db, workerId, now, batchSize);

  for (const job of jobs) {
    const startedAt = new Date();
    try {
      let result: DeliveryResult;
      if (job.channel === 'IN_APP') {
        await db.transaction().execute(async (trx) => {
          await trx
            .insertInto('user_notifications')
            .values({
              notification_job_id: job.id,
              tenant_id: job.tenantId,
              project_id: job.projectId,
              recipient_user_id: job.recipientUserId,
              template_code: job.templateCode,
              locale: job.locale,
              payload: job.payload,
              read_at: null,
            })
            .onConflict((oc) => oc.column('notification_job_id').doNothing())
            .execute();
        });
        result = { provider: 'IN_APP', providerMessageId: null };
      } else {
        result = await deliverExternalNotification(job);
      }
      await markNotificationSent(db, job, result, startedAt, new Date());
    } catch (error) {
      await markNotificationFailed(
        db,
        job,
        error instanceof Error ? error.message : String(error),
        startedAt,
        new Date(),
      );
    }
  }

  return jobs.length;
}

async function reclaimStaleNotifications(db: Kysely<Database>, now: Date): Promise<void> {
  const staleBefore = new Date(now.getTime() - PROCESSING_STALE_MS);
  await db
    .updateTable('notification_jobs')
    .set({
      status: 'PENDING',
      processing_started_at: null,
      processing_by: null,
      updated_at: now,
    })
    .where('status', '=', 'PROCESSING')
    .where('processing_started_at', '<=', staleBefore)
    .execute();
}

async function claimNotifications(
  db: Kysely<Database>,
  workerId: string,
  now: Date,
  batchSize: number,
): Promise<ClaimedNotification[]> {
  return db.transaction().execute(async (trx) => {
    const rows = await trx
      .selectFrom('notification_jobs')
      .select([
        'id', 'tenant_id', 'project_id', 'transaction_id', 'recipient_user_id',
        'channel', 'template_code', 'locale', 'payload', 'idempotency_key', 'attempts',
      ])
      .where('status', '=', 'PENDING')
      .where('scheduled_for', '<=', now)
      .orderBy('scheduled_for', 'asc')
      .orderBy('id', 'asc')
      .forUpdate()
      .skipLocked()
      .limit(batchSize)
      .execute();

    const claimed: ClaimedNotification[] = [];
    for (const row of rows) {
      const attemptNumber = row.attempts + 1;
      await trx
        .updateTable('notification_jobs')
        .set({
          status: 'PROCESSING',
          attempts: attemptNumber,
          processing_started_at: now,
          processing_by: workerId,
          updated_at: now,
        })
        .where('id', '=', row.id)
        .execute();
      claimed.push({
        id: row.id,
        tenantId: row.tenant_id,
        projectId: row.project_id,
        transactionId: row.transaction_id,
        recipientUserId: row.recipient_user_id,
        channel: row.channel,
        templateCode: row.template_code,
        locale: row.locale,
        payload: row.payload,
        idempotencyKey: row.idempotency_key,
        attemptNumber,
      });
    }
    return claimed;
  });
}

async function markNotificationSent(
  db: Kysely<Database>,
  job: ClaimedNotification,
  result: DeliveryResult,
  startedAt: Date,
  completedAt: Date,
): Promise<void> {
  await db.transaction().execute(async (trx) => {
    await trx
      .insertInto('notification_delivery_attempts')
      .values({
        notification_job_id: job.id,
        attempt_number: job.attemptNumber,
        provider: result.provider,
        result: 'SENT',
        provider_message_id: result.providerMessageId,
        error: null,
        started_at: startedAt,
        completed_at: completedAt,
      })
      .onConflict((oc) => oc.columns(['notification_job_id', 'attempt_number']).doNothing())
      .execute();

    await trx
      .updateTable('notification_jobs')
      .set({
        status: 'SENT',
        provider_message_id: result.providerMessageId,
        last_error: null,
        sent_at: completedAt,
        processing_started_at: null,
        processing_by: null,
        updated_at: completedAt,
      })
      .where('id', '=', job.id)
      .where('status', '=', 'PROCESSING')
      .execute();
  });
}

async function markNotificationFailed(
  db: Kysely<Database>,
  job: ClaimedNotification,
  error: string,
  startedAt: Date,
  completedAt: Date,
): Promise<void> {
  const terminal = job.attemptNumber >= MAX_ATTEMPTS;
  const backoffSeconds = Math.min(15 * 60, 30 * (2 ** Math.max(0, job.attemptNumber - 1)));
  const retryAt = new Date(completedAt.getTime() + backoffSeconds * 1000);

  await db.transaction().execute(async (trx) => {
    await trx
      .insertInto('notification_delivery_attempts')
      .values({
        notification_job_id: job.id,
        attempt_number: job.attemptNumber,
        provider: job.channel === 'IN_APP' ? 'IN_APP' : 'NOTIFICATION_GATEWAY',
        result: 'FAILED',
        provider_message_id: null,
        error: error.slice(0, 4000),
        started_at: startedAt,
        completed_at: completedAt,
      })
      .onConflict((oc) => oc.columns(['notification_job_id', 'attempt_number']).doNothing())
      .execute();

    await trx
      .updateTable('notification_jobs')
      .set({
        status: terminal ? 'FAILED' : 'PENDING',
        scheduled_for: terminal ? sql<Date>`scheduled_for` : retryAt,
        last_error: error.slice(0, 4000),
        processing_started_at: null,
        processing_by: null,
        updated_at: completedAt,
      })
      .where('id', '=', job.id)
      .where('status', '=', 'PROCESSING')
      .execute();
  });
}

export async function enqueueNotification(
  db: Kysely<Database>,
  input: {
    tenantId: string;
    projectId: string | null;
    transactionId: string | null;
    recipientUserId: string;
    audience: NotificationAudience;
    channel: NotificationChannel;
    templateCode: string;
    locale?: string;
    payload: JsonValue;
    scheduledFor: Date;
    idempotencyKey: string;
  },
): Promise<void> {
  await db
    .insertInto('notification_jobs')
    .values({
      tenant_id: input.tenantId,
      project_id: input.projectId,
      transaction_id: input.transactionId,
      recipient_user_id: input.recipientUserId,
      audience: input.audience,
      channel: input.channel,
      template_code: input.templateCode,
      locale: input.locale ?? 'ar-EG',
      payload: input.payload,
      scheduled_for: input.scheduledFor,
      status: 'PENDING',
      idempotency_key: input.idempotencyKey,
      attempts: 0,
      provider_message_id: null,
      last_error: null,
      sent_at: null,
      processing_started_at: null,
      processing_by: null,
    })
    .onConflict((oc) =>
      oc.column('idempotency_key').doUpdateSet({
        tenant_id: input.tenantId,
        project_id: input.projectId,
        transaction_id: input.transactionId,
        recipient_user_id: input.recipientUserId,
        audience: input.audience,
        channel: input.channel,
        template_code: input.templateCode,
        locale: input.locale ?? 'ar-EG',
        payload: input.payload,
        scheduled_for: input.scheduledFor,
        updated_at: new Date(),
      }).where('notification_jobs.status', '=', 'PENDING'),
    )
    .execute();
}
