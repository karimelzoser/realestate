import { BadRequestException, Controller, Get, Param, UseGuards } from '@nestjs/common';
import type { ContractExecutionSnapshot } from '@preneura/contracts/contract-execution';
import type { ResolvedSession } from '../auth/auth.repository.js';
import { CurrentSession, SessionAuthGuard } from '../auth/session-auth.guard.js';
import { ContractExecutionService } from './contract-execution.service.js';

@UseGuards(SessionAuthGuard)
@Controller('tenants/:tenantId/projects/:projectId/transactions/:transactionId/contract-execution')
export class ContractExecutionController {
  constructor(private readonly execution: ContractExecutionService) {}

  @Get()
  getSnapshot(
    @Param('tenantId') tenantId: string,
    @Param('projectId') projectId: string,
    @Param('transactionId') transactionId: string,
    @CurrentSession() session: ResolvedSession,
  ): Promise<ContractExecutionSnapshot | null> {
    this.assertUuid(tenantId, 'tenantId');
    this.assertUuid(projectId, 'projectId');
    this.assertUuid(transactionId, 'transactionId');
    return this.execution.getSnapshot({
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
