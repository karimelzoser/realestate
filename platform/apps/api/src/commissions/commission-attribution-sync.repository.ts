import { Inject, Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import type { Database } from '@preneura/database';
import { DATABASE } from '../database/database.module.js';

@Injectable()
export class CommissionAttributionSyncRepository {
  constructor(@Inject(DATABASE) private readonly db: Kysely<Database>) {}

  async syncBrokerCases(input: {
    tenantId: string;
    projectId: string;
    brokerCompanyId: string;
  }): Promise<void> {
    await sql`
      SELECT ensure_broker_commission_case(t.id)
      FROM transactions t
      WHERE t.tenant_id = ${input.tenantId}::uuid
        AND t.project_id = ${input.projectId}::uuid
        AND t.buyer_source = 'BROKER'
        AND t.broker_company_id = ${input.brokerCompanyId}::uuid
      ORDER BY t.opened_at ASC, t.id ASC
    `.execute(this.db);
  }

  async refreshTransactionCase(input: {
    tenantId: string;
    projectId: string;
    transactionId: string;
  }): Promise<void> {
    const result = await sql<{ transaction_id: string }>`
      SELECT t.id AS transaction_id
      FROM transactions t
      WHERE t.id = ${input.transactionId}::uuid
        AND t.tenant_id = ${input.tenantId}::uuid
        AND t.project_id = ${input.projectId}::uuid
      LIMIT 1
    `.execute(this.db);
    if (!result.rows[0]) return;

    await sql`SELECT ensure_broker_commission_case(${input.transactionId}::uuid)`.execute(this.db);
    await sql`SELECT refresh_broker_commission_case(${input.transactionId}::uuid)`.execute(this.db);
  }
}
