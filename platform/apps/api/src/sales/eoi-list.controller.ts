import { BadRequestException, Controller, Get, Param, UseGuards } from '@nestjs/common';
import type { EoiListItemSnapshot } from '@preneura/contracts/sales';
import type { ResolvedSession } from '../auth/auth.repository.js';
import { CurrentSession, SessionAuthGuard } from '../auth/session-auth.guard.js';
import { EoiListService } from './eoi-list.service.js';

@UseGuards(SessionAuthGuard)
@Controller('tenants/:tenantId/projects/:projectId/eois')
export class EoiListController {
  constructor(private readonly eois: EoiListService) {}

  @Get()
  list(
    @Param('tenantId') tenantId: string,
    @Param('projectId') projectId: string,
    @CurrentSession() session: ResolvedSession,
  ): Promise<EoiListItemSnapshot[]> {
    this.assertUuid(tenantId, 'tenantId');
    this.assertUuid(projectId, 'projectId');
    return this.eois.list({ actorUserId: session.userId, tenantId, projectId });
  }

  private assertUuid(value: string, field: string): void {
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!uuid.test(value)) throw new BadRequestException(`Invalid ${field}.`);
  }
}
