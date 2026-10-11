import { Inject, Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import type { Database } from '@preneura/database';
import type { CreateProjectInput } from '@preneura/contracts/platform-admin';
import { DATABASE } from '../database/database.module.js';

@Injectable()
export class OnboardingProjectRepository {
  constructor(@Inject(DATABASE) private readonly db: Kysely<Database>) {}

  async createProject(input: {
    tenantId: string;
    actorUserId: string;
    data: CreateProjectInput;
  }): Promise<{ projectId: string }> {
    return this.db.transaction().execute(async (trx) => {
      const inserted = await sql<{ project_id: string }>`
        INSERT INTO projects (tenant_id, code, name, status, currency, timezone)
        VALUES (
          ${input.tenantId}::uuid,
          ${input.data.code.toUpperCase()},
          ${input.data.name},
          'DRAFT',
          ${input.data.currency},
          ${input.data.timezone}
        )
        RETURNING id AS project_id
      `.execute(trx);
      const projectId = inserted.rows[0]!.project_id;

      await sql`
        INSERT INTO developer_onboarding_events (
          tenant_id, project_id, actor_user_id, event_type, metadata
        ) VALUES (
          ${input.tenantId}::uuid,
          ${projectId}::uuid,
          ${input.actorUserId}::uuid,
          'PROJECT_CREATED',
          ${JSON.stringify({ code: input.data.code.toUpperCase(), name: input.data.name })}::jsonb
        )
      `.execute(trx);

      await sql`
        INSERT INTO domain_outbox_events (
          tenant_id, project_id, aggregate_type, aggregate_id, event_type, payload, attempts
        ) VALUES (
          ${input.tenantId}::uuid,
          ${projectId}::uuid,
          'PROJECT',
          ${projectId},
          'project.created',
          ${JSON.stringify({ actorUserId: input.actorUserId, code: input.data.code.toUpperCase(), name: input.data.name })}::jsonb,
          0
        )
      `.execute(trx);

      return { projectId };
    });
  }

  async setProjectStatus(input: {
    tenantId: string;
    projectId: string;
    actorUserId: string;
    status: 'DRAFT' | 'ACTIVE' | 'PAUSED' | 'CLOSED' | 'ARCHIVED';
  }): Promise<boolean> {
    return this.db.transaction().execute(async (trx) => {
      const updated = await sql<{ project_id: string }>`
        UPDATE projects
        SET status = ${input.status}, updated_at = now()
        WHERE id = ${input.projectId}::uuid
          AND tenant_id = ${input.tenantId}::uuid
        RETURNING id AS project_id
      `.execute(trx);
      if (!updated.rows[0]) return false;

      await sql`
        INSERT INTO developer_onboarding_events (
          tenant_id, project_id, actor_user_id, event_type, metadata
        ) VALUES (
          ${input.tenantId}::uuid,
          ${input.projectId}::uuid,
          ${input.actorUserId}::uuid,
          'PROJECT_LIFECYCLE_CHANGED',
          ${JSON.stringify({ status: input.status })}::jsonb
        )
      `.execute(trx);

      await sql`
        INSERT INTO domain_outbox_events (
          tenant_id, project_id, aggregate_type, aggregate_id, event_type, payload, attempts
        ) VALUES (
          ${input.tenantId}::uuid,
          ${input.projectId}::uuid,
          'PROJECT',
          ${input.projectId},
          'project.status_changed',
          ${JSON.stringify({ actorUserId: input.actorUserId, status: input.status })}::jsonb,
          0
        )
      `.execute(trx);
      return true;
    });
  }
}
