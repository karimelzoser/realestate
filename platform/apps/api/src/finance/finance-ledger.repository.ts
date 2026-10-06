import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type {
  ChequeEventSnapshot,
  ChequeHistorySnapshot,
  ChequeSnapshot,
  CompensatePaymentInput,
  FinanceLedgerSnapshot,
  FinancePaymentAllocationSnapshot,
  FinancePaymentEventSnapshot,
  PaymentScheduleSnapshot,
  PostManualPaymentInput,
  ProviderFinanceEventInput,
  ReplaceChequeInput,
  UpdateChequeStatusInput,
} from '@preneura/contracts/finance';
import type { Database } from '@preneura/database';
import { sql, type Kysely } from 'kysely';
import { DATABASE } from '../database/database.module.js';

@Injectable()
export class FinanceLedgerRepository {
  constructor(@Inject(DATABASE) private readonly db: Kysely<Database>) {}

  async getPaymentSchedule(input: {
    tenantId: string;
    projectId: string;
    transactionId: string;
    now: Date;
  }): Promise<PaymentScheduleSnapshot | null> {
    const scheduleResult = await sql<{
      id: string;
      transaction_id: string;
      currency: string;
      total_contract_amount: string | number;
      status: PaymentScheduleSnapshot['status'];
    }>`
      SELECT id, transaction_id, currency, total_contract_amount, status
      FROM payment_schedules
      WHERE tenant_id = ${input.tenantId}::uuid
        AND project_id = ${input.projectId}::uuid
        AND transaction_id = ${input.transactionId}::uuid
      LIMIT 1
    `.execute(this.db);
    const schedule = scheduleResult.rows[0];
    if (!schedule) return null;

    const items = await sql<{
      id: string;
      sequence_number: number;
      item_type: 'DOWN_PAYMENT' | 'INSTALLMENT' | 'FEE';
      amount: string | number;
      paid_amount: string | number;
      due_at: Date;
      status: PaymentScheduleSnapshot['items'][number]['status'];
      paid_at: Date | null;
    }>`
      SELECT id, sequence_number, item_type, amount, paid_amount,
             due_at, status, paid_at
      FROM payment_schedule_items
      WHERE payment_schedule_id = ${schedule.id}::uuid
      ORDER BY sequence_number ASC
    `.execute(this.db);

    return {
      scheduleId: schedule.id,
      transactionId: schedule.transaction_id,
      currency: schedule.currency,
      totalContractAmount: String(schedule.total_contract_amount),
      status: schedule.status,
      items: items.rows.map((item) => {
        const amount = this.moneyCents(String(item.amount));
        const paid = this.moneyCents(String(item.paid_amount));
        const remaining = amount > paid ? amount - paid : 0n;
        const effectiveStatus = item.status === 'UPCOMING' && item.due_at.getTime() <= input.now.getTime()
          ? 'DUE'
          : item.status;
        return {
          paymentItemId: item.id,
          sequenceNumber: item.sequence_number,
          itemType: item.item_type,
          amount: this.centsString(amount),
          paidAmount: this.centsString(paid),
          remainingAmount: this.centsString(remaining),
          dueAt: item.due_at.toISOString(),
          status: effectiveStatus,
          paidAt: item.paid_at?.toISOString() ?? null,
        };
      }),
    };
  }

  async remainingAmountForItem(input: {
    tenantId: string;
    projectId: string;
    transactionId: string;
    paymentItemId: string;
  }): Promise<{ remainingAmount: string; currency: string } | null> {
    const result = await sql<{
      amount: string | number;
      paid_amount: string | number;
      currency: string;
      status: string;
    }>`
      SELECT i.amount, i.paid_amount, s.currency, i.status
      FROM payment_schedule_items i
      JOIN payment_schedules s ON s.id = i.payment_schedule_id
      WHERE i.id = ${input.paymentItemId}::uuid
        AND s.tenant_id = ${input.tenantId}::uuid
        AND s.project_id = ${input.projectId}::uuid
        AND s.transaction_id = ${input.transactionId}::uuid
      LIMIT 1
    `.execute(this.db);
    const row = result.rows[0];
    if (!row || ['WAIVED', 'CANCELLED'].includes(row.status)) return null;
    const amount = this.moneyCents(String(row.amount));
    const paid = this.moneyCents(String(row.paid_amount));
    return {
      remainingAmount: this.centsString(amount > paid ? amount - paid : 0n),
      currency: row.currency,
    };
  }

