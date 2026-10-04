import { Inject, Injectable } from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { Database } from '@preneura/database';
import type { RoleCode, ScopeType } from '@preneura/contracts/access';
import { DATABASE } from '../database/database.module.js';

export interface RoleAssignment {
  id: string;
  role: RoleCode;
  scopeType: ScopeType;
  tenantId: string | null;
  projectId: string | null;
  brokerCompanyId: string | null;
}

export abstract class AccessRepository {
  abstract listActiveAssignments(userId: string): Promise<RoleAssignment[]>;
  abstract brokerCompanyCanAccessProject(input: {
    tenantId: string;
    brokerCompanyId: string;
    projectId: string;
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
}
