import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  createProjectSchema,
  createTenantSchema,
  startSupportAccessSchema,
  updateProjectStatusSchema,
  updateTenantStatusSchema,
  type PlatformControlPlaneSnapshot,
  type PlatformProjectSnapshot,
  type SupportAccessSessionSnapshot,
} from '@preneura/contracts/platform-admin';
import type { ResolvedSession } from '../auth/auth.repository.js';
import { CurrentSession, SessionAuthGuard } from '../auth/session-auth.guard.js';
import { PlatformAdminService } from './platform-admin.service.js';

@UseGuards(SessionAuthGuard)
@Controller('platform')
export class PlatformAdminController {
  constructor(private readonly admin: PlatformAdminService) {}

  @Get('control-plane')
  snapshot(@CurrentSession() session: ResolvedSession): Promise<PlatformControlPlaneSnapshot> {
    return this.admin.snapshot(session.userId);
  }

  @Get('tenants/:tenantId/projects')
  projects(
    @Param('tenantId') tenantId: string,
    @CurrentSession() session: ResolvedSession,
  ): Promise<PlatformProjectSnapshot[]> {
    this.assertUuid(tenantId, 'tenantId');
    return this.admin.projects(session.userId, tenantId);
  }

  @Post('tenants')
  createTenant(
    @Body() body: unknown,
    @CurrentSession() session: ResolvedSession,
  ): Promise<{ tenantId: string }> {
    const parsed = createTenantSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Invalid tenant configuration.');
    return this.admin.createTenant(session.userId, parsed.data);
  }

  @Post('tenants/:tenantId/status')
  setTenantStatus(
    @Param('tenantId') tenantId: string,
    @Body() body: unknown,
    @CurrentSession() session: ResolvedSession,
  ): Promise<{ updated: true }> {
    this.assertUuid(tenantId, 'tenantId');
    const parsed = updateTenantStatusSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Invalid tenant status.');
    return this.admin.setTenantStatus(session.userId, tenantId, parsed.data.status);
  }

  @Post('tenants/:tenantId/projects')
  createProject(
    @Param('tenantId') tenantId: string,
    @Body() body: unknown,
    @CurrentSession() session: ResolvedSession,
  ): Promise<{ projectId: string }> {
    this.assertUuid(tenantId, 'tenantId');
    const parsed = createProjectSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Invalid project configuration.');
    return this.admin.createProject(session.userId, tenantId, parsed.data);
  }

  @Post('tenants/:tenantId/projects/:projectId/status')
  setProjectStatus(
    @Param('tenantId') tenantId: string,
    @Param('projectId') projectId: string,
    @Body() body: unknown,
    @CurrentSession() session: ResolvedSession,
  ): Promise<{ updated: true }> {
    this.assertUuid(tenantId, 'tenantId');
    this.assertUuid(projectId, 'projectId');
    const parsed = updateProjectStatusSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Invalid project status.');
    return this.admin.setProjectStatus(session.userId, tenantId, projectId, parsed.data.status);
  }

  @Get('support-access')
  supportSessions(@CurrentSession() session: ResolvedSession): Promise<SupportAccessSessionSnapshot[]> {
    return this.admin.supportSessions(session.userId);
  }

  @Post('support-access')
  startSupportSession(
    @Body() body: unknown,
    @CurrentSession() session: ResolvedSession,
  ): Promise<SupportAccessSessionSnapshot> {
    const parsed = startSupportAccessSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Invalid support access request.');
    return this.admin.startSupportSession(session.userId, parsed.data);
  }

  @Post('support-access/:sessionId/end')
  endSupportSession(
    @Param('sessionId') sessionId: string,
    @CurrentSession() session: ResolvedSession,
  ): Promise<{ ended: true }> {
    this.assertUuid(sessionId, 'sessionId');
    return this.admin.endSupportSession(session.userId, sessionId);
  }

  private assertUuid(value: string, field: string): void {
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!uuid.test(value)) throw new BadRequestException(`Invalid ${field}.`);
  }
}
