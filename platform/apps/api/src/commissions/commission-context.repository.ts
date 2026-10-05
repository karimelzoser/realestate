import { Inject, Injectable } from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { Database } from '@preneura/database';
import type { BrokerCommissionContextSnapshot } from '@preneura/contracts/commissions';
import { DATABASE } from '../database/database.module.js';

@Injectable()
export class CommissionContextRepository {
  constructor(@Inject(DATABASE) private readonly db: Kysely<Database>) {}

  async listProjectBrokers(input: {
    tenantId: string;
    projectId: string;
    brokerCompanyIds?: string[] | null;
    now: Date;
  }): Promise<BrokerCommissionContextSnapshot[]> {
    if (input.brokerCompanyIds && input.brokerCompanyIds.length === 0) return [];

    let query = this.db
      .selectFrom('broker_project_access as access')
      .innerJoin('broker_companies as broker', (join) =>
        join
          .onRef('broker.id', '=', 'access.broker_company_id')
          .onRef('broker.tenant_id', '=', 'access.tenant_id'),
      )
      .select([
        'broker.id as broker_company_id',
        'broker.code',
        'broker.name',
      ])
      .where('access.tenant_id', '=', input.tenantId)
      .where('access.project_id', '=', input.projectId)
      .where('access.status', '=', 'ACTIVE')
      .where('broker.status', '=', 'ACTIVE')
      .where('access.effective_from', '<=', input.now)
      .where((eb) => eb.or([
        eb('access.effective_to', 'is', null),
        eb('access.effective_to', '>', input.now),
      ]));

    if (input.brokerCompanyIds) {
      query = query.where('broker.id', 'in', input.brokerCompanyIds);
    }

    const rows = await query.orderBy('broker.name', 'asc').execute();
    return rows.map((row) => ({
      brokerCompanyId: row.broker_company_id,
      code: row.code,
      name: row.name,
    }));
  }
}
