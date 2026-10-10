import { Inject, Injectable } from '@nestjs/common';
import type { Database } from '@preneura/database';
import type { PermissionCode, RoleCode } from '@preneura/contracts/access';
import type { Kysely } from 'kysely';
import { DATABASE } from '../database/database.module.js';
import type { RoleAssignment } from './access.repository.js';

export interface LifecycleAccessContext {
  tenantId?: string;
  projectId?: string;
  brokerCompanyId?: string;
}

const DRAFT_ALLOWED_ROLES = new Set<RoleCode>([
  'OPERATIONS_DIRECTOR',
  'MANAGER',
]);

const DRAFT_ALLOWED_PERMISSIONS = new Set<PermissionCode>([
  'tenant.read',
  'tenant.projects.manage',
  'project.read',
  'project.manage',
  'project.import.manage',
  'pricing.read',
  'pricing.publish',
  'inventory.read',
  'documents.read',
  'documents.templates.manage',
  'commission.status.read',
  'commission.amount.read',
  'commission.rate.read',
  'commission.plan.manage',
  'notifications.read',
  'notifications.manage',
  'audit.read',
  'ai.manager.use',
  'ai.settings.manage',
]);

@Injectable()
export class AccessLifecycleService {
  constructor(@Inject(DATABASE) private readonly db: Kysely<Database>) {}

  async allowsAssignment(input: {
    userId: string;
    permission: PermissionCode;
    assignment: RoleAssignment;
    context: LifecycleAccessContext;
  }): Promise<boolean> {
    if (input.assignment.scopeType === 'PLATFORM') return true;

    const tenantId = input.context.tenantId ?? input.assignment.tenantId;
    if (!tenantId) return false;

    const tenant = await this.db
      .selectFrom('tenants as t')
      .leftJoin('tenant_memberships as tm', (join) =>
        join
          .onRef('tm.tenant_id', '=', 't.id')
          .on('tm.user_id', '=', input.userId),
      )
      .select([
        't.status as tenant_status',
        'tm.status as membership_status',
      ])
      .where('t.id', '=', tenantId)
      .executeTakeFirst();

    if (!tenant || tenant.tenant_status !== 'ACTIVE' || tenant.membership_status !== 'ACTIVE') {
      return false;
    }

    if (input.assignment.scopeType === 'BROKER_COMPANY') {
      const brokerCompanyId = input.context.brokerCompanyId ?? input.assignment.brokerCompanyId;
      if (!brokerCompanyId) return false;
      const broker = await this.db
        .selectFrom('broker_companies')
        .select(['tenant_id', 'status'])
        .where('id', '=', brokerCompanyId)
        .executeTakeFirst();
      if (!broker || broker.tenant_id !== tenantId || broker.status !== 'ACTIVE') return false;
    }

    const projectId = input.context.projectId ?? input.assignment.projectId;
    if (!projectId) return true;

    const project = await this.db
      .selectFrom('projects')
      .select(['tenant_id', 'status'])
      .where('id', '=', projectId)
      .executeTakeFirst();
    if (!project || project.tenant_id !== tenantId) return false;

    switch (project.status) {
      case 'ACTIVE':
        return true;
      case 'PAUSED':
      case 'CLOSED':
        return isReadOnlyPermission(input.permission);
      case 'DRAFT':
        return DRAFT_ALLOWED_ROLES.has(input.assignment.role) &&
          DRAFT_ALLOWED_PERMISSIONS.has(input.permission);
      case 'ARCHIVED':
        return false;
    }
  }

  async allowsPlatformSupport(input: {
    context: LifecycleAccessContext;
  }): Promise<boolean> {
    if (!input.context.tenantId) return false;
    const tenant = await this.db
      .selectFrom('tenants')
      .select('status')
      .where('id', '=', input.context.tenantId)
      .executeTakeFirst();
    if (!tenant || tenant.status !== 'ACTIVE') return false;

    if (!input.context.projectId) return true;
    const project = await this.db
      .selectFrom('projects')
      .select(['tenant_id', 'status'])
      .where('id', '=', input.context.projectId)
      .executeTakeFirst();
    return Boolean(
      project &&
      project.tenant_id === input.context.tenantId &&
      project.status !== 'ARCHIVED',
    );
  }
}

function isReadOnlyPermission(permission: PermissionCode): boolean {
  return permission.endsWith('.read') || permission.includes('.read.');
}