  async postManualPayment(input: {
    actorUserId: string;
    currency: string;
    data: PostManualPaymentInput;
  }): Promise<{ paymentEventId: string }> {
    let allocations: unknown = input.data.allocations.map((allocation) => ({
      paymentItemId: allocation.paymentItemId,
      amount: allocation.amount,
    }));
    if (input.data.allocations.length === 0) {
      const fifo = await sql<{ value: unknown }>`
        SELECT preneura_fifo_payment_allocations(
          ${input.data.transactionId}::uuid,
          ${input.data.amount}::numeric
        ) AS value
      `.execute(this.db);
      allocations = fifo.rows[0]?.value ?? [];
    }

    const result = await sql<{ id: string }>`
      SELECT preneura_post_finance_event(
        ${input.data.tenantId}::uuid,
        ${input.data.projectId}::uuid,
        ${input.data.transactionId}::uuid,
        'PAYMENT_RECEIVED',
        ${input.data.amount}::numeric,
        ${input.currency}::char(3),
        'MANUAL',
        ${input.data.paymentReference},
        ${input.actorUserId}::uuid,
        ${input.data.occurredAt ? new Date(input.data.occurredAt) : new Date()}::timestamptz,
        ${JSON.stringify(allocations)}::jsonb,
        NULL,
        NULL,
        NULL,
        '{}'::jsonb
      ) AS id
    `.execute(this.db);
    return { paymentEventId: result.rows[0]!.id };
  }

  async compensatePayment(input: {
    actorUserId: string;
    data: CompensatePaymentInput;
  }): Promise<{ paymentEventId: string }> {
    const originalResult = await sql<{
      id: string;
      currency: string;
      event_type: string;
    }>`
      SELECT id, currency, event_type
      FROM finance_payment_events
      WHERE id = ${input.data.paymentEventId}::uuid
        AND tenant_id = ${input.data.tenantId}::uuid
        AND project_id = ${input.data.projectId}::uuid
        AND transaction_id = ${input.data.transactionId}::uuid
      LIMIT 1
    `.execute(this.db);
    const original = originalResult.rows[0];
    if (!original || original.event_type !== 'PAYMENT_RECEIVED') {
      throw new NotFoundException('Original payment receipt was not found.');
    }

    const allocationResult = await sql<{ value: unknown }>`
      SELECT preneura_compensating_allocations(
        ${original.id}::uuid,
        ${input.data.amount}::numeric
      ) AS value
    `.execute(this.db);
    const eventType = input.data.kind === 'REVERSAL' ? 'PAYMENT_REVERSED' : 'REFUND_ISSUED';
    const result = await sql<{ id: string }>`
      SELECT preneura_post_finance_event(
        ${input.data.tenantId}::uuid,
        ${input.data.projectId}::uuid,
        ${input.data.transactionId}::uuid,
        ${eventType},
        ${input.data.amount}::numeric,
        ${original.currency}::char(3),
        'MANUAL',
        ${input.data.reference},
        ${input.actorUserId}::uuid,
        ${input.data.occurredAt ? new Date(input.data.occurredAt) : new Date()}::timestamptz,
        ${JSON.stringify(allocationResult.rows[0]?.value ?? [])}::jsonb,
        NULL,
        NULL,
        ${original.id}::uuid,
        '{}'::jsonb
      ) AS id
    `.execute(this.db);
    return { paymentEventId: result.rows[0]!.id };
  }

