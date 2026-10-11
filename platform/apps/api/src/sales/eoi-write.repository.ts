import { ConflictException, Inject, Injectable } from '@nestjs/common';
import type { CreateBuyerEoiInput } from '@preneura/contracts/sales';
import type { Database } from '@preneura/database';
import { sql, type Kysely } from 'kysely';
import { DATABASE } from '../database/database.module.js';

@Injectable()
export class EoiWriteRepository {
  constructor(@Inject(DATABASE) private readonly db: Kysely<Database>) {}

  async create(input: {
    actorUserId: string;
    data: CreateBuyerEoiInput;
    now: Date;
  }): Promise<{ eoiId: string; amount: string; currency: string }> {
    return this.db.transaction().execute(async (trx) => {
      const unitType = await sql<{ id: string }>`
        SELECT id
        FROM catalog_unit_types
        WHERE id = ${input.data.unitTypeId}::uuid
          AND tenant_id = ${input.data.tenantId}::uuid
          AND project_id = ${input.data.projectId}::uuid
          AND status = 'ACTIVE'
        FOR SHARE
      `.execute(trx);
      if (!unitType.rows[0]) {
        throw new ConflictException('Selected unit type is not active in this project.');
      }

      const policy = await sql<{ id: string; eoi_amount: string; currency: string }>`
        SELECT id, eoi_amount::text, currency
        FROM eoi_refund_policies
        WHERE tenant_id = ${input.data.tenantId}::uuid
          AND project_id = ${input.data.projectId}::uuid
          AND status = 'ACTIVE'
          AND effective_at <= ${input.now}
        ORDER BY effective_at DESC, version_number DESC
        LIMIT 1
      `.execute(trx);
      const activePolicy = policy.rows[0];
      if (!activePolicy) {
        throw new ConflictException('No active EOI refund policy is effective for this project.');
      }

      const result = await sql<{ id: string; amount: string; currency: string }>`
        INSERT INTO buyer_eois (
          tenant_id,
          project_id,
          buyer_profile_id,
          refund_policy_id,
          unit_type_id,
          amount,
          currency,
          status,
          payment_reference,
          paid_at,
          applied_at,
          refund_requested_at,
          refunded_at,
          expires_at,
          created_by,
          created_at,
          updated_at
        ) VALUES (
          ${input.data.tenantId}::uuid,
          ${input.data.projectId}::uuid,
          ${input.data.buyerProfileId}::uuid,
          ${activePolicy.id}::uuid,
          ${input.data.unitTypeId}::uuid,
          ${activePolicy.eoi_amount}::numeric,
          ${activePolicy.currency},
          'PAYMENT_PENDING',
          NULL,
          NULL,
          NULL,
          NULL,
          NULL,
          NULL,
          ${input.actorUserId}::uuid,
          ${input.now},
          ${input.now}
        )
        RETURNING id, amount::text, currency
      `.execute(trx);
      const row = result.rows[0]!;

      await sql`
        INSERT INTO domain_outbox_events (
          tenant_id, project_id, aggregate_type, aggregate_id, event_type, payload
        ) VALUES (
          ${input.data.tenantId}::uuid,
          ${input.data.projectId}::uuid,
          'EOI',
          ${row.id}::uuid,
          'eoi.created',
          jsonb_build_object(
            'buyerProfileId', ${input.data.buyerProfileId}::text,
            'unitTypeId', ${input.data.unitTypeId}::text,
            'actorUserId', ${input.actorUserId}::text
          )
        )
      `.execute(trx);

      return { eoiId: row.id, amount: row.amount, currency: row.currency };
    });
  }
}
