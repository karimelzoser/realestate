import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { PermissionCode } from '@preneura/contracts/access';
import type {
  ChequeSnapshot,
  CreateChequeScheduleInput,
  CreatePaymentScheduleInput,
  MarkPaymentItemPaidInput,
  PaymentScheduleSnapshot,
  UpdateChequeStatusInput,
} from '@preneura/contracts/finance';
import { AccessService } from '../access/access.service.js';
import { CommissionService } from '../commissions/commission.service.js';
import { FinanceRepository, type FinanceTransactionContext } from './finance.repository.js';

const BROKER_ROLES = new Set(['BROKER_MANAGER', 'BROKER_FINANCE', 'BROKER_AGENT']);

@Injectable()
export class FinanceService {
  constructor(
    private readonly repository: FinanceRepository,
    private readonly access: AccessService,
    private readonly commissions: CommissionService,
  ) {}

  async createPaymentSchedule(input: {
    actorUserId: string;
    data: CreatePaymentScheduleInput;
  }): Promise<{ scheduleId: string }> {
    const transaction = await this.requireTransaction(input.data.tenantId, input.data.projectId, input.data.transactionId);
    this.assertOpen(transaction);
    await this.access.assert({
      userId: input.actorUserId,
      permission: 'payment.schedule.manage',
      context: { tenantId: input.data.tenantId, projectId: input.data.projectId },
    });

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
    await this.access.assert({
      userId: input.actorUserId,
      permission: 'payment.verify',
      context: { tenantId: input.data.tenantId, projectId: input.data.projectId },
    });
    const updated = await this.repository.markPaymentItemPaid({
      actorUserId: input.actorUserId,
      tenantId: input.data.tenantId,
      projectId: input.data.projectId,
      transactionId: input.data.transactionId,
      paymentItemId: input.data.paymentItemId,
      paymentReference: input.data.paymentReference,
      now: new Date(),
    });
    if (!updated) throw new NotFoundException('Payment item not found.');
    await this.refreshCommission(input.data.tenantId, input.data.projectId, input.data.transactionId);
    return { paid: true };
  }

  async getPaymentSchedule(input: {
    actorUserId: string;
    tenantId: string;
    projectId: string;
    transactionId: string;
  }): Promise<PaymentScheduleSnapshot> {
    const transaction = await this.requireTransaction(input.tenantId, input.projectId, input.transactionId);
    await this.assertRead(input.actorUserId, transaction, 'payment.read', 'installment.read.self');
    const schedule = await this.repository.getPaymentSchedule({
      tenantId: input.tenantId,
      projectId: input.projectId,
      transactionId: input.transactionId,
      now: new Date(),
    });
    if (!schedule) throw new NotFoundException('Payment schedule not found.');
    return schedule;
  }

  async createChequeSchedule(input: {
    actorUserId: string;
    data: CreateChequeScheduleInput;
  }): Promise<{ created: number }> {
    const transaction = await this.requireTransaction(input.data.tenantId, input.data.projectId, input.data.transactionId);
    this.assertOpen(transaction);
    await this.access.assert({
      userId: input.actorUserId,
      permission: 'payment.schedule.manage',
      context: { tenantId: input.data.tenantId, projectId: input.data.projectId },
    });
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
    await this.access.assert({
      userId: input.actorUserId,
      permission: 'payment.verify',
      context: { tenantId: input.data.tenantId, projectId: input.data.projectId },
    });
    const updated = await this.repository.updateChequeStatus({
      actorUserId: input.actorUserId,
      tenantId: input.data.tenantId,
      projectId: input.data.projectId,
      transactionId: input.data.transactionId,
      chequeId: input.data.chequeId,
      status: input.data.status,
      chequeNumber: input.data.chequeNumber ?? null,
      bankName: input.data.bankName ?? null,
      now: new Date(),
    });
    if (!updated) throw new NotFoundException('Cheque not found.');
    await this.refreshCommission(input.data.tenantId, input.data.projectId, input.data.transactionId);
    return { updated: true };
  }

  async listCheques(input: {
    actorUserId: string;
    tenantId: string;
    projectId: string;
    transactionId: string;
  }): Promise<ChequeSnapshot[]> {
    const transaction = await this.requireTransaction(input.tenantId, input.projectId, input.transactionId);
    await this.assertRead(input.actorUserId, transaction, 'payment.read', 'installment.read.self');
    return this.repository.listCheques(input);
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
