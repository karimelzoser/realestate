import type { Kysely } from 'kysely';
import type {
  AccessRoleCode,
  Database,
  NotificationAudience,
} from '@preneura/database';

export async function resolveNotificationRecipients(
  db: Kysely<Database>,
  input: {
    tenantId: string;
    projectId: string;
    audience: NotificationAudience;
    buyerUserId: string;
    brokerCompanyId: string | null;
    brokerAgentUserId: string | null;
    now: Date;
  },
): Promise<string[]> {
  if (input.audience === 'BUYER') return [input.buyerUserId];

  if (
    input.audience === 'BROKER_AGENT' ||
    input.audience === 'BROKER_MANAGER' ||
    input.audience === 'BROKER_FINANCE'
  ) {
    if (!input.brokerCompanyId) return [];
    const brokerHasAccess = await brokerCompanyCanAccessProject(db, {
      tenantId: input.tenantId,
      projectId: input.projectId,
      brokerCompanyId: input.brokerCompanyId,
      now: input.now,
    });
    if (!brokerHasAccess) return [];
  }

  if (input.audience === 'BROKER_AGENT') {
    if (!input.brokerAgentUserId || !input.brokerCompanyId) return [];
    const assignment = await db
      .selectFrom('access_role_assignments')
      .select('user_id')
      .where('user_id', '=', input.brokerAgentUserId)
      .where('role_code', '=', 'BROKER_AGENT')
      .where('scope_type', '=', 'BROKER_COMPANY')
      .where('tenant_id', '=', input.tenantId)
      .where('broker_company_id', '=', input.brokerCompanyId)
      .where('status', '=', 'ACTIVE')
      .where('revoked_at', 'is', null)
      .executeTakeFirst();
    return assignment ? [assignment.user_id] : [];
  }

  if (input.audience === 'BROKER_MANAGER' || input.audience === 'BROKER_FINANCE') {
    const rows = await db
      .selectFrom('access_role_assignments')
      .select('user_id')
      .where('role_code', '=', input.audience)
      .where('scope_type', '=', 'BROKER_COMPANY')
      .where('tenant_id', '=', input.tenantId)
      .where('broker_company_id', '=', input.brokerCompanyId!)
      .where('status', '=', 'ACTIVE')
      .where('revoked_at', 'is', null)
      .execute();
    return unique(rows.map((row) => row.user_id));
  }

  const roleCode = input.audience as AccessRoleCode;
  const rows = await db
    .selectFrom('access_role_assignments')
    .select('user_id')
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

async function brokerCompanyCanAccessProject(
  db: Kysely<Database>,
  input: {
    tenantId: string;
    projectId: string;
    brokerCompanyId: string;
    now: Date;
  },
): Promise<boolean> {
  const row = await db
    .selectFrom('broker_project_access')
    .select('broker_company_id')
    .where('tenant_id', '=', input.tenantId)
    .where('project_id', '=', input.projectId)
    .where('broker_company_id', '=', input.brokerCompanyId)
    .where('status', '=', 'ACTIVE')
    .where('effective_from', '<=', input.now)
    .where((eb) => eb.or([
      eb('effective_to', 'is', null),
      eb('effective_to', '>', input.now),
    ]))
    .executeTakeFirst();
  return Boolean(row);
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