  async ingestProvider(input: {
    provider: string;
    payloadSha256Hex: string;
    data: ProviderFinanceEventInput;
  }): Promise<{ paymentEventId: string }> {
    const result = await sql<{ id: string }>`
      SELECT preneura_ingest_provider_finance_event(
        ${input.provider},
        ${input.data.eventId},
        ${input.payloadSha256Hex},
        ${input.data.tenantId}::uuid,
        ${input.data.projectId}::uuid,
        ${input.data.transactionId}::uuid,
        ${input.data.eventType},
        ${input.data.amount}::numeric,
        ${input.data.currency}::char(3),
        ${input.data.externalReference},
        ${new Date(input.data.occurredAt)}::timestamptz,
        ${input.data.relatedEventId ?? null}
      ) AS id
    `.execute(this.db);
    return { paymentEventId: result.rows[0]!.id };
  }

  async getLedger(input: {
    tenantId: string;
    projectId: string;
    transactionId: string;
  }): Promise<FinanceLedgerSnapshot> {
    const currencyResult = await sql<{ currency: string }>`
      SELECT r.currency
      FROM transactions t
      JOIN reservations r ON r.id = t.reservation_id
      WHERE t.id = ${input.transactionId}::uuid
        AND t.tenant_id = ${input.tenantId}::uuid
        AND t.project_id = ${input.projectId}::uuid
      LIMIT 1
    `.execute(this.db);
    const currency = currencyResult.rows[0]?.currency;
    if (!currency) throw new NotFoundException('Transaction not found.');

    const eventResult = await sql<{
      id: string;
      event_type: FinancePaymentEventSnapshot['eventType'];
      amount: string | number;
      currency: string;
      source: FinancePaymentEventSnapshot['source'];
      external_reference: string;
      provider: string | null;
      provider_event_id: string | null;
      related_event_id: string | null;
      occurred_at: Date;
      created_at: Date;
    }>`
      SELECT id, event_type, amount, currency, source, external_reference,
             provider, provider_event_id, related_event_id, occurred_at, created_at
      FROM finance_payment_events
      WHERE tenant_id = ${input.tenantId}::uuid
        AND project_id = ${input.projectId}::uuid
        AND transaction_id = ${input.transactionId}::uuid
      ORDER BY occurred_at ASC, created_at ASC, id ASC
    `.execute(this.db);

    const allocationResult = await sql<{
      id: string;
      payment_event_id: string;
      payment_schedule_item_id: string;
      amount: string | number;
      original_allocation_id: string | null;
    }>`
      SELECT a.id, a.payment_event_id, a.payment_schedule_item_id,
             a.amount, a.original_allocation_id
      FROM finance_payment_allocations a
      JOIN finance_payment_events e ON e.id = a.payment_event_id
      WHERE e.tenant_id = ${input.tenantId}::uuid
        AND e.project_id = ${input.projectId}::uuid
        AND e.transaction_id = ${input.transactionId}::uuid
      ORDER BY a.created_at ASC, a.id ASC
    `.execute(this.db);

    const balanceResult = await sql<{
      net_cash: string | number;
      net_allocated: string | number;
    }>`
      SELECT
        COALESCE((
          SELECT sum(l.signed_amount)
          FROM finance_ledger_entries l
          WHERE l.transaction_id = ${input.transactionId}::uuid
            AND l.account = 'CASH_CLEARING'
        ), 0)::numeric(18,2) AS net_cash,
        COALESCE((
          SELECT sum(a.amount)
          FROM finance_payment_allocations a
          JOIN finance_payment_events e ON e.id = a.payment_event_id
          WHERE e.transaction_id = ${input.transactionId}::uuid
        ), 0)::numeric(18,2) AS net_allocated
    `.execute(this.db);
    const balances = balanceResult.rows[0]!;
    const netCash = this.moneyCents(String(balances.net_cash));
    const netAllocated = this.moneyCents(String(balances.net_allocated));

    const allocationsByEvent = new Map<string, FinancePaymentAllocationSnapshot[]>();
    for (const allocation of allocationResult.rows) {
      const values = allocationsByEvent.get(allocation.payment_event_id) ?? [];
      values.push({
        allocationId: allocation.id,
        paymentItemId: allocation.payment_schedule_item_id,
        amount: String(allocation.amount),
        originalAllocationId: allocation.original_allocation_id,
      });
      allocationsByEvent.set(allocation.payment_event_id, values);
    }

    return {
      transactionId: input.transactionId,
      currency,
      netCashReceived: this.centsString(netCash),
      netAllocated: this.centsString(netAllocated),
      unallocatedCash: this.centsString(netCash - netAllocated),
      events: eventResult.rows.map((event) => ({
        paymentEventId: event.id,
        eventType: event.event_type,
        amount: String(event.amount),
        currency: event.currency,
        source: event.source,
        externalReference: event.external_reference,
        provider: event.provider,
        providerEventId: event.provider_event_id,
        relatedEventId: event.related_event_id,
        occurredAt: event.occurred_at.toISOString(),
        createdAt: event.created_at.toISOString(),
        allocations: allocationsByEvent.get(event.id) ?? [],
      })),
    };
  }

