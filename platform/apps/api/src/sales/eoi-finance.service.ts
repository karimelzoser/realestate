import { Injectable } from '@nestjs/common';
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

  async reversePayment(input: {
    actorUserId: string;
    tenantId: string;
    projectId: string;
    eoiId: string;
    reversalReference: string;
  }): Promise<{ reversed: true; financeEventId: string }> {
    await this.access.assert({
      userId: input.actorUserId,
      permission: 'payment.verify',
      context: { tenantId: input.tenantId, projectId: input.projectId },
    });

    const result = await this.repository.reversePayment({
      tenantId: input.tenantId,
      projectId: input.projectId,
      eoiId: input.eoiId,
      externalReference: input.reversalReference,
      actorUserId: input.actorUserId,
      occurredAt: new Date(),
    });
    return { reversed: true, financeEventId: result.financeEventId };
  }
}
