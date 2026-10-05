import { ConflictException, Inject, Injectable } from '@nestjs/common';
import type { ContractExecutionSnapshot } from '@preneura/contracts/contract-execution';
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

  async getSnapshot(input: {
    tenantId: string;
    projectId: string;
    transactionId: string;
  }): Promise<ContractExecutionSnapshot | null> {
    const result = await sql<{
      id: string;
      transaction_id: string;
      reservation_id: string;
      document_id: string;
      document_sha256_hex: string;
      object_trust_status: 'CLEAN' | 'LEGACY_UNSCANNED';
      template_id: string;
      template_version_number: number;
      template_sha256_hex: string;
      pricing_version_id: string;
      quoted_total: string | number;
      currency: string;
      price_components: unknown;
      signatures: unknown;
      manifest: unknown;
      manifest_sha256_hex: string;
      executed_at: Date;
      executed_by: string | null;
    }>`
      SELECT id, transaction_id, reservation_id, document_id, document_sha256_hex,
             object_trust_status, template_id, template_version_number,
             template_sha256_hex, pricing_version_id, quoted_total, currency,
             price_components, signatures, manifest, manifest_sha256_hex,
             executed_at, executed_by
      FROM contract_execution_snapshots
      WHERE tenant_id = ${input.tenantId}::uuid
        AND project_id = ${input.projectId}::uuid
        AND transaction_id = ${input.transactionId}::uuid
      LIMIT 1
    `.execute(this.db);

    const row = result.rows[0];
    if (!row) return null;
    return {
      snapshotId: row.id,
      transactionId: row.transaction_id,
      reservationId: row.reservation_id,
      documentId: row.document_id,
      documentSha256Hex: row.document_sha256_hex,
      objectTrustStatus: row.object_trust_status,
      templateId: row.template_id,
      templateVersionNumber: Number(row.template_version_number),
      templateSha256Hex: row.template_sha256_hex,
      pricingVersionId: row.pricing_version_id,
      quotedTotal: String(row.quoted_total),
      currency: row.currency,
      priceComponents: row.price_components as ContractExecutionSnapshot['priceComponents'],
      signatures: row.signatures as ContractExecutionSnapshot['signatures'],
      manifest: row.manifest as Record<string, unknown>,
      manifestSha256Hex: row.manifest_sha256_hex,
      executedAt: row.executed_at.toISOString(),
      executedBy: row.executed_by,
    };
  }
}
