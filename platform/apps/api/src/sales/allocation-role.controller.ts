import { BadRequestException, Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import {
  createAssignedAllocationLockSchema,
  type AllocationSessionSnapshot,
  type AssignedAllocationLockSnapshot,
} from '@preneura/contracts/allocation';
import type { ResolvedSession } from '../auth/auth.repository.js';
import { CurrentSession, SessionAuthGuard } from '../auth/session-auth.guard.js';
import { AllocationRoleService } from './allocation-role.service.js';

@UseGuards(SessionAuthGuard)
@Controller('tenants/:tenantId/projects/:projectId/allocation')
export class AllocationRoleController {
  constructor(private readonly allocation: AllocationRoleService) {}

  @Get('session')
  current(
    @Param('tenantId') tenantId: string,
    @Param('projectId') projectId: string,
    @CurrentSession() session: ResolvedSession,
  ): Promise<AllocationSessionSnapshot | null> {
    this.assertUuid(tenantId, 'tenantId');
    this.assertUuid(projectId, 'projectId');
    return this.allocation.current({ actorUserId: session.userId, tenantId, projectId });
  }

  @Post('claim-next')
  claimNext(
    @Param('tenantId') tenantId: string,
    @Param('projectId') projectId: string,
    @CurrentSession() session: ResolvedSession,
  ): Promise<AllocationSessionSnapshot> {
    this.assertUuid(tenantId, 'tenantId');
    this.assertUuid(projectId, 'projectId');
    return this.allocation.claimNext({ actorUserId: session.userId, tenantId, projectId });
  }

  @Post('locks')
  createLock(
    @Param('tenantId') tenantId: string,
    @Param('projectId') projectId: string,
    @Body() body: unknown,
    @CurrentSession() session: ResolvedSession,
  ): Promise<AssignedAllocationLockSnapshot> {
    const parsed = createAssignedAllocationLockSchema.safeParse({
      ...(body && typeof body === 'object' && !Array.isArray(body) ? body : {}),
      tenantId,
      projectId,
    });
    if (!parsed.success) throw new BadRequestException('Invalid assigned allocation lock request.');
    return this.allocation.createLock({ actorUserId: session.userId, data: parsed.data });
  }

  private assertUuid(value: string, field: string): void {
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!uuid.test(value)) throw new BadRequestException(`Invalid ${field}.`);
  }
}
