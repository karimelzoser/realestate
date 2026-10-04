import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { PermissionCode } from '@preneura/contracts/access';
import type {
  CheckInQueueInput,
  CompleteTransactionMilestoneInput,
  ConvertLockToReservationInput,
  CreateBuyerEoiInput,
  CreateBuyerProfileInput,
  CreateEoiRefundPolicyInput,
  MarkEoiPaidInput,
  QueueEntrySnapshot,
  ReservationResult,
  TransactionMilestoneCode,
  TransactionProgressSnapshot,
} from '@preneura/contracts/sales';
import { AccessService } from '../access/access.service.js';
import { SalesRepository } from './sales.repository.js';

const MILESTONE_PERMISSION: Readonly<Record<TransactionMilestoneCode, PermissionCode>> = {
  BUYER_DOCUMENTS_COMPLETE: 'documents.verify',
  DOWN_PAYMENT_RECEIVED: 'payment.verify',
  CHEQUES_RECEIVED: 'payment.verify',
  CONTRACT_GENERATED: 'contract.generate',
  CONTRACT_SIGNED: 'contract.execute',
  CONTRACT_STAMPED: 'contract.execute',
};

@Injectable()
export class SalesService {
  constructor(
    private readonly repository: SalesRepository,
    private readonly access: AccessService,
  ) {}

  async createBuyerProfile(input: {
    actorUserId: string;
    data: CreateBuyerProfileInput;
  }): Promise<{ buyerProfileId: string }> {
    await this.requireProject(input.data.tenantId, input.data.projectId);

    if (input.actorUserId === input.data.userId) {
      if (input.data.source !== 'DIRECT' || input.data.brokerCompanyId || input.data.brokerAgentUserId) {
        throw new ForbiddenException('Buyers cannot self-assign broker attribution.');
      }
      await this.access.assert({
        userId: input.actorUserId,
        permission: 'buyers.manage.self',
        context: {
          tenantId: input.data.tenantId,
          projectId: input.data.projectId,
          resourceOwnerUserId: input.data.userId,
        },
      });
    } else if (input.data.source === 'BROKER') {
      if (!input.data.brokerCompanyId) throw new BadRequestException('Broker company is required.');
      const decision = await this.access.assert({
        userId: input.actorUserId,
        permission: 'broker.buyers.manage',
        context: {
          tenantId: input.data.tenantId,
          projectId: input.data.projectId,
          brokerCompanyId: input.data.brokerCompanyId,
        },
      });
      if (decision.role === 'BROKER_AGENT' && input.data.brokerAgentUserId !== input.actorUserId) {
        throw new ForbiddenException('Broker agents may only attribute buyers to themselves.');
      }
    } else {
      await this.access.assert({
        userId: input.actorUserId,
        permission: 'buyers.manage',
        context: { tenantId: input.data.tenantId, projectId: input.data.projectId },
      });
    }

    const buyerProfileId = await this.repository.createBuyerProfile(input);
    return { buyerProfileId };
  }

  async createRefundPolicy(input: {
    actorUserId: string;
    data: CreateEoiRefundPolicyInput;
  }): Promise<{ refundPolicyId: string; versionNumber: number }> {
    await this.requireProject(input.data.tenantId, input.data.projectId);
    await this.access.assert({
      userId: input.actorUserId,
      permission: 'project.manage',
      context: { tenantId: input.data.tenantId, projectId: input.data.projectId },
    });

    const now = new Date();
    if (new Date(input.data.effectiveAt).getTime() > now.getTime()) {
      throw new BadRequestException(
        'This endpoint publishes an immediately effective refund policy. Scheduled policy activation will use the workflow scheduler.',
      );
    }

    const created = await this.repository.createActiveRefundPolicy({
      actorUserId: input.actorUserId,
      data: input.data,
      now,
    });
    return { refundPolicyId: created.id, versionNumber: created.versionNumber };
  }

  async createEoi(input: {
    actorUserId: string;
    data: CreateBuyerEoiInput;
  }): Promise<{ eoiId: string; amount: string; currency: string }> {
    await this.requireProject(input.data.tenantId, input.data.projectId);
    const buyer = await this.requireBuyer(input.data.tenantId, input.data.buyerProfileId);

    if (buyer.userId === input.actorUserId) {
      await this.access.assert({
        userId: input.actorUserId,
        permission: 'eoi.manage.self',
        context: {
          tenantId: input.data.tenantId,
          projectId: input.data.projectId,
          resourceOwnerUserId: buyer.userId,
        },
      });
    } else {
      await this.access.assert({
        userId: input.actorUserId,
        permission: 'eoi.manage',
        context: { tenantId: input.data.tenantId, projectId: input.data.projectId },
      });
    }

    return this.repository.createEoi({
      actorUserId: input.actorUserId,
      tenantId: input.data.tenantId,
      projectId: input.data.projectId,
      buyerProfileId: input.data.buyerProfileId,
      now: new Date(),
    });
  }

