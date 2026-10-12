import { BadRequestException, Body, Controller, Get, Param, Post, Put, UseGuards } from '@nestjs/common';
import {
  brokerageAgreementInputSchema,
  brokerageAttributionReviewInputSchema,
  brokerageAttributionTransferInputSchema,
  brokerageOrganizationInputSchema,
  brokerageProjectAccessInputSchema,
  type BrokerageOnboardingSnapshot,
} from '@preneura/contracts/brokerage-onboarding';
import type { ResolvedSession } from '../auth/auth.repository.js';
import { CurrentSession, SessionAuthGuard } from '../auth/session-auth.guard.js';
import { BrokerageOnboardingService } from './brokerage-onboarding.service.js';

@UseGuards(SessionAuthGuard)
@Controller('tenants/:tenantId/brokerages')
export class BrokerageOnboardingController {
  constructor(private readonly brokerage: BrokerageOnboardingService) {}

  @Get()
  workspace(
    @Param('tenantId') tenantId: string,
    @CurrentSession() session: ResolvedSession,
  ): Promise<BrokerageOnboardingSnapshot> {
    this.assertUuid(tenantId, 'tenantId');
    return this.brokerage.workspace(session.userId, tenantId);
  }

  @Post('organizations')
  createOrLinkOrganization(
    @Param('tenantId') tenantId: string,
    @Body() body: unknown,
    @CurrentSession() session: ResolvedSession,
  ): Promise<BrokerageOnboardingSnapshot> {
    this.assertUuid(tenantId, 'tenantId');
    const parsed = brokerageOrganizationInputSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Invalid brokerage organization configuration.');
    return this.brokerage.upsertOrganization({ actorUserId: session.userId, tenantId, data: parsed.data });
  }

  @Post('agreements')
  createAgreement(
    @Param('tenantId') tenantId: string,
    @Body() body: unknown,
    @CurrentSession() session: ResolvedSession,
  ): Promise<{ agreementId: string; onboarding: BrokerageOnboardingSnapshot }> {
    this.assertUuid(tenantId, 'tenantId');
    const parsed = brokerageAgreementInputSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Invalid brokerage agreement configuration.');
    return this.brokerage.createAgreement({ actorUserId: session.userId, tenantId, data: parsed.data });
  }

  @Post('agreements/:agreementId/activate')
  activateAgreement(
    @Param('tenantId') tenantId: string,
    @Param('agreementId') agreementId: string,
    @CurrentSession() session: ResolvedSession,
  ): Promise<BrokerageOnboardingSnapshot> {
    this.assertUuid(tenantId, 'tenantId');
    this.assertUuid(agreementId, 'agreementId');
    return this.brokerage.activateAgreement({ actorUserId: session.userId, tenantId, agreementId });
  }

  @Put('agreements/:agreementId/projects/:projectId')
  setProjectAccess(
    @Param('tenantId') tenantId: string,
    @Param('agreementId') agreementId: string,
    @Param('projectId') projectId: string,
    @Body() body: unknown,
    @CurrentSession() session: ResolvedSession,
  ): Promise<BrokerageOnboardingSnapshot> {
    this.assertUuid(tenantId, 'tenantId');
    this.assertUuid(agreementId, 'agreementId');
    this.assertUuid(projectId, 'projectId');
    const parsed = brokerageProjectAccessInputSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Invalid brokerage project access configuration.');
    return this.brokerage.setProjectAccess({
      actorUserId: session.userId, tenantId, agreementId, projectId, data: parsed.data,
    });
  }

  @Post('attribution-transfers')
  requestAttributionTransfer(
    @Param('tenantId') tenantId: string,
    @Body() body: unknown,
    @CurrentSession() session: ResolvedSession,
  ): Promise<{ transferId: string }> {
    this.assertUuid(tenantId, 'tenantId');
    const parsed = brokerageAttributionTransferInputSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Invalid buyer attribution transfer request.');
    return this.brokerage.requestTransfer({ actorUserId: session.userId, tenantId, data: parsed.data });
  }

  @Post('attribution-transfers/:transferId/review')
  reviewAttributionTransfer(
    @Param('tenantId') tenantId: string,
    @Param('transferId') transferId: string,
    @Body() body: unknown,
    @CurrentSession() session: ResolvedSession,
  ): Promise<BrokerageOnboardingSnapshot> {
    this.assertUuid(tenantId, 'tenantId');
    this.assertUuid(transferId, 'transferId');
    const parsed = brokerageAttributionReviewInputSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Invalid attribution transfer decision.');
    return this.brokerage.reviewTransfer({
      actorUserId: session.userId, tenantId, transferId, data: parsed.data,
    });
  }

  private assertUuid(value: string, field: string): void {
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!uuid.test(value)) throw new BadRequestException(`Invalid ${field}.`);
  }
}
