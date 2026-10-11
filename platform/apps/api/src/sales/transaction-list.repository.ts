import { Inject, Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import type { Database } from '@preneura/database';
import type { TransactionListItemSnapshot } from '@preneura/contracts/sales';
import { DATABASE } from '../database/database.module.js';

type TransactionStatus = TransactionListItemSnapshot['status'];
type BuyerSource = TransactionListItemSnapshot['buyerSource'];

interface TransactionListRow {
  transaction_id: string;
  reservation_id: string;
  buyer_profile_id: string;
  status: TransactionStatus;
  opened_at: Date;
  buyer_user_id: string;
  buyer_display_name: string;
  buyer_source: BuyerSource;
  broker_company_id: string | null;
  broker_company_name: string | null;
  broker_agent_user_id: string | null;
  broker_agent_display_name: string | null;
  unit_type_id: string;
  quoted_total: string | null;
  currency: string;
  unit_type_code: string;
  unit_type_name: string;
  completion_percent: string;
}

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
    if (input.brokerCompanyIds && input.brokerCompanyIds.length === 0) return [];

    const buyerFilter = input.buyerUserId
      ? sql`AND b.user_id = ${input.buyerUserId}::uuid`
      : sql``;
    const brokerFilter = input.brokerCompanyIds
      ? sql`AND t.buyer_source = 'BROKER' AND t.broker_company_id IN (${sql.join(
          input.brokerCompanyIds.map((id) => sql`${id}::uuid`),
        )})`
      : sql``;
    const agentFilter = input.brokerAgentUserId
      ? sql`AND t.broker_agent_user_id = ${input.brokerAgentUserId}::uuid`
      : sql``;
    const limit = Math.min(Math.max(input.limit ?? 200, 1), 500);

    const result = await sql<TransactionListRow>`
      SELECT
        t.id AS transaction_id,
        t.reservation_id,
        t.buyer_profile_id,
        t.status,
        t.opened_at,
        b.user_id AS buyer_user_id,
        buyer_user.display_name AS buyer_display_name,
        t.buyer_source,
        t.broker_company_id,
        broker_company.name AS broker_company_name,
        t.broker_agent_user_id,
        broker_agent.display_name AS broker_agent_display_name,
        r.unit_type_id,
        r.quoted_total::text,
        r.currency,
        u.code AS unit_type_code,
        u.name AS unit_type_name,
        COALESCE((
          SELECT SUM(CASE WHEN m.status IN ('COMPLETED','WAIVED') THEN m.weight_percent ELSE 0 END)
          FROM transaction_milestones m
          WHERE m.transaction_id = t.id
        ), 0)::text AS completion_percent
      FROM transactions t
      JOIN reservations r
        ON r.id = t.reservation_id
       AND r.tenant_id = t.tenant_id
       AND r.project_id = t.project_id
      JOIN buyer_profiles b
        ON b.id = t.buyer_profile_id
       AND b.tenant_id = t.tenant_id
      JOIN users buyer_user ON buyer_user.id = b.user_id
      LEFT JOIN broker_companies broker_company
        ON broker_company.id = t.broker_company_id
       AND broker_company.tenant_id = t.tenant_id
      LEFT JOIN users broker_agent ON broker_agent.id = t.broker_agent_user_id
      JOIN catalog_unit_types u
        ON u.id = r.unit_type_id
       AND u.tenant_id = t.tenant_id
       AND u.project_id = t.project_id
      WHERE t.tenant_id = ${input.tenantId}::uuid
        AND t.project_id = ${input.projectId}::uuid
        ${buyerFilter}
        ${brokerFilter}
        ${agentFilter}
      ORDER BY t.opened_at DESC, t.id DESC
      LIMIT ${limit}
    `.execute(this.db);

    return result.rows.map((row) => ({
      transactionId: row.transaction_id,
      reservationId: row.reservation_id,
      buyerProfileId: row.buyer_profile_id,
      buyerUserId: row.buyer_user_id,
      buyerDisplayName: row.buyer_display_name,
      buyerSource: row.buyer_source,
      brokerCompanyId: row.broker_company_id,
      brokerCompanyName: row.broker_company_name,
      brokerAgentUserId: row.broker_agent_user_id,
      brokerAgentDisplayName: row.broker_agent_display_name,
      unitTypeId: row.unit_type_id,
      unitTypeCode: row.unit_type_code,
      unitTypeName: row.unit_type_name,
      status: row.status,
      quotedTotal: row.quoted_total,
      currency: row.currency,
      openedAt: row.opened_at.toISOString(),
      completionPercent: Number(row.completion_percent).toFixed(2),
    }));
  }
}
