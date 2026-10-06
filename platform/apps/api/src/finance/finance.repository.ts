import { ConflictException, Inject, Injectable } from '@nestjs/common';
import type { CreateChequeScheduleInput, CreatePaymentScheduleInput } from '@preneura/contracts/finance';
import type { Database, JsonValue } from '@preneura/database';
import { sql, type Kysely, type Transaction } from 'kysely';
import { DATABASE } from '../database/database.module.js';

export interface FinanceTransactionContext {
  transactionId: string;
  tenantId: string;
  projectId: string;
  buyerUserId: string;
  brokerCompanyId: string | null;
  brokerAgentUserId: string | null;
  status: 'IN_PROGRESS' | 'READY_FOR_COMPLETION' | 'COMPLETED' | 'CANCELLED';
  quotedTotal: string | null;
  currency: string;
}

@Injectable()
export class FinanceRepository {
  constructor(@Inject(DATABASE) private readonly db: Kysely<Database>) {}

  async getTransactionContext(input: {
    tenantId: string;
    projectId: string;
    transactionId: string;
  }): Promise<FinanceTransactionContext | null> {
    const row = await this.db
      .selectFrom('transactions as t')
      .innerJoin('buyer_profiles as b', (join) =>
        join.onRef('b.id', '=', 't.buyer_profile_id').onRef('b.tenant_id', '=', 't.tenant_id'),
      )
      .innerJoin('reservations as r', (join) =>
        join
          .onRef('r.id', '=', 't.reservation_id')
          .onRef('r.tenant_id', '=', 't.tenant_id')
          .onRef('r.project_id', '=', 't.project_id'),
      )
      .select([
        't.id',
        't.tenant_id',
        't.project_id',
        't.status',
        'b.user_id as buyer_user_id',
        'b.broker_company_id',
        'b.broker_agent_user_id',
        'r.quoted_total',
        'r.currency',
      ])
      .where('t.id', '=', input.transactionId)
      .where('t.tenant_id', '=', input.tenantId)
      .where('t.project_id', '=', input.projectId)
      .executeTakeFirst();
    if (!row) return null;
    return {
      transactionId: row.id,
      tenantId: row.tenant_id,
      projectId: row.project_id,
      buyerUserId: row.buyer_user_id,
      brokerCompanyId: row.broker_company_id,
      brokerAgentUserId: row.broker_agent_user_id,
      status: row.status,
      quotedTotal: row.quoted_total === null ? null : String(row.quoted_total),
      currency: row.currency,
    };
  }

  async createPaymentSchedule(input: {
    actorUserId: string;
    data: CreatePaymentScheduleInput;
    now: Date;
  }): Promise<{ scheduleId: string }> {
    return this.db.transaction().execute(async (trx) => {
      await this.assertOpenTransaction(trx, input.data.tenantId, input.data.projectId, input.data.transactionId);

      const existing = await trx
        .selectFrom('payment_schedules')
        .select('id')
        .where('transaction_id', '=', input.data.transactionId)
        .executeTakeFirst();
      if (existing) throw new ConflictException('This transaction already has a payment schedule.');

      const schedule = await trx
        .insertInto('payment_schedules')
        .values({
          tenant_id: input.data.tenantId,
          project_id: input.data.projectId,
          transaction_id: input.data.transactionId,
          currency: input.data.currency,
          total_contract_amount: input.data.totalContractAmount,
          status: 'ACTIVE',
          created_by: input.actorUserId,
          activated_at: input.now,
          updated_at: input.now,
        })
        .returning('id')
        .executeTakeFirstOrThrow();

      await trx
        .insertInto('payment_schedule_items')
        .values(input.data.items.map((item) => ({
          payment_schedule_id: schedule.id,
          sequence_number: item.sequenceNumber,
          item_type: item.itemType,
          amount: item.amount,
          due_at: new Date(item.dueAt),
          status: this.initialPaymentStatus(new Date(item.dueAt), input.now),
          paid_at: null,
          payment_reference: null,
          verified_by: null,
          updated_at: input.now,
        })))
        .execute();

      await this.transactionEvent(trx, input.data.transactionId, input.actorUserId, 'finance.payment_schedule.created', {
        scheduleId: schedule.id,
        itemCount: input.data.items.length,
        totalContractAmount: input.data.totalContractAmount,
        currency: input.data.currency,
      });
      await this.outbox(trx, {
        tenantId: input.data.tenantId,
        projectId: input.data.projectId,
        aggregateType: 'PAYMENT_SCHEDULE',
        aggregateId: schedule.id,
        eventType: 'finance.payment_schedule.created',
        payload: { transactionId: input.data.transactionId },
      });
      return { scheduleId: schedule.id };
    });
  }

