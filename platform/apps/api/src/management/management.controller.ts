import { BadRequestException, Controller, Get, Param, UseGuards } from '@nestjs/common';
import type { ManagementProjectOverviewSnapshot } from '@preneura/contracts/management';
import type { ResolvedSession } from '../auth/auth.repository.js';
import { CurrentSession, SessionAuthGuard } from '../auth/session-auth.guard.js';
import { ManagementService } from './management.service.js';

@UseGuards(SessionAuthGuard)
@Controller('tenants/:tenantId/projects/:projectId/management')
export class ManagementController {
  constructor(private readonly management: ManagementService) {}

  @Get('overview')
  overview(
    @Param('tenantId') tenantId: string,
    @Param('projectId') projectId: string,
    @CurrentSession() session: ResolvedSession,
  ): Promise<ManagementProjectOverviewSnapshot> {
    this.assertUuid(tenantId, 'tenantId');
    this.assertUuid(projectId, 'projectId');
    return this.management.overview({
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
