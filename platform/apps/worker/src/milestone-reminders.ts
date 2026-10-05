import { sql, type Kysely } from 'kysely';
import type {
  Database,
  MilestoneCode,
  NotificationAudience,
  NotificationChannel,
} from '@preneura/database';
import { enqueueNotification } from './notifications.js';
import { resolveNotificationRecipients } from './notification-recipients.js';

interface MilestoneReminderRow {
  transaction_id: string;
  tenant_id: string;
  project_id: string;
  opened_at: Date;
  buyer_user_id: string;
  broker_company_id: string | null;
  broker_agent_user_id: string | null;
  milestone_code: MilestoneCode;
  target_hours_after_open: number;
  reminder_hours_before: number;
  audience: NotificationAudience;
  channel: NotificationChannel;
  template_code: string;
  locale: string;
}

export async function scheduleMilestoneReminders(
  db: Kysely<Database>,
  now = new Date(),
): Promise<number> {
  const result = await sql<MilestoneReminderRow>`
    SELECT
      transaction.id AS transaction_id,
      transaction.tenant_id,
      transaction.project_id,
      transaction.opened_at,
      buyer.user_id AS buyer_user_id,
      buyer.broker_company_id,
      buyer.broker_agent_user_id,
      milestone.code AS milestone_code,
      policy.target_hours_after_open,
      policy.reminder_hours_before,
      policy.audience,
      policy.channel,
      policy.template_code,
      policy.locale
    FROM transaction_milestones milestone
    JOIN transactions transaction
      ON transaction.id = milestone.transaction_id
    JOIN buyer_profiles buyer
      ON buyer.id = transaction.buyer_profile_id
      AND buyer.tenant_id = transaction.tenant_id
    JOIN project_milestone_reminder_policies policy
      ON policy.tenant_id = transaction.tenant_id
      AND policy.project_id = transaction.project_id
      AND policy.milestone_code = milestone.code
    WHERE policy.enabled = true
      AND transaction.status IN ('IN_PROGRESS','READY_FOR_COMPLETION')
      AND milestone.status IN ('PENDING','BLOCKED')
  `.execute(db);

  const desiredKeys = new Set<string>();
  let scheduled = 0;

  for (const row of result.rows) {
    const targetAt = new Date(
      (row.opened_at as Date).getTime() + row.target_hours_after_open * 60 * 60 * 1000,
    );
    const scheduledFor = new Date(
      targetAt.getTime() - row.reminder_hours_before * 60 * 60 * 1000,
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
      const idempotencyKey = milestoneReminderKey({
        transactionId: row.transaction_id,
        milestoneCode: row.milestone_code,
        recipientUserId,
        audience: row.audience,
        channel: row.channel,
        targetHoursAfterOpen: row.target_hours_after_open,
        reminderHoursBefore: row.reminder_hours_before,
        templateCode: row.template_code,
        locale: row.locale,
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
          kind: 'MILESTONE_SLA',
          transactionId: row.transaction_id,
          milestoneCode: row.milestone_code,
          targetAt: targetAt.toISOString(),
          overdue: targetAt.getTime() <= now.getTime(),
        },
        scheduledFor,
        idempotencyKey,
      });
      scheduled += 1;
    }
  }

  await cancelStaleMilestoneJobs(db, desiredKeys, now);
  return scheduled;
}

async function cancelStaleMilestoneJobs(
  db: Kysely<Database>,
  desiredKeys: ReadonlySet<string>,
  now: Date,
): Promise<void> {
  const pending = await db
    .selectFrom('notification_jobs')
    .select(['id', 'idempotency_key'])
    .where('status', '=', 'PENDING')
    .where('idempotency_key', 'like', 'milestone:v3:%')
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

function milestoneReminderKey(input: {
  transactionId: string;
  milestoneCode: string;
  recipientUserId: string;
  audience: NotificationAudience;
  channel: NotificationChannel;
  targetHoursAfterOpen: number;
  reminderHoursBefore: number;
  templateCode: string;
  locale: string;
}): string {
  const templateToken = Buffer.from(input.templateCode, 'utf8').toString('base64url');
  const localeToken = Buffer.from(input.locale, 'utf8').toString('base64url');
  return [
    'milestone',
    'v3',
    input.transactionId,
    input.milestoneCode,
    input.recipientUserId,
    input.audience,
    input.channel,
    String(input.targetHoursAfterOpen),
    String(input.reminderHoursBefore),
    templateToken,
    localeToken,
  ].join(':');
}