  async listCheques(input: {
    tenantId: string;
    projectId: string;
    transactionId: string;
  }): Promise<ChequeSnapshot[]> {
    const result = await sql<{
      id: string;
      root_cheque_id: string;
      replaces_cheque_id: string | null;
      generation: number;
      sequence_number: number;
      amount: string | number;
      due_at: Date;
      status: ChequeSnapshot['status'];
      cheque_number: string | null;
      bank_name: string | null;
      received_at: Date | null;
    }>`
      SELECT id, root_cheque_id, replaces_cheque_id, generation,
             sequence_number, amount, due_at, status, cheque_number,
             bank_name, received_at
      FROM transaction_cheques
      WHERE tenant_id = ${input.tenantId}::uuid
        AND project_id = ${input.projectId}::uuid
        AND transaction_id = ${input.transactionId}::uuid
      ORDER BY sequence_number ASC, generation ASC
    `.execute(this.db);
    return result.rows.map((row) => this.mapCheque(row));
  }

  async recordChequeStatus(input: {
    actorUserId: string;
    data: UpdateChequeStatusInput;
  }): Promise<{ updated: true }> {
    const scope = await sql<{ id: string }>`
      SELECT id FROM transaction_cheques
      WHERE id = ${input.data.chequeId}::uuid
        AND tenant_id = ${input.data.tenantId}::uuid
        AND project_id = ${input.data.projectId}::uuid
        AND transaction_id = ${input.data.transactionId}::uuid
      LIMIT 1
    `.execute(this.db);
    if (!scope.rows[0]) throw new NotFoundException('Cheque not found.');

    await sql`
      SELECT preneura_record_cheque_event(
        ${input.data.chequeId}::uuid,
        ${input.data.status},
        ${input.actorUserId}::uuid,
        ${new Date()}::timestamptz,
        ${input.data.chequeNumber ?? null},
        ${input.data.bankName ?? null},
        '{}'::jsonb
      )
    `.execute(this.db);
    return { updated: true };
  }

  async replaceCheque(input: {
    actorUserId: string;
    data: ReplaceChequeInput;
  }): Promise<{ chequeId: string }> {
    const scope = await sql<{ id: string }>`
      SELECT id FROM transaction_cheques
      WHERE id = ${input.data.chequeId}::uuid
        AND tenant_id = ${input.data.tenantId}::uuid
        AND project_id = ${input.data.projectId}::uuid
        AND transaction_id = ${input.data.transactionId}::uuid
      LIMIT 1
    `.execute(this.db);
    if (!scope.rows[0]) throw new NotFoundException('Cheque not found.');

    const result = await sql<{ id: string }>`
      SELECT preneura_replace_returned_cheque(
        ${input.data.chequeId}::uuid,
        ${input.actorUserId}::uuid,
        ${input.data.amount}::numeric,
        ${new Date(input.data.dueAt)}::timestamptz,
        ${input.data.chequeNumber ?? null},
        ${input.data.bankName ?? null},
        ${input.data.occurredAt ? new Date(input.data.occurredAt) : new Date()}::timestamptz
      ) AS id
    `.execute(this.db);
    return { chequeId: result.rows[0]!.id };
  }

