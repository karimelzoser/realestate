import { sql, type Kysely } from 'kysely';
import type {
  Database,
  NotificationAudience,
  NotificationChannel,
} from '@preneura/database';
import { enqueueNotification } from './notifications.js';
import { resolveNotificationRecipients } from './notification-recipients.js';

interface InstallmentReminderRow {
  payment_item_id: string;
  sequence_number: number;
  item_type: 'DOWN_PAYMENT' | 'INSTALLMENT' | 'FEE';
  amount: string;
  due_at: Date;
  currency: string;
  transaction_id: string;
  tenant_id: string;
  project_id: string;
  buyer_user_id: string;
  broker_company_id: string | null;
  broker_agent_user_id: string | null;
  audience: NotificationAudience;
  channel: NotificationChannel;
  reminder_hours_before: number;
  template_code: string;
  locale: string;
}

export async function scheduleInstallmentReminders(
  db: Kysely<Database>,
  now = new Date(),
): Promise<number> {
  const result = await sql<InstallmentReminderRow>`
    SELECT
      item.id AS payment_item_id,
      item.sequence_number,
      item.item_type,
      item.amount::text AS amount,
      item.due_at,
      schedule.currency,
      schedule.transaction_id,
      transaction.tenant_id,
      transaction.project_id,
      buyer.user_id AS buyer_user_id,
      buyer.broker_company_id,
      buyer.broker_agent_user_id,
      policy.audience,
      policy.channel,
      policy.reminder_hours_before,
      policy.template_code,
      policy.locale
    FROM payment_schedule_items item
    JOIN payment_schedules schedule
      ON schedule.id = item.payment_schedule_id
    JOIN transactions transaction
      ON transaction.id = schedule.transaction_id
      AND transaction.tenant_id = schedule.tenant_id
      AND transaction.project_id = schedule.project_id
    JOIN buyer_profiles buyer
      ON buyer.id = transaction.buyer_profile_id
      AND buyer.tenant_id = transaction.tenant_id
    JOIN project_installment_reminder_policies policy
      ON policy.tenant_id = transaction.tenant_id
      AND policy.project_id = transaction.project_id
      AND policy.item_type = item.item_type
    WHERE policy.enabled = true
      AND schedule.status = 'ACTIVE'
      AND transaction.status IN ('IN_PROGRESS','READY_FOR_COMPLETION')
      AND item.status IN ('UPCOMING','DUE','OVERDUE')
  `.execute(db);

  const desiredKeys = new Set<string>();
  let scheduled = 0;

  for (const row of result.rows) {
    const dueAt = row.due_at as Date;
    const scheduledFor = new Date(
      dueAt.getTime() - row.reminder_hours_before * 60 * 60 * 1000,
    );
    const recipients = await resolveNotificationRecipients(db, {
      tenantId: row.tenant_id,
      projectId: row.project_id,
      audience: row.audience,
      buyerUserId: row.buyer_user_id,
      brokerCompanyId: row.broker_company_id,
      brokerAgentUserId: row.broker_agent_user_id,
      now,
    });

    for (const recipientUserId of recipients) {
      const idempotencyKey = installmentReminderKey({
        paymentItemId: row.payment_item_id,
        recipientUserId,
        audience: row.audience,
        channel: row.channel,
        reminderHoursBefore: row.reminder_hours_before,
        templateCode: row.template_code,
        locale: row.locale,
        dueAt,
        amount: row.amount,
      });
      desiredKeys.add(idempotencyKey);
      await enqueueNotification(db, {
        tenantId: row.tenant_id,
        projectId: row.project_id,
        transactionId: row.transaction_id,
        recipientUserId,
        audience: row.audience,
        channel: row.channel,
        templateCode: row.template_code,
        locale: row.locale,
        payload: {
          kind: 'INSTALLMENT_DUE',
          transactionId: row.transaction_id,
          paymentScheduleItemId: row.payment_item_id,
          sequenceNumber: row.sequence_number,
          itemType: row.item_type,
          amount: row.amount,
          currency: row.currency,
          dueAt: dueAt.toISOString(),
          overdue: dueAt.getTime() <= now.getTime(),
        },
        scheduledFor,
        idempotencyKey,
      });
      scheduled += 1;
    }
  }

  await cancelStaleInstallmentJobs(db, desiredKeys, now);
  return scheduled;
}

async function cancelStaleInstallmentJobs(
  db: Kysely<Database>,
  desiredKeys: ReadonlySet<string>,
  now: Date,
): Promise<void> {
  const pending = await db
    .selectFrom('notification_jobs')
    .select(['id', 'idempotency_key'])
    .where('status', '=', 'PENDING')
    .where('idempotency_key', 'like', 'installment:v1:%')
    .execute();

  const staleIds = pending
    .filter((job) => !desiredKeys.has(job.idempotency_key))
    .map((job) => job.id);

  if (staleIds.length === 0) return;
  await db
    .updateTable('notification_jobs')
    .set({ status: 'CANCELLED', updated_at: now })
    .where('id', 'in', staleIds)
    .where('status', '=', 'PENDING')
    .execute();
}

function installmentReminderKey(input: {
  paymentItemId: string;
  recipientUserId: string;
  audience: NotificationAudience;
  channel: NotificationChannel;
  reminderHoursBefore: number;
  templateCode: string;
  locale: string;
  dueAt: Date;
  amount: string;
}): string {
  const templateToken = Buffer.from(input.templateCode, 'utf8').toString('base64url');
  const localeToken = Buffer.from(input.locale, 'utf8').toString('base64url');
  const amountToken = Buffer.from(input.amount, 'utf8').toString('base64url');
  return [
    'installment',
    'v1',
    input.paymentItemId,
    input.recipientUserId,
    input.audience,
    input.channel,
    String(input.reminderHoursBefore),
    String(input.dueAt.getTime()),
    amountToken,
    templateToken,
    localeToken,
  ].join(':');
}
