import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type {
  EoiRefundQuote,
  RequestEoiRefundInput,
  ReviewEoiRefundInput,
} from '@preneura/contracts/sales';
import { AccessService } from '../access/access.service.js';
import { EoiRefundRepository } from './eoi-refund.repository.js';

@Injectable()
export class EoiRefundService {
  constructor(
    private readonly repository: EoiRefundRepository,
    private readonly access: AccessService,
  ) {}

  async quote(input: {
    actorUserId: string;
    tenantId: string;
    projectId: string;
    eoiId: string;
  }): Promise<EoiRefundQuote> {
    const quote = await this.repository.quote(input);
    if (!quote) throw new NotFoundException('Refundable EOI not found.');

    const staffRead = await this.access.can({
      userId: input.actorUserId,
      permission: 'refund.read',
      context: { tenantId: input.tenantId, projectId: input.projectId },
    });
    if (!staffRead.allowed) {
      const requestDecision = await this.access.assert({
        userId: input.actorUserId,
        permission: 'refund.request',
        context: { tenantId: input.tenantId, projectId: input.projectId },
      });
      if (requestDecision.role === 'BUYER' && quote.buyerUserId !== input.actorUserId) {
        throw new ForbiddenException('Buyers can only view their own refund quote.');
      }
    }

    return this.publicQuote(quote);
  }

  async request(input: {
    actorUserId: string;
    data: RequestEoiRefundInput;
  }): Promise<{ refundRequestId: string; quote: EoiRefundQuote }> {
    const quote = await this.repository.quote({
      tenantId: input.data.tenantId,
      projectId: input.data.projectId,
      eoiId: input.data.eoiId,
    });
    if (!quote) throw new NotFoundException('Refundable EOI not found.');

    const decision = await this.access.assert({
      userId: input.actorUserId,
      permission: 'refund.request',
      context: { tenantId: input.data.tenantId, projectId: input.data.projectId },
    });
    if (decision.role === 'BUYER' && quote.buyerUserId !== input.actorUserId) {
      throw new ForbiddenException('Buyers can only request their own refund.');
    }

    return this.repository.request({
      tenantId: input.data.tenantId,
      projectId: input.data.projectId,
      eoiId: input.data.eoiId,
      actorUserId: input.actorUserId,
      now: new Date(),
    });
  }

  async review(input: {
    actorUserId: string;
    data: ReviewEoiRefundInput;
  }): Promise<{ status: 'APPROVED' | 'REJECTED'; requestedAmount: string; currency: string }> {
    await this.access.assert({
      userId: input.actorUserId,
      permission: 'refund.approve',
      context: { tenantId: input.data.tenantId, projectId: input.data.projectId },
    });

    return this.repository.review({
      tenantId: input.data.tenantId,
      projectId: input.data.projectId,
      refundRequestId: input.data.refundRequestId,
      actorUserId: input.actorUserId,
      decision: input.data.decision,
      note: input.data.note ?? null,
      now: new Date(),
    });
  }

  private publicQuote(
    quote: EoiRefundQuote & { buyerUserId: string; eoiStatus: 'PAID' | 'APPLIED' },
  ): EoiRefundQuote {
    return {
      eoiId: quote.eoiId,
      buyerProfileId: quote.buyerProfileId,
      stage: quote.stage,
      originalAmount: quote.originalAmount,
      refundPercent: quote.refundPercent,
      processingFee: quote.processingFee,
      refundableAmount: quote.refundableAmount,
      currency: quote.currency,
      policyId: quote.policyId,
    };
  }
}
