import { Inject, Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import type { Database, RealtimeTopic } from '@preneura/database';
import type { RealtimeSignal } from '@preneura/contracts/realtime';
import { DATABASE } from '../database/database.module.js';

@Injectable()
export class RealtimeRepository {
  constructor(@Inject(DATABASE) private readonly db: Kysely<Database>) {}

  async latestProjectSequence(input: {
    tenantId: string;
    projectId: string;
    topics: readonly RealtimeTopic[];
  }): Promise<string | null> {
    if (input.topics.length === 0) return null;
    const row = await this.db
      .selectFrom('realtime_events')
      .select(sql<string | null>`max(sequence)::text`.as('latest'))
      .where('tenant_id', '=', input.tenantId)
      .where('project_id', '=', input.projectId)
      .where('topic', 'in', [...input.topics])
      .executeTakeFirst();
    return row?.latest ?? null;
  }

  async listProjectEvents(input: {
    tenantId: string;
    projectId: string;
    topics: readonly RealtimeTopic[];
    afterSequence: string;
    throughSequence?: string | null;
    limit?: number;
  }): Promise<RealtimeSignal[]> {
    if (input.topics.length === 0) return [];
    let query = this.db
      .selectFrom('realtime_events')
      .select([
        sql<string>`sequence::text`.as('sequence_text'),
        'topic',
        'source_event_type',
        'occurred_at',
      ])
      .where('tenant_id', '=', input.tenantId)
      .where('project_id', '=', input.projectId)
      .where('topic', 'in', [...input.topics])
      .where(sql<boolean>`sequence > ${input.afterSequence}::bigint`);
    if (input.throughSequence) {
      query = query.where(sql<boolean>`sequence <= ${input.throughSequence}::bigint`);
    }
    const rows = await query
      .orderBy('sequence', 'asc')
      .limit(input.limit ?? 500)
      .execute();
    return rows.map((row) => this.signal(row));
  }

  async getProjectEvent(input: {
    tenantId: string;
    projectId: string;
    sequence: string;
    topics: readonly RealtimeTopic[];
  }): Promise<RealtimeSignal | null> {
    if (input.topics.length === 0) return null;
    const row = await this.db
      .selectFrom('realtime_events')
      .select([
        sql<string>`sequence::text`.as('sequence_text'),
        'topic',
        'source_event_type',
        'occurred_at',
      ])
      .where('tenant_id', '=', input.tenantId)
      .where('project_id', '=', input.projectId)
      .where('topic', 'in', [...input.topics])
      .where(sql<boolean>`sequence = ${input.sequence}::bigint`)
      .executeTakeFirst();
    return row ? this.signal(row) : null;
  }

  async latestBrokerCommissionSequence(input: {
    tenantId: string;
    projectId: string;
    brokerCompanyId: string;
  }): Promise<string | null> {
    const row = await this.brokerCommissionBase(input)
      .select(sql<string | null>`max(e.sequence)::text`.as('latest'))
      .executeTakeFirst();
    return row?.latest ?? null;
  }

  async listBrokerCommissionEvents(input: {
    tenantId: string;
    projectId: string;
    brokerCompanyId: string;
    afterSequence: string;
    throughSequence?: string | null;
    limit?: number;
  }): Promise<RealtimeSignal[]> {
    let query = this.brokerCommissionBase(input)
      .select([
        sql<string>`e.sequence::text`.as('sequence_text'),
        'e.topic',
        'e.source_event_type',
        'e.occurred_at',
      ])
      .where(sql<boolean>`e.sequence > ${input.afterSequence}::bigint`);
    if (input.throughSequence) {
      query = query.where(sql<boolean>`e.sequence <= ${input.throughSequence}::bigint`);
    }
    const rows = await query
      .orderBy('e.sequence', 'asc')
      .limit(input.limit ?? 500)
      .execute();
    return rows.map((row) => this.signal(row));
  }

  async getBrokerCommissionEvent(input: {
    tenantId: string;
    projectId: string;
    brokerCompanyId: string;
    sequence: string;
  }): Promise<RealtimeSignal | null> {
    const row = await this.brokerCommissionBase(input)
      .select([
        sql<string>`e.sequence::text`.as('sequence_text'),
        'e.topic',
        'e.source_event_type',
        'e.occurred_at',
      ])
      .where(sql<boolean>`e.sequence = ${input.sequence}::bigint`)
      .executeTakeFirst();
    return row ? this.signal(row) : null;
  }

  private brokerCommissionBase(input: {
    tenantId: string;
    projectId: string;
    brokerCompanyId: string;
  }) {
    return this.db
      .selectFrom('realtime_events as e')
      .where('e.tenant_id', '=', input.tenantId)
      .where('e.project_id', '=', input.projectId)
      .where('e.topic', '=', 'COMMISSION')
      .where((eb) => eb.or([
        eb.and([
          eb('e.source_aggregate_type', '=', 'BROKER_COMMISSION_CASE'),
          eb('e.source_aggregate_id', 'in',
            eb.selectFrom('broker_commission_cases')
              .select('id')
              .where('tenant_id', '=', input.tenantId)
              .where('project_id', '=', input.projectId)
              .where('broker_company_id', '=', input.brokerCompanyId),
          ),
        ]),
        eb.and([
          eb('e.source_aggregate_type', '=', 'BROKER_COMMISSION_PLAN'),
          eb('e.source_aggregate_id', 'in',
            eb.selectFrom('broker_commission_plans')
              .select('id')
              .where('tenant_id', '=', input.tenantId)
              .where('project_id', '=', input.projectId)
              .where('broker_company_id', '=', input.brokerCompanyId),
          ),
        ]),
      ]));
  }

  private signal(row: {
    sequence_text: string;
    topic: RealtimeTopic;
    source_event_type: string;
    occurred_at: Date;
  }): RealtimeSignal {
    return {
      sequence: row.sequence_text,
      topic: row.topic,
      eventType: row.source_event_type,
      occurredAt: (row.occurred_at as Date).toISOString(),
    };
  }
}
