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
      .innerJoin('users as buyer_user', 'buyer_user.id', 'b.user_id')
      .leftJoin('broker_companies as broker_company', (join) =>
        join
          .onRef('broker_company.id', '=', 'b.broker_company_id')
          .onRef('broker_company.tenant_id', '=', 't.tenant_id'),
      )
      .leftJoin('users as broker_agent', 'broker_agent.id', 'b.broker_agent_user_id')
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
        'buyer_user.display_name as buyer_display_name',
        'b.source as buyer_source',
        'b.broker_company_id',
        'broker_company.name as broker_company_name',
        'b.broker_agent_user_id',
        'broker_agent.display_name as broker_agent_display_name',
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

    if (rows.length === 0) return [];

    const exactResult = await sql<{
      reservation_id: string;
      physical_unit_id: string | null;
      physical_unit_reference: string | null;
      building_code: string | null;
      floor_code: string | null;
    }>`
      SELECT
        r.id AS reservation_id,
        r.physical_unit_id,
        COALESCE(u.display_reference, u.internal_reference) AS physical_unit_reference,
        bld.code AS building_code,
        fl.code AS floor_code
      FROM reservations r
      LEFT JOIN physical_units u
        ON u.id = r.physical_unit_id
       AND u.tenant_id = r.tenant_id
       AND u.project_id = r.project_id
       AND u.unit_type_id = r.unit_type_id
      LEFT JOIN project_buildings bld ON bld.id = u.building_id
      LEFT JOIN project_floors fl ON fl.id = u.floor_id
      WHERE r.id IN (${sql.join(rows.map((row) => sql`${row.reservation_id}::uuid`))})
    `.execute(this.db);
    const exactByReservation = new Map(exactResult.rows.map((row) => [row.reservation_id, row]));

    return rows.map((row) => {
      const exact = exactByReservation.get(row.reservation_id);
      return {
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
        physicalUnitId: exact?.physical_unit_id ?? null,
        physicalUnitReference: exact?.physical_unit_reference ?? null,
        buildingCode: exact?.building_code ?? null,
        floorCode: exact?.floor_code ?? null,
        status: row.status,
        quotedTotal: row.quoted_total === null ? null : String(row.quoted_total),
        currency: row.currency,
        openedAt: (row.opened_at as Date).toISOString(),
        completionPercent: Number(row.completion_percent).toFixed(2),
      };
    });
  }
}
