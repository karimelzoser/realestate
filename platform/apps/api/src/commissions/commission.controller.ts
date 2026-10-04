import { BadRequestException, Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import {
  createCommissionPlanSchema,
  updateCommissionCaseStatusSchema,
  type CommissionCaseSnapshot,
} from '@preneura/contracts/commissions';
import type { ResolvedSession } from '../auth/auth.repository.js';
import { CurrentSession, SessionAuthGuard } from '../auth/session-auth.guard.js';
import { CommissionService } from './commission.service.js';

@UseGuards(SessionAuthGuard)
@Controller('tenants/:tenantId/projects/:projectId/brokers/:brokerCompanyId')
export class CommissionController {
  constructor(private readonly commissions: CommissionService) {}

  @Post('commission-plans')
  createPlan(
    @Param('tenantId') tenantId: string,
    @Param('projectId') projectId: string,
    @Param('brokerCompanyId') brokerCompanyId: string,
    @Body() body: unknown,
    @CurrentSession() session: ResolvedSession,
  ): Promise<{ commissionPlanId: string; versionNumber: number }> {
    const parsed = createCommissionPlanSchema.safeParse({
      ...this.objectBody(body),
      tenantId,
      projectId,
      brokerCompanyId,
    });
    if (!parsed.success) throw new BadRequestException('Invalid commission plan.');
    return this.commissions.createPlan({ actorUserId: session.userId, data: parsed.data });
  }

  @Get('commissions')
  listCases(
    @Param('tenantId') tenantId: string,
    @Param('projectId') projectId: string,
    @Param('brokerCompanyId') brokerCompanyId: string,
    @CurrentSession() session: ResolvedSession,
  ): Promise<CommissionCaseSnapshot[]> {
    this.assertUuid(tenantId, 'tenantId');
    this.assertUuid(projectId, 'projectId');
    this.assertUuid(brokerCompanyId, 'brokerCompanyId');
    return this.commissions.listCases({
      actorUserId: session.userId,
      tenantId,
      projectId,
      brokerCompanyId,
    });
  }

  @Post('commissions/:commissionCaseId/status')
  updateCaseStatus(
    @Param('tenantId') tenantId: string,
    @Param('projectId') projectId: string,
    @Param('brokerCompanyId') brokerCompanyId: string,
    @Param('commissionCaseId') commissionCaseId: string,
    @Body() body: unknown,
    @CurrentSession() session: ResolvedSession,
  ): Promise<{ updated: true }> {
    const parsed = updateCommissionCaseStatusSchema.safeParse({
      ...this.objectBody(body),
      tenantId,
      projectId,
      brokerCompanyId,
      commissionCaseId,
    });
    if (!parsed.success) throw new BadRequestException('Invalid commission status update.');
    return this.commissions.updateCaseStatus({ actorUserId: session.userId, data: parsed.data });
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
