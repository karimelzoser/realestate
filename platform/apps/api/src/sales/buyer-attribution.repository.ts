import { Inject, Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import type { Database } from '@preneura/database';
import type { CreateBuyerProfileInput } from '@preneura/contracts/sales';
import { DATABASE } from '../database/database.module.js';

export interface ProjectBuyerRecord {
  id: string;
  tenantId: string;
  projectId: string;
  userId: string;
  source: 'DIRECT' | 'BROKER' | 'INTERNAL';
  brokerCompanyId: string | null;
  brokerAgentUserId: string | null;
}

export interface TransactionBuyerRecord extends ProjectBuyerRecord {
  transactionId: string;
}

@Injectable()
export class BuyerAttributionRepository {
  constructor(@Inject(DATABASE) private readonly db: Kysely<Database>) {}

  async createOrAttribute(input: {
    actorUserId: string;
    data: CreateBuyerProfileInput;
  }): Promise<string> {
    return this.db.transaction().execute(async (trx) => {
      // buyer_profiles is tenant identity. Legacy attribution columns are populated on
      // first insert for backwards compatibility but are not updated on conflict.
      const profile = await trx
        .insertInto('buyer_profiles')
        .values({
          tenant_id: input.data.tenantId,
          user_id: input.data.userId,
          status: 'ACTIVE',
          source: input.data.source,
          broker_company_id: input.data.brokerCompanyId ?? null,
          broker_agent_user_id: input.data.brokerAgentUserId ?? null,
          created_by: input.actorUserId,
        })
        .onConflict((oc) =>
          oc.columns(['tenant_id', 'user_id']).doUpdateSet({
            status: 'ACTIVE',
            updated_at: new Date(),
          }),
        )
        .returning('id')
        .executeTakeFirstOrThrow();

      await sql`
        INSERT INTO buyer_project_attributions (
          tenant_id, project_id, buyer_profile_id, source,
          broker_company_id, broker_agent_user_id, attributed_by
        ) VALUES (
          ${input.data.tenantId}::uuid,
          ${input.data.projectId}::uuid,
          ${profile.id}::uuid,
          ${input.data.source},
          ${input.data.brokerCompanyId ?? null}::uuid,
          ${input.data.brokerAgentUserId ?? null}::uuid,
          ${input.actorUserId}::uuid
        )
        ON CONFLICT (buyer_profile_id, project_id)
        DO UPDATE SET
          source = EXCLUDED.source,
          broker_company_id = EXCLUDED.broker_company_id,
          broker_agent_user_id = EXCLUDED.broker_agent_user_id,
          attributed_by = EXCLUDED.attributed_by,
          updated_at = now()
      `.execute(trx);

      await trx
        .insertInto('domain_outbox_events')
        .values({
          tenant_id: input.data.tenantId,
          project_id: input.data.projectId,
          aggregate_type: 'BUYER_PROFILE',
          aggregate_id: profile.id,
          event_type: 'buyer.project_attribution.upserted',
          payload: {
            buyerUserId: input.data.userId,
            source: input.data.source,
            brokerCompanyId: input.data.brokerCompanyId ?? null,
            brokerAgentUserId: input.data.brokerAgentUserId ?? null,
            actorUserId: input.actorUserId,
          },
          published_at: null,
          attempts: 0,
        })
        .execute();

      return profile.id;
    });
  }

  async getProjectBuyer(input: {
    tenantId: string;
    projectId: string;
    buyerProfileId: string;
  }): Promise<ProjectBuyerRecord | null> {
    const result = await sql<{
      id: string;
      tenant_id: string;
      project_id: string;
      user_id: string;
      source: 'DIRECT' | 'BROKER' | 'INTERNAL';
      broker_company_id: string | null;
      broker_agent_user_id: string | null;
    }>`
      SELECT
        b.id,
        b.tenant_id,
        a.project_id,
        b.user_id,
        a.source,
        a.broker_company_id,
        a.broker_agent_user_id
      FROM buyer_profiles b
      JOIN buyer_project_attributions a
        ON a.buyer_profile_id = b.id
       AND a.tenant_id = b.tenant_id
      WHERE b.tenant_id = ${input.tenantId}::uuid
        AND b.id = ${input.buyerProfileId}::uuid
        AND b.status = 'ACTIVE'
        AND a.project_id = ${input.projectId}::uuid
      LIMIT 1
    `.execute(this.db);
    const row = result.rows[0];
    if (!row) return null;
    return {
      id: row.id,
      tenantId: row.tenant_id,
      projectId: row.project_id,
      userId: row.user_id,
      source: row.source,
      brokerCompanyId: row.broker_company_id,
      brokerAgentUserId: row.broker_agent_user_id,
    };
  }

  async getTransactionBuyer(input: {
    tenantId: string;
    projectId: string;
    transactionId: string;
  }): Promise<TransactionBuyerRecord | null> {
    const result = await sql<{
      transaction_id: string;
      buyer_profile_id: string;
      tenant_id: string;
      project_id: string;
      user_id: string;
      buyer_source: 'DIRECT' | 'BROKER' | 'INTERNAL';
      broker_company_id: string | null;
      broker_agent_user_id: string | null;
    }>`
      SELECT
        t.id AS transaction_id,
        t.buyer_profile_id,
        t.tenant_id,
        t.project_id,
        b.user_id,
        t.buyer_source,
        t.broker_company_id,
        t.broker_agent_user_id
      FROM transactions t
      JOIN buyer_profiles b
        ON b.id = t.buyer_profile_id
       AND b.tenant_id = t.tenant_id
      WHERE t.id = ${input.transactionId}::uuid
        AND t.tenant_id = ${input.tenantId}::uuid
        AND t.project_id = ${input.projectId}::uuid
      LIMIT 1
    `.execute(this.db);
    const row = result.rows[0];
    if (!row) return null;
    return {
      transactionId: row.transaction_id,
      id: row.buyer_profile_id,
      tenantId: row.tenant_id,
      projectId: row.project_id,
      userId: row.user_id,
      source: row.buyer_source,
      brokerCompanyId: row.broker_company_id,
      brokerAgentUserId: row.broker_agent_user_id,
    };
  }
}
