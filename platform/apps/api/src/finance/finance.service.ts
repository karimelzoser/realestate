import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { PermissionCode } from '@preneura/contracts/access';
import type {
  ChequeHistorySnapshot,
  ChequeSnapshot,
  CompensatePaymentInput,
  CreateChequeScheduleInput,
  CreatePaymentScheduleInput,
  FinanceLedgerSnapshot,
  MarkPaymentItemPaidInput,
  PaymentScheduleSnapshot,
  PostManualPaymentInput,
  ProviderFinanceEventInput,
  ReplaceChequeInput,
  UpdateChequeStatusInput,
} from '@preneura/contracts/finance';
import { AccessService } from '../access/access.service.js';
import { CommissionService } from '../commissions/commission.service.js';
import { FinanceLedgerRepository } from './finance-ledger.repository.js';
import { FinanceRepository, type FinanceTransactionContext } from './finance.repository.js';

const BROKER_ROLES = new Set(['BROKER_MANAGER', 'BROKER_FINANCE', 'BROKER_AGENT']);

@Injectable()
export class FinanceService {
  constructor(
    private readonly repository: FinanceRepository,
    private readonly ledger: FinanceLedgerRepository,
    private readonly access: AccessService,
    private readonly commissions: CommissionService,
  ) {}

  async createPaymentSchedule(input: {
    actorUserId: string;
    data: CreatePaymentScheduleInput;
  }): Promise<{ scheduleId: string }> {
    const transaction = await this.requireTransaction(input.data.tenantId, input.data.projectId, input.data.transactionId);
    this.assertOpen(transaction);
    await this.assertWrite(input.actorUserId, input.data.tenantId, input.data.projectId, 'payment.schedule.manage');

    if (transaction.currency !== input.data.currency) {
      throw new BadRequestException('Payment schedule currency must match the reservation currency.');
    }
    if (transaction.quotedTotal !== null && this.moneyCents(transaction.quotedTotal) !== this.moneyCents(input.data.totalContractAmount)) {
      throw new BadRequestException('Total contract amount must match the frozen reservation price.');
    }
    const uniqueSequences = new Set(input.data.items.map((item) => item.sequenceNumber));
    if (uniqueSequences.size !== input.data.items.length) {
      throw new BadRequestException('Payment schedule sequence numbers must be unique.');
    }
    const itemTotal = input.data.items.reduce((sum, item) => sum + this.moneyCents(item.amount), 0n);
    if (itemTotal !== this.moneyCents(input.data.totalContractAmount)) {
      throw new BadRequestException('Payment schedule items must reconcile exactly to the total contract amount.');
    }
    if (!input.data.items.some((item) => item.itemType === 'DOWN_PAYMENT')) {
      throw new BadRequestException('Payment schedule must include at least one down-payment item.');
    }

    const result = await this.repository.createPaymentSchedule({ actorUserId: input.actorUserId, data: input.data, now: new Date() });
    await this.refreshCommission(input.data.tenantId, input.data.projectId, input.data.transactionId);
    return result;
  }

  async markPaymentItemPaid(input: {
    actorUserId: string;
    data: MarkPaymentItemPaidInput;
  }): Promise<{ paid: true }> {
    const transaction = await this.requireTransaction(input.data.tenantId, input.data.projectId, input.data.transactionId);
    this.assertOpen(transaction);
    await this.assertWrite(input.actorUserId, input.data.tenantId, input.data.projectId, 'payment.verify');

    const remaining = await this.ledger.remainingAmountForItem({
      tenantId: input.data.tenantId,
      projectId: input.data.projectId,
      transactionId: input.data.transactionId,
      paymentItemId: input.data.paymentItemId,
    });
    if (!remaining) throw new NotFoundException('Payment item not found.');
    if (this.moneyCents(remaining.remainingAmount) <= 0n) {
      throw new BadRequestException('Payment item is already fully settled.');
    }

    await this.ledger.postManualPayment({
      actorUserId: input.actorUserId,
      currency: remaining.currency,
      data: {
        tenantId: input.data.tenantId,
        projectId: input.data.projectId,
        transactionId: input.data.transactionId,
        amount: remaining.remainingAmount,
        paymentReference: input.data.paymentReference,
        allocations: [{ paymentItemId: input.data.paymentItemId, amount: remaining.remainingAmount }],
      },
    });
    await this.refreshCommission(input.data.tenantId, input.data.projectId, input.data.transactionId);
    return { paid: true };
  }