  async markEoiPaid(input: {
    actorUserId: string;
    data: MarkEoiPaidInput;
  }): Promise<{ paid: true }> {
    await this.requireProject(input.data.tenantId, input.data.projectId);
    await this.access.assert({
      userId: input.actorUserId,
      permission: 'payment.verify',
      context: { tenantId: input.data.tenantId, projectId: input.data.projectId },
    });
    const paid = await this.repository.markEoiPaid({
      actorUserId: input.actorUserId,
      tenantId: input.data.tenantId,
      projectId: input.data.projectId,
      eoiId: input.data.eoiId,
      paymentReference: input.data.paymentReference,
      now: new Date(),
    });
    if (!paid) throw new NotFoundException('Pending EOI payment not found.');
    return { paid: true };
  }

  async checkInQueue(input: {
    actorUserId: string;
    data: CheckInQueueInput;
  }): Promise<{ queueEntryId: string }> {
    await this.requireProject(input.data.tenantId, input.data.projectId);
    await this.requireBuyer(input.data.tenantId, input.data.buyerProfileId);
    await this.access.assert({
      userId: input.actorUserId,
      permission: 'queue.checkin',
      context: { tenantId: input.data.tenantId, projectId: input.data.projectId },
    });
    return this.repository.checkInQueue({ actorUserId: input.actorUserId, data: input.data, now: new Date() });
  }

  async listQueue(input: {
    actorUserId: string;
    tenantId: string;
    projectId: string;
  }): Promise<QueueEntrySnapshot[]> {
    await this.requireProject(input.tenantId, input.projectId);
    await this.access.assert({
      userId: input.actorUserId,
      permission: 'queue.read',
      context: { tenantId: input.tenantId, projectId: input.projectId },
    });
    return this.repository.listQueue(input);
  }

  async convertLockToReservation(input: {
    actorUserId: string;
    data: ConvertLockToReservationInput;
  }): Promise<ReservationResult> {
    await this.requireProject(input.data.tenantId, input.data.projectId);
    await this.access.assert({
      userId: input.actorUserId,
      permission: 'allocation.assist',
      context: { tenantId: input.data.tenantId, projectId: input.data.projectId },
    });
    await this.access.assert({
      userId: input.actorUserId,
      permission: 'unit.lock',
      context: { tenantId: input.data.tenantId, projectId: input.data.projectId },
    });

    return this.repository.convertLockToReservation({
      actorUserId: input.actorUserId,
      tenantId: input.data.tenantId,
      projectId: input.data.projectId,
      buyerProfileId: input.data.buyerProfileId,
      queueEntryId: input.data.queueEntryId,
      lockId: input.data.lockId,
      now: new Date(),
    });
  }

  async completeMilestone(input: {
    actorUserId: string;
    data: CompleteTransactionMilestoneInput;
  }): Promise<{ completed: true }> {
    await this.requireProject(input.data.tenantId, input.data.projectId);
    const permission = MILESTONE_PERMISSION[input.data.milestoneCode];
    await this.access.assert({
      userId: input.actorUserId,
      permission,
      context: { tenantId: input.data.tenantId, projectId: input.data.projectId },
    });

    const completed = await this.repository.completeMilestone({
      actorUserId: input.actorUserId,
      tenantId: input.data.tenantId,
      projectId: input.data.projectId,
      transactionId: input.data.transactionId,
      milestoneCode: input.data.milestoneCode,
      evidenceDocumentId: input.data.evidenceDocumentId ?? null,
      now: new Date(),
    });
    if (!completed) throw new NotFoundException('Pending transaction milestone not found.');
    return { completed: true };
  }

  async getTransactionProgress(input: {
    actorUserId: string;
    tenantId: string;
    projectId: string;
    transactionId: string;
  }): Promise<TransactionProgressSnapshot> {
    await this.requireProject(input.tenantId, input.projectId);
    const progress = await this.repository.getTransactionProgress(input);
    if (!progress) throw new NotFoundException('Transaction not found.');
    const buyer = await this.requireBuyer(input.tenantId, progress.buyerProfileId);

    const regular = await this.access.can({
      userId: input.actorUserId,
      permission: 'transaction.read',
      context: { tenantId: input.tenantId, projectId: input.projectId },
    });
    if (!regular.allowed) {
      await this.access.assert({
        userId: input.actorUserId,
        permission: 'transaction.read.self',
        context: {
          tenantId: input.tenantId,
          projectId: input.projectId,
          resourceOwnerUserId: buyer.userId,
        },
      });
    }
    return progress;
  }

  private async requireProject(tenantId: string, projectId: string): Promise<void> {
    if (!(await this.repository.projectExists(tenantId, projectId))) {
      throw new NotFoundException('Project not found.');
    }
  }

  private async requireBuyer(tenantId: string, buyerProfileId: string) {
    const buyer = await this.repository.getBuyerProfile({ tenantId, buyerProfileId });
    if (!buyer) throw new NotFoundException('Buyer profile not found.');
    return buyer;
  }
}
