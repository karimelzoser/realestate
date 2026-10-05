import { Inject, Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import type { Database } from '@preneura/database';
import type {
  RoleCode,
  ScopeType,
  WorkspaceContextSnapshot,
  WorkspaceProjectSnapshot,
} from '@preneura/contracts/access';
import { DATABASE } from '../database/database.module.js';

export interface RoleAssignment {
  id: string;
  role: RoleCode;
  scopeType: ScopeType;
  tenantId: string | null;
  projectId: string | null;
  brokerCompanyId: string | null;
}

type ProjectRow = {
  id: string;
  tenant_id: string;
  code: string;
  name: string;
  status: 'DRAFT' | 'ACTIVE' | 'PAUSED' | 'CLOSED' | 'ARCHIVED';
  currency: string;
  timezone: string;
  tenant_code: string;
  tenant_name: string;
};

export abstract class AccessRepository {
  abstract listActiveAssignments(userId: string): Promise<RoleAssignment[]>;
  abstract workspaceContext(userId: string, at: Date): Promise<WorkspaceContextSnapshot | null>;
  abstract brokerCompanyCanAccessProject(input: {
    tenantId: string;
    brokerCompanyId: string;
    projectId: string;
    at: Date;
  }): Promise<boolean>;
  abstract hasActivePlatformSupportAccess(input: {
    userId: string;
    tenantId: string;
    projectId?: string;
    at: Date;
  }): Promise<boolean>;
}

@Injectable()
export class PostgresAccessRepository extends AccessRepository {
  constructor(@Inject(DATABASE) private readonly db: Kysely<Database>) {
    super();
  }

  async listActiveAssignments(userId: string): Promise<RoleAssignment[]> {
    const rows = await this.db
      .selectFrom('access_role_assignments')
      .select([
        'id',
        'role_code',
        'scope_type',
        'tenant_id',
        'project_id',
        'broker_company_id',
      ])
      .where('user_id', '=', userId)
      .where('status', '=', 'ACTIVE')
      .where('revoked_at', 'is', null)
      .execute();

    return rows.map((row) => ({
      id: row.id,
      role: row.role_code as RoleCode,
      scopeType: row.scope_type as ScopeType,
      tenantId: row.tenant_id,
      projectId: row.project_id,
      brokerCompanyId: row.broker_company_id,
    }));
  }

  async workspaceContext(userId: string, at: Date): Promise<WorkspaceContextSnapshot | null> {
    const user = await this.db
      .selectFrom('users')
      .select(['id', 'display_name'])
      .where('id', '=', userId)
      .where('status', '=', 'ACTIVE')
      .executeTakeFirst();
    if (!user) return null;

    const assignments = await this.listActiveAssignments(userId);
    const projectRows = new Map<string, ProjectRow>();
    const hasPlatformScope = assignments.some((assignment) => assignment.scopeType === 'PLATFORM');
    const tenantIds = unique(assignments
      .filter((assignment) => assignment.scopeType === 'TENANT' && assignment.tenantId)
      .map((assignment) => assignment.tenantId!));
    const assignedProjectIds = unique(assignments
      .filter((assignment) => assignment.scopeType === 'PROJECT' && assignment.projectId)
      .map((assignment) => assignment.projectId!));
    const brokerCompanyIds = unique(assignments
      .filter((assignment) => assignment.scopeType === 'BROKER_COMPANY' && assignment.brokerCompanyId)
      .map((assignment) => assignment.brokerCompanyId!));

    const brokerAccessRows = brokerCompanyIds.length === 0
      ? []
      : await this.db
        .selectFrom('broker_project_access')
        .select(['tenant_id', 'project_id', 'broker_company_id'])
        .where('broker_company_id', 'in', brokerCompanyIds)
        .where('status', '=', 'ACTIVE')
        .where('effective_from', '<=', at)
        .where((eb) => eb.or([
          eb('effective_to', 'is', null),
          eb('effective_to', '>', at),
        ]))
        .execute();
    const brokerProjectIds = unique(brokerAccessRows.map((row) => row.project_id));
    const brokerProjectKeys = new Set(
      brokerAccessRows.map((row) => `${row.project_id}:${row.broker_company_id}`),
    );

    const selectProjects = () => this.db
      .selectFrom('projects as p')
      .innerJoin('tenants as t', 't.id', 'p.tenant_id')
      .select([
        'p.id', 'p.tenant_id', 'p.code', 'p.name', 'p.status', 'p.currency', 'p.timezone',
        't.code as tenant_code', 't.name as tenant_name',
      ])
      .where('p.status', '!=', 'ARCHIVED')
      .where('t.status', '=', 'ACTIVE');

    if (hasPlatformScope) {
      for (const row of await selectProjects().execute()) projectRows.set(row.id, row);
    } else {
      if (tenantIds.length > 0) {
        for (const row of await selectProjects().where('p.tenant_id', 'in', tenantIds).execute()) {
          projectRows.set(row.id, row);
        }
      }
      const explicitIds = unique([...assignedProjectIds, ...brokerProjectIds]);
      if (explicitIds.length > 0) {
        for (const row of await selectProjects().where('p.id', 'in', explicitIds).execute()) {
          projectRows.set(row.id, row);
        }
      }
    }

    const projects: WorkspaceProjectSnapshot[] = [...projectRows.values()]
      .map((project) => {
        const projectAssignments = assignments.filter((assignment) => {
          if (assignment.scopeType === 'PLATFORM') return true;
          if (assignment.scopeType === 'TENANT') return assignment.tenantId === project.tenant_id;
          if (assignment.scopeType === 'PROJECT') return assignment.projectId === project.id;
          return Boolean(
            assignment.brokerCompanyId &&
            brokerProjectKeys.has(`${project.id}:${assignment.brokerCompanyId}`),
          );
        });
        const roles = unique(projectAssignments.map((assignment) => assignment.role));
        const projectBrokerCompanyIds = unique(projectAssignments
          .filter((assignment) => assignment.scopeType === 'BROKER_COMPANY' && assignment.brokerCompanyId)
          .map((assignment) => assignment.brokerCompanyId!));
        return {
          tenantId: project.tenant_id,
          tenantCode: project.tenant_code,
          tenantName: project.tenant_name,
          projectId: project.id,
          projectCode: project.code,
          projectName: project.name,
          projectStatus: project.status as WorkspaceProjectSnapshot['projectStatus'],
          currency: project.currency,
          timezone: project.timezone,
          roles,
          brokerCompanyIds: projectBrokerCompanyIds,
        };
      })
      .filter((project) => project.roles.length > 0)
      .sort((a, b) => a.tenantName.localeCompare(b.tenantName) || a.projectName.localeCompare(b.projectName));

    return {
      userId: user.id,
      displayName: user.display_name,
      assignments: assignments.map((assignment) => ({
        assignmentId: assignment.id,
        role: assignment.role,
        scopeType: assignment.scopeType,
        tenantId: assignment.tenantId,
        projectId: assignment.projectId,
        brokerCompanyId: assignment.brokerCompanyId,
      })),
      projects,
    };
  }

  async brokerCompanyCanAccessProject(input: {
    tenantId: string;
    brokerCompanyId: string;
    projectId: string;
    at: Date;
  }): Promise<boolean> {
    const row = await this.db
      .selectFrom('broker_project_access')
      .select('broker_company_id')
      .where('tenant_id', '=', input.tenantId)
      .where('broker_company_id', '=', input.brokerCompanyId)
      .where('project_id', '=', input.projectId)
      .where('status', '=', 'ACTIVE')
      .where('effective_from', '<=', input.at)
      .where((eb) =>
        eb.or([
          eb('effective_to', 'is', null),
          eb('effective_to', '>', input.at),
        ]),
      )
      .executeTakeFirst();

    return Boolean(row);
  }

  async hasActivePlatformSupportAccess(input: {
    userId: string;
    tenantId: string;
    projectId?: string;
    at: Date;
  }): Promise<boolean> {
    const result = input.projectId
      ? await sql<{ allowed: boolean }>`
          SELECT EXISTS (
            SELECT 1
            FROM platform_support_access_sessions session
            WHERE session.operator_user_id = ${input.userId}::uuid
              AND session.tenant_id = ${input.tenantId}::uuid
              AND session.status = 'ACTIVE'
              AND session.expires_at > ${input.at}
              AND (session.project_id IS NULL OR session.project_id = ${input.projectId}::uuid)
          ) AS allowed
        `.execute(this.db)
      : await sql<{ allowed: boolean }>`
          SELECT EXISTS (
            SELECT 1
            FROM platform_support_access_sessions session
            WHERE session.operator_user_id = ${input.userId}::uuid
              AND session.tenant_id = ${input.tenantId}::uuid
              AND session.status = 'ACTIVE'
              AND session.expires_at > ${input.at}
              AND session.project_id IS NULL
          ) AS allowed
        `.execute(this.db);
    return result.rows[0]?.allowed ?? false;
  }
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}
