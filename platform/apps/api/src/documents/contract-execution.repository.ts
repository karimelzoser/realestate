import { ConflictException, Inject, Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import type { Database } from '@preneura/database';
import { DATABASE } from '../database/database.module.js';

@Injectable()
export class ContractExecutionRepository {
  constructor(@Inject(DATABASE) private readonly db: Kysely<Database>) {}

  async stampContract(input: {
    actorUserId: string;
    tenantId: string;
    projectId: string;
    transactionId: string;
    documentId: string;
    now: Date;
  }): Promise<void> {
    await this.db.transaction().execute(async (trx) => {
      const updated = await sql<{ id: string }>`
        UPDATE transaction_documents
        SET status = 'STAMPED',
            stamped_by = ${input.actorUserId}::uuid,
            stamped_at = ${input.now}::timestamptz,
            updated_at = ${input.now}::timestamptz
        WHERE id = ${input.documentId}::uuid
          AND tenant_id = ${input.tenantId}::uuid
          AND project_id = ${input.projectId}::uuid
          AND transaction_id = ${input.transactionId}::uuid
          AND category = 'CONTRACT'
          AND status = 'SIGNED'
        RETURNING id
      `.execute(trx);

      if (!updated.rows[0]) {
        throw new ConflictException('Only a fully signed trusted contract can be executed.');
      }

      await sql`
        UPDATE transaction_milestones
        SET status = 'COMPLETED',
            completed_at = ${input.now}::timestamptz,
            completed_by = ${input.actorUserId}::uuid,
            evidence_document_id = ${input.documentId}::uuid,
            updated_at = ${input.now}::timestamptz
        WHERE transaction_id = ${input.transactionId}::uuid
          AND code = 'CONTRACT_STAMPED'
          AND status IN ('PENDING','BLOCKED')
      `.execute(trx);

      await sql`
        INSERT INTO transaction_events (
          transaction_id, actor_user_id, event_type, metadata
        ) VALUES (
          ${input.transactionId}::uuid,
          ${input.actorUserId}::uuid,
          'contract.stamped',
          jsonb_build_object('documentId', ${input.documentId}::text)
        )
      `.execute(trx);

      await sql`
        INSERT INTO domain_outbox_events (
          tenant_id, project_id, aggregate_type, aggregate_id,
          event_type, payload, published_at, attempts
        ) VALUES (
          ${input.tenantId}::uuid,
          ${input.projectId}::uuid,
          'TRANSACTION',
          ${input.transactionId}::uuid,
          'contract.stamped',
          jsonb_build_object('documentId', ${input.documentId}::text),
          NULL,
          0
        )
      `.execute(trx);
    });
  }
}
