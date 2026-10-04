import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { Kysely, Transaction } from 'kysely';
import type { Database, JsonValue } from '@preneura/database';
import type {
  ChequeSnapshot,
  CreateChequeScheduleInput,
  CreatePaymentScheduleInput,
  PaymentScheduleSnapshot,
} from '@preneura/contracts/finance';
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
        join.onRef('r.id', '=', 't.reservation_id').onRef('r.tenant_id', '=', 't.tenant_id').onRef('r.project_id', '=', 't.project_id'),
      )
      .select([
        't.id', 't.tenant_id', 't.project_id', 't.status',
        'b.user_id as buyer_user_id', 'b.broker_company_id', 'b.broker_agent_user_id',
        'r.quoted_total', 'r.currency',
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
      const transaction = await trx
        .selectFrom('transactions')
        .select('status')
        .where('id', '=', input.data.transactionId)
        .where('tenant_id', '=', input.data.tenantId)
        .where('project_id', '=', input.data.projectId)
        .forUpdate()
        .executeTakeFirst();
      if (!transaction || transaction.status === 'CANCELLED' || transaction.status === 'COMPLETED') {
        throw new ConflictException('Payment schedules can only be created for an open transaction.');
      }

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

      await this.refreshDownPaymentMilestone(trx, input.data.transactionId, input.actorUserId, input.now);
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

  async markPaymentItemPaid(input: {
    actorUserId: string;
    tenantId: string;
    projectId: string;
    transactionId: string;
    paymentItemId: string;
    paymentReference: string;
    now: Date;
  }): Promise<boolean> {
    return this.db.transaction().execute(async (trx) => {
      const item = await trx
        .selectFrom('payment_schedule_items as item')
        .innerJoin('payment_schedules as schedule', 'schedule.id', 'item.payment_schedule_id')
        .select(['item.id', 'item.item_type'])
        .where('item.id', '=', input.paymentItemId)
        .where('schedule.transaction_id', '=', input.transactionId)
        .where('schedule.tenant_id', '=', input.tenantId)
        .where('schedule.project_id', '=', input.projectId)
        .where('item.status', 'not in', ['PAID', 'WAIVED', 'CANCELLED'])
        .forUpdate()
        .executeTakeFirst();
      if (!item) return false;

      await trx
        .updateTable('payment_schedule_items')
        .set({
          status: 'PAID',
          paid_at: input.now,
          payment_reference: input.paymentReference,
          verified_by: input.actorUserId,
          updated_at: input.now,
        })
        .where('id', '=', item.id)
        .executeTakeFirstOrThrow();

      await this.refreshPaymentScheduleStatus(trx, input.transactionId, input.now);
      await this.refreshDownPaymentMilestone(trx, input.transactionId, input.actorUserId, input.now);
      await this.transactionEvent(trx, input.transactionId, input.actorUserId, 'finance.payment.paid', {
        paymentItemId: item.id,
        itemType: item.item_type,
        paymentReference: input.paymentReference,
      });
      await this.outbox(trx, {
        tenantId: input.tenantId,
        projectId: input.projectId,
        aggregateType: 'PAYMENT_ITEM',
        aggregateId: item.id,
        eventType: 'finance.payment.paid',
        payload: { transactionId: input.transactionId, itemType: item.item_type },
      });
      return true;
    });
  }

  async getPaymentSchedule(input: {
    tenantId: string;
    projectId: string;
    transactionId: string;
    now: Date;
  }): Promise<PaymentScheduleSnapshot | null> {
    const schedule = await this.db
      .selectFrom('payment_schedules')
      .select(['id', 'transaction_id', 'currency', 'total_contract_amount', 'status'])
      .where('tenant_id', '=', input.tenantId)
      .where('project_id', '=', input.projectId)
      .where('transaction_id', '=', input.transactionId)
      .executeTakeFirst();
    if (!schedule) return null;

    const items = await this.db
      .selectFrom('payment_schedule_items')
      .select(['id', 'sequence_number', 'item_type', 'amount', 'due_at', 'status', 'paid_at'])
      .where('payment_schedule_id', '=', schedule.id)
      .orderBy('sequence_number', 'asc')
      .execute();

    return {
      scheduleId: schedule.id,
      transactionId: schedule.transaction_id,
      currency: schedule.currency,
      totalContractAmount: String(schedule.total_contract_amount),
      status: schedule.status,
      items: items.map((item) => ({
        paymentItemId: item.id,
        sequenceNumber: item.sequence_number,
        itemType: item.item_type,
        amount: String(item.amount),
        dueAt: (item.due_at as Date).toISOString(),
        status: item.status === 'UPCOMING' && (item.due_at as Date).getTime() <= input.now.getTime()
          ? 'DUE'
          : item.status,
        paidAt: item.paid_at ? (item.paid_at as Date).toISOString() : null,
      })),
    };
  }

  async createChequeSchedule(input: {
    actorUserId: string;
    data: CreateChequeScheduleInput;
    now: Date;
  }): Promise<{ created: number }> {
    return this.db.transaction().execute(async (trx) => {
      const existing = await trx
        .selectFrom('transaction_cheques')
        .select('id')
        .where('transaction_id', '=', input.data.transactionId)
        .executeTakeFirst();
      if (existing) throw new ConflictException('This transaction already has a cheque schedule.');

      await trx
        .insertInto('transaction_cheques')
        .values(input.data.cheques.map((cheque) => ({
          tenant_id: input.data.tenantId,
          project_id: input.data.projectId,
          transaction_id: input.data.transactionId,
          sequence_number: cheque.sequenceNumber,
          amount: cheque.amount,
          due_at: new Date(cheque.dueAt),
          status: 'EXPECTED' as const,
          cheque_number: null,
          bank_name: null,
          received_at: null,
          deposited_at: null,
          cleared_at: null,
          returned_at: null,
          cancelled_at: null,
          updated_at: input.now,
        })))
        .execute();

      await this.refreshChequesMilestone(trx, input.data.transactionId, input.actorUserId, input.now);
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

  async updateChequeStatus(input: {
    actorUserId: string;
    tenantId: string;
    projectId: string;
    transactionId: string;
    chequeId: string;
    status: 'RECEIVED' | 'DEPOSITED' | 'CLEARED' | 'RETURNED' | 'CANCELLED';
    chequeNumber: string | null;
    bankName: string | null;
    now: Date;
  }): Promise<boolean> {
    return this.db.transaction().execute(async (trx) => {
      const cheque = await trx
        .selectFrom('transaction_cheques')
        .select(['id', 'status'])
        .where('id', '=', input.chequeId)
        .where('transaction_id', '=', input.transactionId)
        .where('tenant_id', '=', input.tenantId)
        .where('project_id', '=', input.projectId)
        .forUpdate()
        .executeTakeFirst();
      if (!cheque) return false;
      this.assertChequeTransition(cheque.status, input.status);

      const timestamps = {
        received_at: input.status === 'RECEIVED' ? input.now : undefined,
        deposited_at: input.status === 'DEPOSITED' ? input.now : undefined,
        cleared_at: input.status === 'CLEARED' ? input.now : undefined,
        returned_at: input.status === 'RETURNED' ? input.now : undefined,
        cancelled_at: input.status === 'CANCELLED' ? input.now : undefined,
      };
      await trx
        .updateTable('transaction_cheques')
        .set({
          status: input.status,
          cheque_number: input.chequeNumber,
          bank_name: input.bankName,
          ...timestamps,
          updated_at: input.now,
        })
        .where('id', '=', cheque.id)
        .executeTakeFirstOrThrow();

      await this.refreshChequesMilestone(trx, input.transactionId, input.actorUserId, input.now);
      await this.transactionEvent(trx, input.transactionId, input.actorUserId, 'finance.cheque.status_changed', {
        chequeId: cheque.id,
        from: cheque.status,
        to: input.status,
      });
      await this.outbox(trx, {
        tenantId: input.tenantId,
        projectId: input.projectId,
        aggregateType: 'CHEQUE',
        aggregateId: cheque.id,
        eventType: 'finance.cheque.status_changed',
        payload: { transactionId: input.transactionId, from: cheque.status, to: input.status },
      });
      return true;
    });
  }

  async listCheques(input: {
    tenantId: string;
    projectId: string;
    transactionId: string;
  }): Promise<ChequeSnapshot[]> {
    const rows = await this.db
      .selectFrom('transaction_cheques')
      .select(['id', 'sequence_number', 'amount', 'due_at', 'status', 'cheque_number', 'bank_name', 'received_at'])
      .where('tenant_id', '=', input.tenantId)
      .where('project_id', '=', input.projectId)
      .where('transaction_id', '=', input.transactionId)
      .orderBy('sequence_number', 'asc')
      .execute();
    return rows.map((row) => ({
      chequeId: row.id,
      sequenceNumber: row.sequence_number,
      amount: String(row.amount),
      dueAt: (row.due_at as Date).toISOString(),
      status: row.status,
      chequeNumber: row.cheque_number,
      bankName: row.bank_name,
      receivedAt: row.received_at ? (row.received_at as Date).toISOString() : null,
    }));
  }

  private initialPaymentStatus(dueAt: Date, now: Date): 'UPCOMING' | 'DUE' {
    return dueAt.getTime() <= now.getTime() ? 'DUE' : 'UPCOMING';
  }

  private async refreshPaymentScheduleStatus(trx: Transaction<Database>, transactionId: string, now: Date): Promise<void> {
    const schedule = await trx
      .selectFrom('payment_schedules')
      .select('id')
      .where('transaction_id', '=', transactionId)
      .executeTakeFirst();
    if (!schedule) return;

    const remaining = await trx
      .selectFrom('payment_schedule_items')
      .select((eb) => eb.fn.countAll<number>().as('count'))
      .where('payment_schedule_id', '=', schedule.id)
      .where('status', 'not in', ['PAID', 'WAIVED', 'CANCELLED'])
      .executeTakeFirstOrThrow();
    if (Number(remaining.count) === 0) {
      await trx
        .updateTable('payment_schedules')
        .set({ status: 'COMPLETED', updated_at: now })
        .where('id', '=', schedule.id)
        .execute();
    }
  }

  private async refreshDownPaymentMilestone(
    trx: Transaction<Database>,
    transactionId: string,
    actorUserId: string,
    now: Date,
  ): Promise<void> {
    const pendingDownPayment = await trx
      .selectFrom('payment_schedule_items as item')
      .innerJoin('payment_schedules as schedule', 'schedule.id', 'item.payment_schedule_id')
      .select('item.id')
      .where('schedule.transaction_id', '=', transactionId)
      .where('item.item_type', '=', 'DOWN_PAYMENT')
      .where('item.status', 'not in', ['PAID', 'WAIVED', 'CANCELLED'])
      .executeTakeFirst();
    if (pendingDownPayment) return;
    await this.completeMilestoneIfPending(trx, transactionId, 'DOWN_PAYMENT_RECEIVED', actorUserId, now);
  }

  private async refreshChequesMilestone(
    trx: Transaction<Database>,
    transactionId: string,
    actorUserId: string,
    now: Date,
  ): Promise<void> {
    const expected = await trx
      .selectFrom('transaction_cheques')
      .select((eb) => eb.fn.countAll<number>().as('count'))
      .where('transaction_id', '=', transactionId)
      .executeTakeFirstOrThrow();
    if (Number(expected.count) === 0) return;
    const incomplete = await trx
      .selectFrom('transaction_cheques')
      .select('id')
      .where('transaction_id', '=', transactionId)
      .where('status', 'not in', ['RECEIVED', 'DEPOSITED', 'CLEARED'])
      .executeTakeFirst();
    if (incomplete) return;
    await this.completeMilestoneIfPending(trx, transactionId, 'CHEQUES_RECEIVED', actorUserId, now);
  }

  private async completeMilestoneIfPending(
    trx: Transaction<Database>,
    transactionId: string,
    code: 'DOWN_PAYMENT_RECEIVED' | 'CHEQUES_RECEIVED',
    actorUserId: string,
    now: Date,
  ): Promise<void> {
    await trx
      .updateTable('transaction_milestones')
      .set({ status: 'COMPLETED', completed_at: now, completed_by: actorUserId, updated_at: now })
      .where('transaction_id', '=', transactionId)
      .where('code', '=', code)
      .where('status', 'in', ['PENDING', 'BLOCKED'])
      .execute();
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

  private assertChequeTransition(
    from: 'EXPECTED' | 'RECEIVED' | 'DEPOSITED' | 'CLEARED' | 'RETURNED' | 'CANCELLED',
    to: 'RECEIVED' | 'DEPOSITED' | 'CLEARED' | 'RETURNED' | 'CANCELLED',
  ): void {
    const allowed: Readonly<Record<string, readonly string[]>> = {
      EXPECTED: ['RECEIVED', 'CANCELLED'],
      RECEIVED: ['DEPOSITED', 'RETURNED', 'CANCELLED'],
      DEPOSITED: ['CLEARED', 'RETURNED'],
      RETURNED: ['RECEIVED', 'CANCELLED'],
      CLEARED: [],
      CANCELLED: [],
    };
    if (!(allowed[from] ?? []).includes(to)) {
      throw new ConflictException(`Cheque status cannot transition from ${from} to ${to}.`);
    }
  }
}
