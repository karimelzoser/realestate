import { Inject, Injectable } from '@nestjs/common';
import type { Kysely } from 'kysely';
import { sql } from 'kysely';
import type { Database } from '@preneura/database';
import type { EoiListItemSnapshot } from '@preneura/contracts/sales';
import { DATABASE } from '../database/database.module.js';

@Injectable()
export class EoiListRepository {
  constructor(@Inject(DATABASE) private readonly db: Kysely<Database>) {}

  async list(input: {
    tenantId: string;
    projectId: string;
    brokerCompanyIds?: string[];
    brokerAgentUserId?: string | null;
    buyerUserId?: string | null;
  }): Promise<EoiListItemSnapshot[]> {
    let query = this.db
      .selectFrom('buyer_eois as e')
      .innerJoin('buyer_profiles as b', (join) =>
        join.onRef('b.id', '=', 'e.buyer_profile_id').onRef('b.tenant_id', '=', 'e.tenant_id'),
      )
      .innerJoin('users as u', 'u.id', 'b.user_id')
      .select([
        'e.id',
        'e.buyer_profile_id',
        'b.user_id as buyer_user_id',
        'u.display_name as buyer_display_name',
        'b.source as buyer_source',
        'b.broker_company_id',
        'b.broker_agent_user_id',
        'e.amount',
        'e.currency',
        'e.status',
        'e.payment_reference',
        'e.paid_at',
        'e.applied_at',
        'e.refund_requested_at',
        'e.refunded_at',
        'e.expires_at',
        'e.created_at',
      ])
      .where('e.tenant_id', '=', input.tenantId)
      .where('e.project_id', '=', input.projectId);

    if (input.brokerCompanyIds && input.brokerCompanyIds.length > 0) {
      query = query
        .where('b.source', '=', 'BROKER')
        .where('b.broker_company_id', 'in', input.brokerCompanyIds);
    }
    if (input.brokerAgentUserId) {
      query = query.where('b.broker_agent_user_id', '=', input.brokerAgentUserId);
    }
    if (input.buyerUserId) {
      query = query.where('b.user_id', '=', input.buyerUserId);
    }

    const rows = await query
      .orderBy('e.created_at', 'desc')
      .orderBy('e.id', 'desc')
      .execute();

    if (rows.length === 0) return [];

    const typeResult = await sql<{
      eoi_id: string;
      unit_type_id: string | null;
      unit_type_code: string | null;
      unit_type_name: string | null;
    }>`
      SELECT
        e.id AS eoi_id,
        e.unit_type_id,
        ut.code AS unit_type_code,
        ut.name AS unit_type_name
      FROM buyer_eois e
      LEFT JOIN catalog_unit_types ut
        ON ut.id = e.unit_type_id
       AND ut.tenant_id = e.tenant_id
       AND ut.project_id = e.project_id
      WHERE e.id IN (${sql.join(rows.map((row) => sql`${row.id}::uuid`))})
    `.execute(this.db);
    const typeByEoi = new Map(typeResult.rows.map((row) => [row.eoi_id, row]));

    return rows.map((row) => {
      const type = typeByEoi.get(row.id);
      return {
        eoiId: row.id,
        buyerProfileId: row.buyer_profile_id,
        buyerUserId: row.buyer_user_id,
        buyerDisplayName: row.buyer_display_name,
        buyerSource: row.buyer_source,
        brokerCompanyId: row.broker_company_id,
        brokerAgentUserId: row.broker_agent_user_id,
        unitTypeId: type?.unit_type_id ?? null,
        unitTypeCode: type?.unit_type_code ?? null,
        unitTypeName: type?.unit_type_name ?? null,
        amount: String(row.amount),
        currency: row.currency,
        status: row.status,
        paymentReference: row.payment_reference,
        paidAt: row.paid_at ? (row.paid_at as Date).toISOString() : null,
        appliedAt: row.applied_at ? (row.applied_at as Date).toISOString() : null,
        refundRequestedAt: row.refund_requested_at ? (row.refund_requested_at as Date).toISOString() : null,
        refundedAt: row.refunded_at ? (row.refunded_at as Date).toISOString() : null,
        expiresAt: row.expires_at ? (row.expires_at as Date).toISOString() : null,
        createdAt: (row.created_at as Date).toISOString(),
      };
    });
  }
}
