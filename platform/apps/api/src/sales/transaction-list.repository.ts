import { Inject, Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import type { Database } from '@preneura/database';
import type { TransactionListItemSnapshot } from '@preneura/contracts/sales';
import { DATABASE } from '../database/database.module.js';

@Injectable()
export class TransactionListRepository {
  constructor(@Inject(DATABASE) private readonly db: Kysely<Database>) {}

  async projectExists(tenantId: string, projectId: string): Promise<boolean> {
    const row = await this.db
      .selectFrom('projects')
      .select('id')
      .where('tenant_id', '=', tenantId)
      .where('id', '=', projectId)
      .where('status', 'in', ['DRAFT', 'ACTIVE', 'PAUSED', 'CLOSED'])
      .executeTakeFirst();
    return Boolean(row);
  }

  async list(input: {
    tenantId: string;
    projectId: string;
    buyerUserId?: string | null;
    brokerCompanyIds?: string[];
    brokerAgentUserId?: string | null;
    limit?: number;
  }): Promise<TransactionListItemSnapshot[]> {
    let query = this.db
      .selectFrom('transactions as t')
      .innerJoin('reservations as r', (join) =>
        join
          .onRef('r.id', '=', 't.reservation_id')
          .onRef('r.tenant_id', '=', 't.tenant_id')
          .onRef('r.project_id', '=', 't.project_id'),
      )
      .innerJoin('buyer_profiles as b', (join) =>
        join
          .onRef('b.id', '=', 't.buyer_profile_id')
          .onRef('b.tenant_id', '=', 't.tenant_id'),
      )
      .innerJoin('catalog_unit_types as u', (join) =>
        join
          .onRef('u.id', '=', 'r.unit_type_id')
          .onRef('u.tenant_id', '=', 't.tenant_id')
          .onRef('u.project_id', '=', 't.project_id'),
      )
      .select([
        't.id as transaction_id',
        't.reservation_id',
        't.buyer_profile_id',
        't.status',
        't.opened_at',
        'b.user_id as buyer_user_id',
        'b.source as buyer_source',
        'r.unit_type_id',
        'r.quoted_total',
        'r.currency',
        'u.code as unit_type_code',
        'u.name as unit_type_name',
        sql<string>`COALESCE((
          SELECT SUM(CASE WHEN m.status IN ('COMPLETED','WAIVED') THEN m.weight_percent ELSE 0 END)
          FROM transaction_milestones m
          WHERE m.transaction_id = t.id
        ), 0)::text`.as('completion_percent'),
      ])
      .where('t.tenant_id', '=', input.tenantId)
      .where('t.project_id', '=', input.projectId);

    if (input.buyerUserId) {
      query = query.where('b.user_id', '=', input.buyerUserId);
    }
    if (input.brokerCompanyIds) {
      if (input.brokerCompanyIds.length === 0) return [];
      query = query.where('b.source', '=', 'BROKER').where('b.broker_company_id', 'in', input.brokerCompanyIds);
    }
    if (input.brokerAgentUserId) {
      query = query.where('b.broker_agent_user_id', '=', input.brokerAgentUserId);
    }

    const rows = await query
      .orderBy('t.opened_at', 'desc')
      .orderBy('t.id', 'desc')
      .limit(Math.min(Math.max(input.limit ?? 200, 1), 500))
      .execute();

    return rows.map((row) => ({
      transactionId: row.transaction_id,
      reservationId: row.reservation_id,
      buyerProfileId: row.buyer_profile_id,
      buyerUserId: row.buyer_user_id,
      buyerSource: row.buyer_source,
      unitTypeId: row.unit_type_id,
      unitTypeCode: row.unit_type_code,
      unitTypeName: row.unit_type_name,
      status: row.status,
      quotedTotal: row.quoted_total === null ? null : String(row.quoted_total),
      currency: row.currency,
      openedAt: (row.opened_at as Date).toISOString(),
      completionPercent: Number(row.completion_percent).toFixed(2),
    }));
  }
}
