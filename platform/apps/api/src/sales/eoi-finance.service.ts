import { Injectable } from '@nestjs/common';
import type { PayEoiRefundInput } from '@preneura/contracts/sales';
import { AccessService } from '../access/access.service.js';
import { EoiFinanceRepository } from './eoi-finance.repository.js';

@Injectable()
export class EoiFinanceService {
  constructor(
    private readonly repository: EoiFinanceRepository,
    private readonly access: AccessService,
  ) {}

  async postPayment(input: {
    actorUserId: string;
    tenantId: string;
    projectId: string;
    eoiId: string;
    paymentReference: string;
  }): Promise<{ paid: true; financeEventId: string }> {
    await this.access.assert({
      userId: input.actorUserId,
      permission: 'payment.verify',
      context: { tenantId: input.tenantId, projectId: input.projectId },
    });

    const result = await this.repository.postPayment({
      tenantId: input.tenantId,
      projectId: input.projectId,
      eoiId: input.eoiId,
      externalReference: input.paymentReference,
      actorUserId: input.actorUserId,
      occurredAt: new Date(),
    });
    return { paid: true, financeEventId: result.financeEventId };
  }

  async payRefund(input: {
    actorUserId: string;
    data: PayEoiRefundInput;
  }): Promise<{ paid: true; financeEventId: string; payoutReference: string }> {
    await this.access.assert({
      userId: input.actorUserId,
      permission: 'refund.payment.manage',
      context: { tenantId: input.data.tenantId, projectId: input.data.projectId },
    });

    const result = await this.repository.payRefund({
      tenantId: input.data.tenantId,
      projectId: input.data.projectId,
      refundRequestId: input.data.refundRequestId,
      payoutReference: input.data.payoutReference,
      actorUserId: input.actorUserId,
      occurredAt: new Date(),
    });
    return { paid: true, ...result };
  }

  payoutEvidence(input: {
    tenantId: string;
    projectId: string;
    refundRequestIds: readonly string[];
  }) {
    return this.repository.payoutEvidence(input);
  }
}
