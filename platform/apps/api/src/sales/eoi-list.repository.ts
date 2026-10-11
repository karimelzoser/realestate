import { Inject, Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import type { Database } from '@preneura/database';
import type { EoiListItemSnapshot } from '@preneura/contracts/sales';
import { DATABASE } from '../database/database.module.js';

type EoiStatus = EoiListItemSnapshot['status'];
type BuyerSource = EoiListItemSnapshot['buyerSource'];

interface EoiListRow {
  id: string;
  buyer_profile_id: string;
  buyer_user_id: string;
  buyer_display_name: string;
  buyer_source: BuyerSource;
  broker_company_id: string | null;
  broker_agent_user_id: string | null;
  amount: string;
  currency: string;
  status: EoiStatus;
  payment_reference: string | null;
  paid_at: Date | null;
  applied_at: Date | null;
  refund_requested_at: Date | null;
  refunded_at: Date | null;
  expires_at: Date | null;
  created_at: Date;
}

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
    const brokerFilter = input.brokerCompanyIds && input.brokerCompanyIds.length > 0
      ? sql`AND a.source = 'BROKER' AND a.broker_company_id IN (${sql.join(
          input.brokerCompanyIds.map((id) => sql`${id}::uuid`),
        )})`
      : sql``;
    const agentFilter = input.brokerAgentUserId
      ? sql`AND a.broker_agent_user_id = ${input.brokerAgentUserId}::uuid`
      : sql``;
    const buyerFilter = input.buyerUserId
      ? sql`AND b.user_id = ${input.buyerUserId}::uuid`
      : sql``;

    const result = await sql<EoiListRow>`
      SELECT
        e.id,
        e.buyer_profile_id,
        b.user_id AS buyer_user_id,
        u.display_name AS buyer_display_name,
        a.source AS buyer_source,
        a.broker_company_id,
        a.broker_agent_user_id,
        e.amount::text,
        e.currency,
        e.status,
        e.payment_reference,
        e.paid_at,
        e.applied_at,
        e.refund_requested_at,
        e.refunded_at,
        e.expires_at,
        e.created_at
      FROM buyer_eois e
      JOIN buyer_profiles b
        ON b.id = e.buyer_profile_id
       AND b.tenant_id = e.tenant_id
      JOIN buyer_project_attributions a
        ON a.buyer_profile_id = e.buyer_profile_id
       AND a.tenant_id = e.tenant_id
       AND a.project_id = e.project_id
      JOIN users u ON u.id = b.user_id
      WHERE e.tenant_id = ${input.tenantId}::uuid
        AND e.project_id = ${input.projectId}::uuid
        ${brokerFilter}
        ${agentFilter}
        ${buyerFilter}
      ORDER BY e.created_at DESC, e.id DESC
    `.execute(this.db);

    return result.rows.map((row) => ({
      eoiId: row.id,
      buyerProfileId: row.buyer_profile_id,
      buyerUserId: row.buyer_user_id,
      buyerDisplayName: row.buyer_display_name,
      buyerSource: row.buyer_source,
      brokerCompanyId: row.broker_company_id,
      brokerAgentUserId: row.broker_agent_user_id,
      amount: row.amount,
      currency: row.currency,
      status: row.status,
      paymentReference: row.payment_reference,
      paidAt: row.paid_at?.toISOString() ?? null,
      appliedAt: row.applied_at?.toISOString() ?? null,
      refundRequestedAt: row.refund_requested_at?.toISOString() ?? null,
      refundedAt: row.refunded_at?.toISOString() ?? null,
      expiresAt: row.expires_at?.toISOString() ?? null,
      createdAt: row.created_at.toISOString(),
    }));
  }
}
