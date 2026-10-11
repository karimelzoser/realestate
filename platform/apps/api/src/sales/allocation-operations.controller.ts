import { BadRequestException, Controller, Get, Param, UseGuards } from '@nestjs/common';
import type { AllocationQueueEntrySnapshot } from '@preneura/contracts/allocation';
import type { ResolvedSession } from '../auth/auth.repository.js';
import { CurrentSession, SessionAuthGuard } from '../auth/session-auth.guard.js';
import { AllocationOperationsService } from './allocation-operations.service.js';

@UseGuards(SessionAuthGuard)
@Controller('tenants/:tenantId/projects/:projectId/allocation')
export class AllocationOperationsController {
  constructor(private readonly operations: AllocationOperationsService) {}

  @Get('queue')
  listQueue(
    @Param('tenantId') tenantId: string,
    @Param('projectId') projectId: string,
    @CurrentSession() session: ResolvedSession,
  ): Promise<AllocationQueueEntrySnapshot[]> {
    this.assertUuid(tenantId, 'tenantId');
    this.assertUuid(projectId, 'projectId');
    return this.operations.listQueue({
      actorUserId: session.userId,
      tenantId,
      projectId,
    });
  }

  private assertUuid(value: string, field: string): void {
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!uuid.test(value)) throw new BadRequestException(`Invalid ${field}.`);
  }
}
