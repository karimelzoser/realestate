import { BadRequestException, Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import {
  createSettlementSchema,
  submitSettlementSchema,
  type SettlementSnapshot,
  type SettlementSummarySnapshot,
} from '@preneura/contracts/settlements';
import type { ResolvedSession } from '../auth/auth.repository.js';
import { CurrentSession, SessionAuthGuard } from '../auth/session-auth.guard.js';
import { SettlementService } from './settlement.service.js';

@UseGuards(SessionAuthGuard)
@Controller('tenants/:tenantId/projects/:projectId')
export class SettlementController {
  constructor(private readonly settlements: SettlementService) {}

  @Get('refund-settlements')
  listRefundSettlements(
    @Param('tenantId') tenantId: string,
    @Param('projectId') projectId: string,
    @CurrentSession() session: ResolvedSession,
  ): Promise<SettlementSummarySnapshot[]> {
    this.assertUuid(tenantId, 'tenantId');
    this.assertUuid(projectId, 'projectId');
    return this.settlements.listRefundSettlements({ actorUserId: session.userId, tenantId, projectId });
  }

  @Get('brokers/:brokerCompanyId/commission-settlements')
  listCommissionSettlements(
    @Param('tenantId') tenantId: string,
    @Param('projectId') projectId: string,
    @Param('brokerCompanyId') brokerCompanyId: string,
    @CurrentSession() session: ResolvedSession,
  ): Promise<SettlementSummarySnapshot[]> {
    this.assertUuid(tenantId, 'tenantId');
    this.assertUuid(projectId, 'projectId');
    this.assertUuid(brokerCompanyId, 'brokerCompanyId');
    return this.settlements.listCommissionSettlements({
      actorUserId: session.userId,
      tenantId,
      projectId,
      brokerCompanyId,
    });
  }

  @Post('refunds/:refundRequestId/settlements')
  createRefund(
    @Param('tenantId') tenantId: string,
    @Param('projectId') projectId: string,
    @Param('refundRequestId') refundRequestId: string,
    @Body() body: unknown,
    @CurrentSession() session: ResolvedSession,
  ): Promise<SettlementSnapshot> {
    this.assertUuid(tenantId, 'tenantId');
    this.assertUuid(projectId, 'projectId');
    this.assertUuid(refundRequestId, 'refundRequestId');
    const parsed = createSettlementSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Invalid settlement request.');
    return this.settlements.createRefund({
      actorUserId: session.userId,
      tenantId,
      projectId,
      refundRequestId,
      data: parsed.data,
    });
  }

  @Post('brokers/:brokerCompanyId/commissions/:commissionCaseId/settlements')
  createCommission(
    @Param('tenantId') tenantId: string,
    @Param('projectId') projectId: string,
    @Param('brokerCompanyId') brokerCompanyId: string,
    @Param('commissionCaseId') commissionCaseId: string,
    @Body() body: unknown,
    @CurrentSession() session: ResolvedSession,
  ): Promise<SettlementSnapshot> {
    [tenantId, projectId, brokerCompanyId, commissionCaseId].forEach((value, index) =>
      this.assertUuid(value, ['tenantId','projectId','brokerCompanyId','commissionCaseId'][index] ?? 'id'),
    );
    const parsed = createSettlementSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Invalid settlement request.');
    return this.settlements.createCommission({
      actorUserId: session.userId,
      tenantId,
      projectId,
      brokerCompanyId,
      commissionCaseId,
      data: parsed.data,
    });
  }

  @Get('settlements/:settlementId')
  get(
    @Param('tenantId') tenantId: string,
    @Param('projectId') projectId: string,
    @Param('settlementId') settlementId: string,
    @CurrentSession() session: ResolvedSession,
  ): Promise<SettlementSnapshot> {
    this.assertUuid(tenantId, 'tenantId');
    this.assertUuid(projectId, 'projectId');
    this.assertUuid(settlementId, 'settlementId');
    return this.settlements.get({ actorUserId: session.userId, tenantId, projectId, settlementId });
  }

  @Post('settlements/:settlementId/submit')
  submit(
    @Param('tenantId') tenantId: string,
    @Param('projectId') projectId: string,
    @Param('settlementId') settlementId: string,
    @Body() body: unknown,
    @CurrentSession() session: ResolvedSession,
  ): Promise<SettlementSnapshot> {
    this.assertUuid(tenantId, 'tenantId');
    this.assertUuid(projectId, 'projectId');
    this.assertUuid(settlementId, 'settlementId');
    const parsed = submitSettlementSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Invalid settlement submission.');
    return this.settlements.submit({
      actorUserId: session.userId,
      tenantId,
      projectId,
      settlementId,
      data: parsed.data,
    });
  }

  private assertUuid(value: string, field: string): void {
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!uuid.test(value)) throw new BadRequestException(`Invalid ${field}.`);
  }
}