  async getChequeHistory(input: {
    tenantId: string;
    projectId: string;
    transactionId: string;
    chequeId: string;
  }): Promise<ChequeHistorySnapshot> {
    const rootResult = await sql<{ root_cheque_id: string }>`
      SELECT root_cheque_id
      FROM transaction_cheques
      WHERE id = ${input.chequeId}::uuid
        AND tenant_id = ${input.tenantId}::uuid
        AND project_id = ${input.projectId}::uuid
        AND transaction_id = ${input.transactionId}::uuid
      LIMIT 1
    `.execute(this.db);
    const rootChequeId = rootResult.rows[0]?.root_cheque_id;
    if (!rootChequeId) throw new NotFoundException('Cheque not found.');

    const cheques = await this.listCheques(input);
    const chain = cheques.filter((cheque) => cheque.rootChequeId === rootChequeId);
    const eventsResult = await sql<{
      id: string;
      cheque_id: string;
      event_type: ChequeEventSnapshot['eventType'];
      cheque_number: string | null;
      bank_name: string | null;
      replacement_cheque_id: string | null;
      actor_user_id: string | null;
      occurred_at: Date;
    }>`
      SELECT e.id, e.cheque_id, e.event_type, e.cheque_number, e.bank_name,
             e.replacement_cheque_id, e.actor_user_id, e.occurred_at
      FROM finance_cheque_events e
      JOIN transaction_cheques c ON c.id = e.cheque_id
      WHERE c.root_cheque_id = ${rootChequeId}::uuid
        AND c.transaction_id = ${input.transactionId}::uuid
      ORDER BY e.occurred_at ASC, e.created_at ASC, e.id ASC
    `.execute(this.db);

    return {
      rootChequeId,
      cheques: chain,
      events: eventsResult.rows.map((event) => ({
        eventId: event.id,
        chequeId: event.cheque_id,
        eventType: event.event_type,
        chequeNumber: event.cheque_number,
        bankName: event.bank_name,
        replacementChequeId: event.replacement_cheque_id,
        actorUserId: event.actor_user_id,
        occurredAt: event.occurred_at.toISOString(),
      })),
    };
  }

  private mapCheque(row: {
    id: string;
    root_cheque_id: string;
    replaces_cheque_id: string | null;
    generation: number;
    sequence_number: number;
    amount: string | number;
    due_at: Date;
    status: ChequeSnapshot['status'];
    cheque_number: string | null;
    bank_name: string | null;
    received_at: Date | null;
  }): ChequeSnapshot {
    return {
      chequeId: row.id,
      rootChequeId: row.root_cheque_id,
      replacesChequeId: row.replaces_cheque_id,
      generation: Number(row.generation),
      sequenceNumber: Number(row.sequence_number),
      amount: String(row.amount),
      dueAt: row.due_at.toISOString(),
      status: row.status,
      chequeNumber: row.cheque_number,
      bankName: row.bank_name,
      receivedAt: row.received_at?.toISOString() ?? null,
    };
  }

  private moneyCents(value: string): bigint {
    const negative = value.trim().startsWith('-');
    const normalized = negative ? value.trim().slice(1) : value.trim();
    const [whole = '0', fraction = ''] = normalized.split('.');
    const cents = `${fraction}00`.slice(0, 2);
    const result = BigInt(whole || '0') * 100n + BigInt(cents || '0');
    return negative ? -result : result;
  }

  private centsString(value: bigint): string {
    const negative = value < 0n;
    const absolute = negative ? -value : value;
    const whole = absolute / 100n;
    const fraction = String(absolute % 100n).padStart(2, '0');
    return `${negative ? '-' : ''}${whole}.${fraction}`;
  }
}
