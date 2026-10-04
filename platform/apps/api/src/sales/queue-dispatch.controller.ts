import { BadRequestException, Controller, Param, Post, UseGuards } from '@nestjs/common';
import type { QueueEntrySnapshot } from '@preneura/contracts/sales';
import type { ResolvedSession } from '../auth/auth.repository.js';
import { CurrentSession, SessionAuthGuard } from '../auth/session-auth.guard.js';
import { QueueDispatchService } from './queue-dispatch.service.js';

@UseGuards(SessionAuthGuard)
@Controller('tenants/:tenantId/projects/:projectId/queue')
export class QueueDispatchController {
  constructor(private readonly dispatch: QueueDispatchService) {}

  @Post('call-next')
  callNext(
    @Param('tenantId') tenantId: string,
    @Param('projectId') projectId: string,
    @CurrentSession() session: ResolvedSession,
  ): Promise<QueueEntrySnapshot> {
    this.assertUuid(tenantId, 'tenantId');
    this.assertUuid(projectId, 'projectId');
    return this.dispatch.callNext({ actorUserId: session.userId, tenantId, projectId });
  }

  private assertUuid(value: string, field: string): void {
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!uuid.test(value)) throw new BadRequestException(`Invalid ${field}.`);
  }
}
