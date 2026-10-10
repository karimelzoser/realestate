import { BadRequestException, Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import {
  inviteProjectBuyerSchema,
  type InvitedProjectBuyerSnapshot,
  type ProjectBuyerSnapshot,
} from '@preneura/contracts/sales';
import type { ResolvedSession } from '../auth/auth.repository.js';
import { CurrentSession, SessionAuthGuard } from '../auth/session-auth.guard.js';
import { SalesBuyerListService } from './sales-buyer-list.service.js';
import { SalesBuyerOnboardingService } from './sales-buyer-onboarding.service.js';

@UseGuards(SessionAuthGuard)
@Controller('tenants/:tenantId/projects/:projectId/buyers')
export class SalesBuyerController {
  constructor(
    private readonly listService: SalesBuyerListService,
    private readonly onboarding: SalesBuyerOnboardingService,
  ) {}

  @Get()
  list(
    @Param('tenantId') tenantId: string,
    @Param('projectId') projectId: string,
    @CurrentSession() session: ResolvedSession,
  ): Promise<ProjectBuyerSnapshot[]> {
    this.assertUuid(tenantId, 'tenantId');
    this.assertUuid(projectId, 'projectId');
    return this.listService.list({ actorUserId: session.userId, tenantId, projectId });
  }

  @Post('invite')
  invite(
    @Param('tenantId') tenantId: string,
    @Param('projectId') projectId: string,
    @Body() body: unknown,
    @CurrentSession() session: ResolvedSession,
  ): Promise<InvitedProjectBuyerSnapshot> {
    const parsed = inviteProjectBuyerSchema.safeParse({
      ...this.objectBody(body),
      tenantId,
      projectId,
    });
    if (!parsed.success) throw new BadRequestException('Invalid buyer invitation.');
    return this.onboarding.invite({ actorUserId: session.userId, data: parsed.data });
  }

  private objectBody(body: unknown): Record<string, unknown> {
    return body && typeof body === 'object' && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : {};
  }

  private assertUuid(value: string, field: string): void {
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!uuid.test(value)) throw new BadRequestException(`Invalid ${field}.`);
  }
}