  async createChequeSchedule(input: {
    actorUserId: string;
    data: CreateChequeScheduleInput;
    now: Date;
  }): Promise<{ created: number }> {
    return this.db.transaction().execute(async (trx) => {
      await this.assertOpenTransaction(trx, input.data.tenantId, input.data.projectId, input.data.transactionId);

      const existing = await sql<{ id: string }>`
        SELECT id FROM transaction_cheques
        WHERE transaction_id = ${input.data.transactionId}::uuid
        LIMIT 1
      `.execute(trx);
      if (existing.rows[0]) throw new ConflictException('This transaction already has a cheque schedule.');

      for (const cheque of input.data.cheques) {
        await sql`
          INSERT INTO transaction_cheques (
            tenant_id, project_id, transaction_id, sequence_number,
            amount, due_at, status, received_at, verified_by, updated_at
          ) VALUES (
            ${input.data.tenantId}::uuid,
            ${input.data.projectId}::uuid,
            ${input.data.transactionId}::uuid,
            ${cheque.sequenceNumber},
            ${cheque.amount}::numeric,
            ${new Date(cheque.dueAt)}::timestamptz,
            'EXPECTED', NULL, ${input.actorUserId}::uuid, ${input.now}::timestamptz
          )
        `.execute(trx);
      }

      await this.transactionEvent(trx, input.data.transactionId, input.actorUserId, 'finance.cheque_schedule.created', {
        count: input.data.cheques.length,
      });
      await this.outbox(trx, {
        tenantId: input.data.tenantId,
        projectId: input.data.projectId,
        aggregateType: 'CHEQUE',
        aggregateId: input.data.transactionId,
        eventType: 'finance.cheque_schedule.created',
        payload: { transactionId: input.data.transactionId, count: input.data.cheques.length },
      });
      return { created: input.data.cheques.length };
    });
  }

  private async assertOpenTransaction(
    trx: Transaction<Database>,
    tenantId: string,
    projectId: string,
    transactionId: string,
  ): Promise<void> {
    const transaction = await trx
      .selectFrom('transactions')
      .select('status')
      .where('id', '=', transactionId)
      .where('tenant_id', '=', tenantId)
      .where('project_id', '=', projectId)
      .forUpdate()
      .executeTakeFirst();
    if (!transaction || transaction.status === 'CANCELLED' || transaction.status === 'COMPLETED') {
      throw new ConflictException('Finance schedules can only be changed for an open transaction.');
    }
  }

  private initialPaymentStatus(dueAt: Date, now: Date): 'UPCOMING' | 'DUE' {
    return dueAt.getTime() <= now.getTime() ? 'DUE' : 'UPCOMING';
  }

  private async transactionEvent(
    trx: Transaction<Database>,
    transactionId: string,
    actorUserId: string,
    eventType: string,
    metadata: Record<string, JsonValue>,
  ): Promise<void> {
    await trx
      .insertInto('transaction_events')
      .values({ transaction_id: transactionId, actor_user_id: actorUserId, event_type: eventType, metadata })
      .execute();
  }

  private async outbox(
    trx: Transaction<Database>,
    input: {
      tenantId: string;
      projectId: string;
      aggregateType: string;
      aggregateId: string;
      eventType: string;
      payload: Record<string, JsonValue>;
    },
  ): Promise<void> {
    await trx
      .insertInto('domain_outbox_events')
      .values({
        tenant_id: input.tenantId,
        project_id: input.projectId,
        aggregate_type: input.aggregateType,
        aggregate_id: input.aggregateId,
        event_type: input.eventType,
        payload: input.payload,
        published_at: null,
        attempts: 0,
      })
      .execute();
  }
}
