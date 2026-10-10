import { Inject, Injectable } from '@nestjs/common';
import type { Database } from '@preneura/database';
import type { Kysely } from 'kysely';
import { DATABASE } from '../database/database.module.js';

export interface ManagementTenantProjectRecord {
  projectId: string;
  projectCode: string;
  projectName: string;
  projectStatus: 'DRAFT' | 'ACTIVE' | 'PAUSED' | 'CLOSED';
}

export interface ManagementTenantContext {
  tenantName: string;
  projects: ManagementTenantProjectRecord[];
}

@Injectable()
export class ManagementTenantRepository {
  constructor(@Inject(DATABASE) private readonly db: Kysely<Database>) {}

  async context(tenantId: string): Promise<ManagementTenantContext | null> {
    const tenant = await this.db
      .selectFrom('tenants')
      .select(['id', 'name'])
      .where('id', '=', tenantId)
      .where('status', 'in', ['ACTIVE', 'SUSPENDED'])
      .executeTakeFirst();

    if (!tenant) return null;

    const projects = await this.db
      .selectFrom('projects')
      .select(['id', 'code', 'name', 'status'])
      .where('tenant_id', '=', tenantId)
      .where('status', 'in', ['DRAFT', 'ACTIVE', 'PAUSED', 'CLOSED'])
      .orderBy('name', 'asc')
      .orderBy('id', 'asc')
      .execute();

    return {
      tenantName: tenant.name,
      projects: projects.map((project) => ({
        projectId: project.id,
        projectCode: project.code,
        projectName: project.name,
        projectStatus: project.status as ManagementTenantProjectRecord['projectStatus'],
      })),
    };
  }
}
