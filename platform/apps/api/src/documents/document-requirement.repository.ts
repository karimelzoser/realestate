import { Inject, Injectable } from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { Database } from '@preneura/database';
import type {
  ProjectDocumentRequirementSnapshot,
  UpsertProjectDocumentRequirementInput,
} from '@preneura/contracts/documents';
import { DATABASE } from '../database/database.module.js';

@Injectable()
export class DocumentRequirementRepository {
  constructor(@Inject(DATABASE) private readonly db: Kysely<Database>) {}

  async list(input: {
    tenantId: string;
    projectId: string;
  }): Promise<ProjectDocumentRequirementSnapshot[]> {
    const rows = await this.db
      .selectFrom('project_document_requirements')
      .select(['id', 'category', 'required_count', 'required_for_completion', 'updated_at'])
      .where('tenant_id', '=', input.tenantId)
      .where('project_id', '=', input.projectId)
      .orderBy('category', 'asc')
      .execute();

    return rows.map((row) => ({
      requirementId: row.id,
      category: row.category,
      requiredCount: row.required_count,
      requiredForCompletion: row.required_for_completion,
      updatedAt: (row.updated_at as Date).toISOString(),
    }));
  }

  async hasTransactionActivity(input: { tenantId: string; projectId: string }): Promise<boolean> {
    const row = await this.db
      .selectFrom('transactions')
      .select('id')
      .where('tenant_id', '=', input.tenantId)
      .where('project_id', '=', input.projectId)
      .limit(1)
      .executeTakeFirst();
    return Boolean(row);
  }

  async upsert(input: {
    actorUserId: string;
    data: UpsertProjectDocumentRequirementInput;
    now: Date;
  }): Promise<ProjectDocumentRequirementSnapshot> {
    return this.db.transaction().execute(async (trx) => {
      const row = await trx
        .insertInto('project_document_requirements')
        .values({
          tenant_id: input.data.tenantId,
          project_id: input.data.projectId,
          category: input.data.category,
          required_count: input.data.requiredCount,
          required_for_completion: input.data.requiredForCompletion,
          updated_at: input.now,
        })
        .onConflict((oc) =>
          oc.columns(['project_id', 'category']).doUpdateSet({
            required_count: input.data.requiredCount,
            required_for_completion: input.data.requiredForCompletion,
            updated_at: input.now,
          }),
        )
        .returning(['id', 'category', 'required_count', 'required_for_completion', 'updated_at'])
        .executeTakeFirstOrThrow();

      await trx.insertInto('domain_outbox_events').values({
        tenant_id: input.data.tenantId,
        project_id: input.data.projectId,
        aggregate_type: 'PROJECT_DOCUMENT_REQUIREMENT',
        aggregate_id: row.id,
        event_type: 'documents.requirement.upserted',
        payload: {
          category: row.category,
          requiredCount: row.required_count,
          requiredForCompletion: row.required_for_completion,
          actorUserId: input.actorUserId,
        },
        published_at: null,
        attempts: 0,
      }).execute();

      return {
        requirementId: row.id,
        category: row.category,
        requiredCount: row.required_count,
        requiredForCompletion: row.required_for_completion,
        updatedAt: (row.updated_at as Date).toISOString(),
      };
    });
  }

  async remove(input: {
    actorUserId: string;
    tenantId: string;
    projectId: string;
    category: UpsertProjectDocumentRequirementInput['category'];
  }): Promise<boolean> {
    return this.db.transaction().execute(async (trx) => {
      const row = await trx
        .deleteFrom('project_document_requirements')
        .where('tenant_id', '=', input.tenantId)
        .where('project_id', '=', input.projectId)
        .where('category', '=', input.category)
        .returning('id')
        .executeTakeFirst();
      if (!row) return false;

      await trx.insertInto('domain_outbox_events').values({
        tenant_id: input.tenantId,
        project_id: input.projectId,
        aggregate_type: 'PROJECT_DOCUMENT_REQUIREMENT',
        aggregate_id: row.id,
        event_type: 'documents.requirement.removed',
        payload: {
          category: input.category,
          actorUserId: input.actorUserId,
        },
        published_at: null,
        attempts: 0,
      }).execute();
      return true;
    });
  }
}
