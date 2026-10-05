import { BadRequestException, Controller, Get, Param, UseGuards } from '@nestjs/common';
import type { TransactionPriceSnapshot } from '@preneura/contracts/pricing-quote';
import type { ResolvedSession } from '../auth/auth.repository.js';
import { CurrentSession, SessionAuthGuard } from '../auth/session-auth.guard.js';
import { TransactionPriceService } from './transaction-price.service.js';

@UseGuards(SessionAuthGuard)
@Controller('tenants/:tenantId/projects/:projectId/transactions/:transactionId')
export class TransactionPriceController {
  constructor(private readonly prices: TransactionPriceService) {}

  @Get('price-snapshot')
  getPriceSnapshot(
    @Param('tenantId') tenantId: string,
    @Param('projectId') projectId: string,
    @Param('transactionId') transactionId: string,
    @CurrentSession() session: ResolvedSession,
  ): Promise<TransactionPriceSnapshot> {
    this.assertUuid(tenantId, 'tenantId');
    this.assertUuid(projectId, 'projectId');
    this.assertUuid(transactionId, 'transactionId');
    return this.prices.getSnapshot({
      actorUserId: session.userId,
      tenantId,
      projectId,
      transactionId,
    });
  }

  private assertUuid(value: string, field: string): void {
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!uuid.test(value)) throw new BadRequestException(`Invalid ${field}.`);
  }
}
