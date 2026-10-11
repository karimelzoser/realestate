import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import {
  bootstrapOperationsDirectorSchema,
  projectBrandingInputSchema,
  tenantBrandingInputSchema,
  type DeveloperOnboardingSnapshot,
} from '@preneura/contracts/onboarding';
import type { ProvisionedAccountSnapshot } from '@preneura/contracts/accounts';
import type { ResolvedSession } from '../auth/auth.repository.js';
import { CurrentSession, SessionAuthGuard } from '../auth/session-auth.guard.js';
import { OnboardingService } from './onboarding.service.js';

@UseGuards(SessionAuthGuard)
@Controller('tenants/:tenantId/onboarding')
export class OnboardingController {
  constructor(private readonly onboarding: OnboardingService) {}

  @Get()
  snapshot(
    @Param('tenantId') tenantId: string,
    @CurrentSession() session: ResolvedSession,
  ): Promise<DeveloperOnboardingSnapshot> {
    this.assertUuid(tenantId, 'tenantId');
    return this.onboarding.snapshot(session.userId, tenantId);
  }

  @Put('branding')
  updateTenantBranding(
    @Param('tenantId') tenantId: string,
    @Body() body: unknown,
    @CurrentSession() session: ResolvedSession,
  ): Promise<DeveloperOnboardingSnapshot> {
    this.assertUuid(tenantId, 'tenantId');
    const parsed = tenantBrandingInputSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Invalid developer branding configuration.');
    return this.onboarding.updateTenantBranding(session.userId, tenantId, parsed.data);
  }

  @Put('projects/:projectId/branding')
  updateProjectBranding(
    @Param('tenantId') tenantId: string,
    @Param('projectId') projectId: string,
    @Body() body: unknown,
    @CurrentSession() session: ResolvedSession,
  ): Promise<DeveloperOnboardingSnapshot> {
    this.assertUuid(tenantId, 'tenantId');
    this.assertUuid(projectId, 'projectId');
    const parsed = projectBrandingInputSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Invalid project branding configuration.');
    return this.onboarding.updateProjectBranding(session.userId, tenantId, projectId, parsed.data);
  }

  @Post('bootstrap-operations-director')
  bootstrapOperationsDirector(
    @Param('tenantId') tenantId: string,
    @Body() body: unknown,
    @CurrentSession() session: ResolvedSession,
  ): Promise<ProvisionedAccountSnapshot & { verificationDispatched: boolean }> {
    this.assertUuid(tenantId, 'tenantId');
    const parsed = bootstrapOperationsDirectorSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Invalid Operations Director invitation.');
    return this.onboarding.bootstrapOperationsDirector(session.userId, tenantId, parsed.data);
  }

  @Post('complete')
  complete(
    @Param('tenantId') tenantId: string,
    @CurrentSession() session: ResolvedSession,
  ): Promise<DeveloperOnboardingSnapshot> {
    this.assertUuid(tenantId, 'tenantId');
    return this.onboarding.complete(session.userId, tenantId);
  }

  private assertUuid(value: string, field: string): void {
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!uuid.test(value)) throw new BadRequestException(`Invalid ${field}.`);
  }
}