  async postManualPayment(input: {
    actorUserId: string;
    data: PostManualPaymentInput;
  }): Promise<{ paymentEventId: string }> {
    const transaction = await this.requireTransaction(input.data.tenantId, input.data.projectId, input.data.transactionId);
    this.assertOpen(transaction);
    await this.assertWrite(input.actorUserId, input.data.tenantId, input.data.projectId, 'payment.verify');

    const allocated = input.data.allocations.reduce((sum, allocation) => sum + this.moneyCents(allocation.amount), 0n);
    if (allocated > this.moneyCents(input.data.amount)) {
      throw new BadRequestException('Explicit allocations cannot exceed the payment amount.');
    }

    const result = await this.ledger.postManualPayment({
      actorUserId: input.actorUserId,
      currency: transaction.currency,
      data: input.data,
    });
    await this.refreshCommission(input.data.tenantId, input.data.projectId, input.data.transactionId);
    return result;
  }

  async compensatePayment(input: {
    actorUserId: string;
    data: CompensatePaymentInput;
  }): Promise<{ paymentEventId: string }> {
    const transaction = await this.requireTransaction(input.data.tenantId, input.data.projectId, input.data.transactionId);
    this.assertOpen(transaction);
    await this.assertWrite(input.actorUserId, input.data.tenantId, input.data.projectId, 'payment.verify');

    const result = await this.ledger.compensatePayment({ actorUserId: input.actorUserId, data: input.data });
    await this.refreshCommission(input.data.tenantId, input.data.projectId, input.data.transactionId);
    return result;
  }

  async ingestProvider(input: {
    provider: string;
    payloadSha256Hex: string;
    data: ProviderFinanceEventInput;
  }): Promise<{ paymentEventId: string }> {
    const transaction = await this.requireTransaction(input.data.tenantId, input.data.projectId, input.data.transactionId);
    if (transaction.currency !== input.data.currency) {
      throw new BadRequestException('Provider event currency must match the transaction currency.');
    }
    const result = await this.ledger.ingestProvider(input);
    await this.refreshCommission(input.data.tenantId, input.data.projectId, input.data.transactionId);
    return result;
  }

  async getPaymentSchedule(input: {
    actorUserId: string;
    tenantId: string;
    projectId: string;
    transactionId: string;
  }): Promise<PaymentScheduleSnapshot> {
    const transaction = await this.requireTransaction(input.tenantId, input.projectId, input.transactionId);
    await this.assertRead(input.actorUserId, transaction, 'payment.read', 'installment.read.self');
    const schedule = await this.ledger.getPaymentSchedule({
      tenantId: input.tenantId,
      projectId: input.projectId,
      transactionId: input.transactionId,
      now: new Date(),
    });
    if (!schedule) throw new NotFoundException('Payment schedule not found.');
    return schedule;
  }

  async getLedger(input: {
    actorUserId: string;
    tenantId: string;
    projectId: string;
    transactionId: string;
  }): Promise<FinanceLedgerSnapshot> {
    const transaction = await this.requireTransaction(input.tenantId, input.projectId, input.transactionId);
    await this.assertRead(input.actorUserId, transaction, 'payment.read', 'installment.read.self');
    return this.ledger.getLedger(input);
  }

  async createChequeSchedule(input: {
    actorUserId: string;
    data: CreateChequeScheduleInput;
  }): Promise<{ created: number }> {
    const transaction = await this.requireTransaction(input.data.tenantId, input.data.projectId, input.data.transactionId);
    this.assertOpen(transaction);
    await this.assertWrite(input.actorUserId, input.data.tenantId, input.data.projectId, 'payment.schedule.manage');
    const uniqueSequences = new Set(input.data.cheques.map((cheque) => cheque.sequenceNumber));
    if (uniqueSequences.size !== input.data.cheques.length) {
      throw new BadRequestException('Cheque sequence numbers must be unique.');
    }
    const result = await this.repository.createChequeSchedule({ actorUserId: input.actorUserId, data: input.data, now: new Date() });
    await this.refreshCommission(input.data.tenantId, input.data.projectId, input.data.transactionId);
    return result;
  }

