import type { Kysely } from 'kysely';
import type {
  AccessRoleCode,
  Database,
  NotificationAudience,
} from '@preneura/database';
import { enqueueNotification } from './notifications.js';

export async function scheduleMilestoneSlas(
  db: Kysely<Database>,
  now = new Date(),
): Promise<number> {
  const rows = await db
    .selectFrom('transaction_milestones as m')
    .innerJoin('transactions as t', 't.id', 'm.transaction_id')
    .innerJoin('buyer_profiles as b', (join) =>
      join.onRef('b.id', '=', 't.buyer_profile_id').onRef('b.tenant_id', '=', 't.tenant_id'),
    )
    .innerJoin('project_milestone_slas as s', (join) =>
      join
        .onRef('s.project_id', '=', 't.project_id')
        .onRef('s.tenant_id', '=', 't.tenant_id')
        .onRef('s.milestone_code', '=', 'm.code'),
    )
    .select([
      't.id as transaction_id',
      't.tenant_id',
      't.project_id',
      't.opened_at',
      'b.user_id as buyer_user_id',
      'b.broker_company_id',
      'b.broker_agent_user_id',
      'm.code as milestone_code',
      's.target_hours_after_open',
      's.reminder_hours_before',
      's.audience',
      's.channel',
      's.template_code',
    ])
    .where('s.enabled', '=', true)
    .where('t.status', 'in', ['IN_PROGRESS', 'READY_FOR_COMPLETION'])
    .where('m.status', 'in', ['PENDING', 'BLOCKED'])
    .execute();

  let scheduled = 0;
  for (const row of rows) {
    const targetAt = new Date(
      (row.opened_at as Date).getTime() + row.target_hours_after_open * 60 * 60 * 1000,
    );
    const scheduledFor = new Date(
      targetAt.getTime() - row.reminder_hours_before * 60 * 60 * 1000,
    );
    const recipients = await resolveRecipients(db, {
      tenantId: row.tenant_id,
      projectId: row.project_id,
      audience: row.audience,
      buyerUserId: row.buyer_user_id,
      brokerCompanyId: row.broker_company_id,
      brokerAgentUserId: row.broker_agent_user_id,
    });

    for (const recipientUserId of recipients) {
      await enqueueNotification(db, {
        tenantId: row.tenant_id,
        projectId: row.project_id,
        transactionId: row.transaction_id,
        recipientUserId,
        audience: row.audience,
        channel: row.channel,
        templateCode: row.template_code,
        payload: {
          kind: 'MILESTONE_SLA',
          transactionId: row.transaction_id,
          milestoneCode: row.milestone_code,
          targetAt: targetAt.toISOString(),
          overdue: targetAt.getTime() <= now.getTime(),
        },
        scheduledFor,
        idempotencyKey: `sla:${row.transaction_id}:${row.milestone_code}:${recipientUserId}`,
      });
      scheduled += 1;
    }
  }

  await cancelCompletedMilestoneJobs(db, now);
  return scheduled;
}

async function resolveRecipients(
  db: Kysely<Database>,
  input: {
    tenantId: string;
    projectId: string;
    audience: NotificationAudience;
    buyerUserId: string;
    brokerCompanyId: string | null;
    brokerAgentUserId: string | null;
  },
): Promise<string[]> {
  if (input.audience === 'BUYER') return [input.buyerUserId];
  if (input.audience === 'BROKER_AGENT') {
    return input.brokerAgentUserId ? [input.brokerAgentUserId] : [];
  }

  if (input.audience === 'BROKER_MANAGER' || input.audience === 'BROKER_FINANCE') {
    if (!input.brokerCompanyId) return [];
    const rows = await db
      .selectFrom('access_role_assignments')
      .select('user_id')
      .where('role_code', '=', input.audience)
      .where('scope_type', '=', 'BROKER_COMPANY')
      .where('tenant_id', '=', input.tenantId)
      .where('broker_company_id', '=', input.brokerCompanyId)
      .where('status', '=', 'ACTIVE')
      .where('revoked_at', 'is', null)
      .execute();
    return unique(rows.map((row) => row.user_id));
  }

  const roleCode = input.audience as AccessRoleCode;
  const rows = await db
    .selectFrom('access_role_assignments')
    .select(['user_id', 'scope_type', 'project_id', 'tenant_id'])
    .where('role_code', '=', roleCode)
    .where('status', '=', 'ACTIVE')
    .where('revoked_at', 'is', null)
    .where((eb) =>
      eb.or([
        eb.and([
          eb('scope_type', '=', 'PROJECT'),
          eb('tenant_id', '=', input.tenantId),
          eb('project_id', '=', input.projectId),
        ]),
        eb.and([
          eb('scope_type', '=', 'TENANT'),
          eb('tenant_id', '=', input.tenantId),
        ]),
      ]),
    )
    .execute();
  return unique(rows.map((row) => row.user_id));
}

async function cancelCompletedMilestoneJobs(db: Kysely<Database>, now: Date): Promise<void> {
  const pending = await db
    .selectFrom('notification_jobs as n')
    .innerJoin('transaction_milestones as m', 'm.transaction_id', 'n.transaction_id')
    .select(['n.id', 'n.payload', 'm.code', 'm.status'])
    .where('n.status', '=', 'PENDING')
    .where('n.template_code', 'is not', null)
    .where('m.status', 'in', ['COMPLETED', 'WAIVED'])
    .execute();

  const ids = pending
    .filter((row) => {
      const payload = row.payload;
      return Boolean(
        payload &&
        typeof payload === 'object' &&
        !Array.isArray(payload) &&
        payload.kind === 'MILESTONE_SLA' &&
        payload.milestoneCode === row.code,
      );
    })
    .map((row) => row.id);

  if (ids.length > 0) {
    await db
      .updateTable('notification_jobs')
      .set({ status: 'CANCELLED', updated_at: now })
      .where('id', 'in', ids)
      .execute();
  }
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
