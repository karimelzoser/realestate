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
        'b.user_id as buyer_user_id', 'r.quoted_total', 'r.currency',
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
        .selectFrom('payment_schedule_items as i')
        .innerJoin('payment_schedules as s', 's.id', 'i.payment_schedule_id')
        .select(['i.id', 'i.item_type', 'i.status', 's.id as schedule_id'])
        .where('i.id', '=', input.paymentItemId)
        .where('s.transaction_id', '=', input.transactionId)
        .where('s.tenant_id', '=', input.tenantId)
        .where('s.project_id', '=', input.projectId)
        .forUpdate()
        .executeTakeFirst();
      if (!item) return false;
      if (item.status === 'PAID') throw new ConflictException('Payment item is already paid.');
      if (['WAIVED', 'CANCELLED'].includes(item.status)) {
        throw new ConflictException('Waived or cancelled payment items cannot be marked paid.');
      }

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
        .execute();

      await this.refreshDownPaymentMilestone(trx, input.transactionId, input.actorUserId, input.now);
      await this.refreshScheduleStatus(trx, item.schedule_id, input.now);
      await this.transactionEvent(trx, input.transactionId, input.actorUserId, 'finance.payment_item.paid', {
        paymentItemId: item.id,
        itemType: item.item_type,
        paymentReference: input.paymentReference,
      });
      await this.outbox(trx, {
        tenantId: input.tenantId,
        projectId: input.projectId,
        aggregateType: 'TRANSACTION',
        aggregateId: input.transactionId,
        eventType: 'finance.payment_item.paid',
        payload: { paymentItemId: item.id, itemType: item.item_type },
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
    await this.refreshPaymentDueStates(input.tenantId, input.projectId, input.transactionId, input.now);
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
        status: item.status,
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
      const transaction = await trx
        .selectFrom('transactions')
        .select('status')
        .where('id', '=', input.data.transactionId)
        .where('tenant_id', '=', input.data.tenantId)
        .where('project_id', '=', input.data.projectId)
        .forUpdate()
        .executeTakeFirst();
      if (!transaction || transaction.status === 'CANCELLED' || transaction.status === 'COMPLETED') {
        throw new ConflictException('Cheques can only be scheduled for an open transaction.');
      }

      const existing = await trx
        .selectFrom('transaction_cheques')
        .select((eb) => eb.fn.countAll<number>().as('count'))
        .where('transaction_id', '=', input.data.transactionId)
        .executeTakeFirstOrThrow();
      if (Number(existing.count) > 0) throw new ConflictException('This transaction already has a cheque schedule.');

      await trx
        .insertInto('transaction_cheques')
        .values(input.data.cheques.map((cheque) => ({
          tenant_id: input.data.tenantId,
          project_id: input.data.projectId,
          transaction_id: input.data.transactionId,
          sequence_number: cheque.sequenceNumber,
          amount: cheque.amount,
          due_at: new Date(cheque.dueAt),
          cheque_number: null,
          bank_name: null,
          status: 'EXPECTED' as const,
          received_at: null,
          verified_by: null,
          updated_at: input.now,
        })))
        .execute();

      await this.refreshChequeMilestone(trx, input.data.transactionId, input.actorUserId, input.now);
      await this.transactionEvent(trx, input.data.transactionId, input.actorUserId, 'finance.cheque_schedule.created', {
        chequeCount: input.data.cheques.length,
      });
      await this.outbox(trx, {
        tenantId: input.data.tenantId,
        projectId: input.data.projectId,
        aggregateType: 'TRANSACTION',
        aggregateId: input.data.transactionId,
        eventType: 'finance.cheque_schedule.created',
        payload: { chequeCount: input.data.cheques.length },
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
        .select(['id', 'status', 'cheque_number', 'bank_name', 'received_at'])
        .where('id', '=', input.chequeId)
        .where('tenant_id', '=', input.tenantId)
        .where('project_id', '=', input.projectId)
        .where('transaction_id', '=', input.transactionId)
        .forUpdate()
        .executeTakeFirst();
      if (!cheque) return false;
      if (!this.chequeTransitionAllowed(cheque.status, input.status)) {
        throw new ConflictException(`Cheque cannot transition from ${cheque.status} to ${input.status}.`);
      }

      const chequeNumber = input.chequeNumber ?? cheque.cheque_number;
      const bankName = input.bankName ?? cheque.bank_name;
      if (['RECEIVED', 'DEPOSITED', 'CLEARED'].includes(input.status) && (!chequeNumber || !bankName)) {
        throw new ConflictException('Cheque number and bank name are required when a cheque is received.');
      }

      await trx
        .updateTable('transaction_cheques')
        .set({
          status: input.status,
          cheque_number: chequeNumber,
          bank_name: bankName,
          received_at: ['RECEIVED', 'DEPOSITED', 'CLEARED'].includes(input.status)
            ? (cheque.received_at ?? input.now)
            : cheque.received_at,
          verified_by: input.actorUserId,
          updated_at: input.now,
        })
        .where('id', '=', cheque.id)
        .execute();

      await this.refreshChequeMilestone(trx, input.transactionId, input.actorUserId, input.now);
      await this.transactionEvent(trx, input.transactionId, input.actorUserId, 'finance.cheque.status_changed', {
        chequeId: cheque.id,
        previousStatus: cheque.status,
        status: input.status,
      });
      await this.outbox(trx, {
        tenantId: input.tenantId,
        projectId: input.projectId,
        aggregateType: 'TRANSACTION',
        aggregateId: input.transactionId,
        eventType: 'finance.cheque.status_changed',
        payload: { chequeId: cheque.id, previousStatus: cheque.status, status: input.status },
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

  private initialPaymentStatus(dueAt: Date, now: Date): 'UPCOMING' | 'DUE' | 'OVERDUE' {
    if (dueAt.getTime() < now.getTime()) return 'OVERDUE';
    if (dueAt.getTime() <= now.getTime() + 24 * 60 * 60 * 1000) return 'DUE';
    return 'UPCOMING';
  }

  private async refreshPaymentDueStates(
    tenantId: string,
    projectId: string,
    transactionId: string,
    now: Date,
  ): Promise<void> {
    const horizon = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    await this.db
      .updateTable('payment_schedule_items')
      .set({ status: 'OVERDUE', updated_at: now })
      .where('payment_schedule_id', 'in', (eb) =>
        eb.selectFrom('payment_schedules').select('id')
          .where('tenant_id', '=', tenantId)
          .where('project_id', '=', projectId)
          .where('transaction_id', '=', transactionId),
      )
      .where('status', 'in', ['UPCOMING', 'DUE'])
      .where('due_at', '<', now)
      .execute();
    await this.db
      .updateTable('payment_schedule_items')
      .set({ status: 'DUE', updated_at: now })
      .where('payment_schedule_id', 'in', (eb) =>
        eb.selectFrom('payment_schedules').select('id')
          .where('tenant_id', '=', tenantId)
          .where('project_id', '=', projectId)
          .where('transaction_id', '=', transactionId),
      )
      .where('status', '=', 'UPCOMING')
      .where('due_at', '<=', horizon)
      .execute();
  }

  private async refreshScheduleStatus(trx: Transaction<Database>, scheduleId: string, now: Date): Promise<void> {
    const outstanding = await trx
      .selectFrom('payment_schedule_items')
      .select((eb) => eb.fn.countAll<number>().as('count'))
      .where('payment_schedule_id', '=', scheduleId)
      .where('status', 'not in', ['PAID', 'WAIVED', 'CANCELLED'])
      .executeTakeFirstOrThrow();
    if (Number(outstanding.count) === 0) {
      await trx.updateTable('payment_schedules').set({ status: 'COMPLETED', updated_at: now }).where('id', '=', scheduleId).execute();
    }
  }

  private async refreshDownPaymentMilestone(
    trx: Transaction<Database>,
    transactionId: string,
    actorUserId: string,
    now: Date,
  ): Promise<void> {
    const rows = await trx
      .selectFrom('payment_schedule_items as i')
      .innerJoin('payment_schedules as s', 's.id', 'i.payment_schedule_id')
      .select(['i.status'])
      .where('s.transaction_id', '=', transactionId)
      .where('i.item_type', '=', 'DOWN_PAYMENT')
      .execute();
    const complete = rows.length > 0 && rows.every((row) => ['PAID', 'WAIVED'].includes(row.status));
    await this.setMilestoneState(trx, transactionId, 'DOWN_PAYMENT_RECEIVED', complete, actorUserId, now);
  }

  private async refreshChequeMilestone(
    trx: Transaction<Database>,
    transactionId: string,
    actorUserId: string,
    now: Date,
  ): Promise<void> {
    const cheques = await trx
      .selectFrom('transaction_cheques')
      .select('status')
      .where('transaction_id', '=', transactionId)
      .execute();
    const active = cheques.filter((cheque) => cheque.status !== 'CANCELLED');
    const complete = active.length > 0 && active.every((cheque) => ['RECEIVED', 'DEPOSITED', 'CLEARED'].includes(cheque.status));
    await this.setMilestoneState(trx, transactionId, 'CHEQUES_RECEIVED', complete, actorUserId, now);
  }

  private async setMilestoneState(
    trx: Transaction<Database>,
    transactionId: string,
    code: 'DOWN_PAYMENT_RECEIVED' | 'CHEQUES_RECEIVED',
    complete: boolean,
    actorUserId: string,
    now: Date,
  ): Promise<void> {
    if (complete) {
      await trx
        .updateTable('transaction_milestones')
        .set({ status: 'COMPLETED', completed_at: now, completed_by: actorUserId, updated_at: now })
        .where('transaction_id', '=', transactionId)
        .where('code', '=', code)
        .where('status', '<>', 'WAIVED')
        .execute();
      return;
    }
    await trx
      .updateTable('transaction_milestones')
      .set({ status: 'PENDING', completed_at: null, completed_by: null, updated_at: now })
      .where('transaction_id', '=', transactionId)
      .where('code', '=', code)
      .where('status', '=', 'COMPLETED')
      .execute();
  }

  private chequeTransitionAllowed(
    from: 'EXPECTED' | 'RECEIVED' | 'DEPOSITED' | 'CLEARED' | 'RETURNED' | 'CANCELLED',
    to: 'RECEIVED' | 'DEPOSITED' | 'CLEARED' | 'RETURNED' | 'CANCELLED',
  ): boolean {
    if (from === to) return false;
    const transitions: Record<typeof from, readonly string[]> = {
      EXPECTED: ['RECEIVED', 'CANCELLED'],
      RECEIVED: ['DEPOSITED', 'RETURNED', 'CANCELLED'],
      DEPOSITED: ['CLEARED', 'RETURNED'],
      CLEARED: [],
      RETURNED: ['RECEIVED', 'CANCELLED'],
      CANCELLED: [],
    };
    return transitions[from].includes(to);
  }

  private async transactionEvent(
    trx: Transaction<Database>,
    transactionId: string,
    actorUserId: string,
    eventType: string,
    metadata: Record<string, JsonValue>,
  ): Promise<void> {
    await trx.insertInto('transaction_events').values({
      transaction_id: transactionId,
      actor_user_id: actorUserId,
      event_type: eventType,
      metadata,
    }).execute();
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
    await trx.insertInto('domain_outbox_events').values({
      tenant_id: input.tenantId,
      project_id: input.projectId,
      aggregate_type: input.aggregateType,
      aggregate_id: input.aggregateId,
      event_type: input.eventType,
      payload: input.payload,
      published_at: null,
      attempts: 0,
    }).execute();
  }
}