  async updateChequeStatus(input: {
    actorUserId: string;
    data: UpdateChequeStatusInput;
  }): Promise<{ updated: true }> {
    const transaction = await this.requireTransaction(input.data.tenantId, input.data.projectId, input.data.transactionId);
    this.assertOpen(transaction);
    await this.assertWrite(input.actorUserId, input.data.tenantId, input.data.projectId, 'payment.verify');
    const result = await this.ledger.recordChequeStatus({ actorUserId: input.actorUserId, data: input.data });
    await this.refreshCommission(input.data.tenantId, input.data.projectId, input.data.transactionId);
    return result;
  }

  async replaceCheque(input: {
    actorUserId: string;
    data: ReplaceChequeInput;
  }): Promise<{ chequeId: string }> {
    const transaction = await this.requireTransaction(input.data.tenantId, input.data.projectId, input.data.transactionId);
    this.assertOpen(transaction);
    await this.assertWrite(input.actorUserId, input.data.tenantId, input.data.projectId, 'payment.verify');
    const result = await this.ledger.replaceCheque({ actorUserId: input.actorUserId, data: input.data });
    await this.refreshCommission(input.data.tenantId, input.data.projectId, input.data.transactionId);
    return result;
  }

  async listCheques(input: {
    actorUserId: string;
    tenantId: string;
    projectId: string;
    transactionId: string;
  }): Promise<ChequeSnapshot[]> {
    const transaction = await this.requireTransaction(input.tenantId, input.projectId, input.transactionId);
    await this.assertRead(input.actorUserId, transaction, 'payment.read', 'installment.read.self');
    return this.ledger.listCheques(input);
  }

  async getChequeHistory(input: {
    actorUserId: string;
    tenantId: string;
    projectId: string;
    transactionId: string;
    chequeId: string;
  }): Promise<ChequeHistorySnapshot> {
    const transaction = await this.requireTransaction(input.tenantId, input.projectId, input.transactionId);
    await this.assertRead(input.actorUserId, transaction, 'payment.read', 'installment.read.self');
    return this.ledger.getChequeHistory(input);
  }

  private async assertWrite(
    userId: string,
    tenantId: string,
    projectId: string,
    permission: PermissionCode,
  ): Promise<void> {
    await this.access.assert({ userId, permission, context: { tenantId, projectId } });
  }

  private async refreshCommission(tenantId: string, projectId: string, transactionId: string): Promise<void> {
    await this.commissions.refreshTransactionCase({ tenantId, projectId, transactionId });
  }

  private async requireTransaction(
    tenantId: string,
    projectId: string,
    transactionId: string,
  ): Promise<FinanceTransactionContext> {
    const transaction = await this.repository.getTransactionContext({ tenantId, projectId, transactionId });
    if (!transaction) throw new NotFoundException('Transaction not found.');
    return transaction;
  }

  private assertOpen(transaction: FinanceTransactionContext): void {
    if (transaction.status === 'CANCELLED' || transaction.status === 'COMPLETED') {
      throw new BadRequestException('Finance changes are not allowed on a closed transaction.');
    }
  }

  private async assertRead(
    actorUserId: string,
    transaction: FinanceTransactionContext,
    regularPermission: PermissionCode,
    selfPermission: PermissionCode,
  ): Promise<void> {
    const assignments = await this.access.matchingAssignments({
      userId: actorUserId,
      permission: regularPermission,
      context: { tenantId: transaction.tenantId, projectId: transaction.projectId },
    });

    if (assignments.some((assignment) => !BROKER_ROLES.has(assignment.role))) return;

    const matchingBroker = assignments.some((assignment) => {
      if (!BROKER_ROLES.has(assignment.role)) return false;
      if (!transaction.brokerCompanyId || assignment.brokerCompanyId !== transaction.brokerCompanyId) return false;
      return assignment.role !== 'BROKER_AGENT' || transaction.brokerAgentUserId === actorUserId;
    });
    if (matchingBroker) return;

    const self = await this.access.matchingAssignments({
      userId: actorUserId,
      permission: selfPermission,
      context: {
        tenantId: transaction.tenantId,
        projectId: transaction.projectId,
        resourceOwnerUserId: transaction.buyerUserId,
      },
    });
    if (self.length > 0) return;

    throw new ForbiddenException('You do not have permission to view finance for this transaction.');
  }

  private moneyCents(value: string): bigint {
    const [whole = '0', fraction = ''] = value.split('.');
    const cents = `${fraction}00`.slice(0, 2);
    return BigInt(whole) * 100n + BigInt(cents);
  }
}
