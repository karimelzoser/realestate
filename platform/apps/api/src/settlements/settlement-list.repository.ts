import { Inject, Injectable } from '@nestjs/common';
import type { SettlementSummarySnapshot } from '@preneura/contracts/settlements';
import type { Database } from '@preneura/database';
import { sql, type Kysely } from 'kysely';
import { DATABASE } from '../database/database.module.js';

interface SettlementSummaryRow {
  settlement_id: string;
  settlement_type: 'EOI_REFUND' | 'BROKER_COMMISSION';
  status: SettlementSummarySnapshot['status'];
  eoi_refund_request_id: string | null;
  commission_case_id: string | null;
  buyer_profile_id: string | null;
  broker_company_id: string | null;
  amount: string;
  currency: string;
  provider: string | null;
  provider_reference: string | null;
  initiated_at: Date;
  submitted_at: Date | null;
  settled_at: Date | null;
  failed_at: Date | null;
  reversed_at: Date | null;
}

@Injectable()
export class SettlementListRepository {
  constructor(@Inject(DATABASE) private readonly db: Kysely<Database>) {}

  async commissions(input: {
    tenantId: string;
    projectId: string;
    brokerCompanyId: string;
    brokerAgentUserId?: string | null;
  }): Promise<SettlementSummarySnapshot[]> {
    const result = await sql<SettlementSummaryRow>`
      SELECT
        s.id AS settlement_id, s.settlement_type, s.status,
        s.eoi_refund_request_id, s.commission_case_id, s.buyer_profile_id, s.broker_company_id,
        s.amount::text, s.currency, s.provider, s.provider_reference,
        s.initiated_at, s.submitted_at, s.settled_at, s.failed_at, s.reversed_at
      FROM settlement_disbursements s
      JOIN broker_commission_cases c ON c.id = s.commission_case_id
      WHERE s.tenant_id = ${input.tenantId}::uuid
        AND s.project_id = ${input.projectId}::uuid
        AND s.settlement_type = 'BROKER_COMMISSION'
        AND s.broker_company_id = ${input.brokerCompanyId}::uuid
        AND (${input.brokerAgentUserId ?? null}::uuid IS NULL OR c.broker_agent_user_id = ${input.brokerAgentUserId ?? null}::uuid)
      ORDER BY s.initiated_at DESC, s.id DESC
    `.execute(this.db);
    return result.rows.map((row) => this.map(row));
  }

  async refunds(input: {
    tenantId: string;
    projectId: string;
    buyerUserId?: string | null;
  }): Promise<SettlementSummarySnapshot[]> {
    const result = await sql<SettlementSummaryRow>`
      SELECT
        s.id AS settlement_id, s.settlement_type, s.status,
        s.eoi_refund_request_id, s.commission_case_id, s.buyer_profile_id, s.broker_company_id,
        s.amount::text, s.currency, s.provider, s.provider_reference,
        s.initiated_at, s.submitted_at, s.settled_at, s.failed_at, s.reversed_at
      FROM settlement_disbursements s
      JOIN buyer_profiles b ON b.id = s.buyer_profile_id
      WHERE s.tenant_id = ${input.tenantId}::uuid
        AND s.project_id = ${input.projectId}::uuid
        AND s.settlement_type = 'EOI_REFUND'
        AND (${input.buyerUserId ?? null}::uuid IS NULL OR b.user_id = ${input.buyerUserId ?? null}::uuid)
      ORDER BY s.initiated_at DESC, s.id DESC
    `.execute(this.db);
    return result.rows.map((row) => this.map(row));
  }

  private map(row: SettlementSummaryRow): SettlementSummarySnapshot {
    return {
      settlementId: row.settlement_id,
      settlementType: row.settlement_type,
      status: row.status,
      eoiRefundRequestId: row.eoi_refund_request_id,
      commissionCaseId: row.commission_case_id,
      buyerProfileId: row.buyer_profile_id,
      brokerCompanyId: row.broker_company_id,
      amount: row.amount,
      currency: row.currency,
      provider: row.provider,
      providerReference: row.provider_reference,
      initiatedAt: row.initiated_at.toISOString(),
      submittedAt: row.submitted_at?.toISOString() ?? null,
      settledAt: row.settled_at?.toISOString() ?? null,
      failedAt: row.failed_at?.toISOString() ?? null,
      reversedAt: row.reversed_at?.toISOString() ?? null,
    };
  }
}
