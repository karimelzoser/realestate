import { BadRequestException, Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import {
  createAssignedAllocationLockSchema,
  createExactApartmentQuoteSchema,
  eligibleApartmentFilterSchema,
  type AllocationSessionSnapshot,
  type AssignedAllocationLockSnapshot,
  type ExactApartmentQuoteSnapshot,
  type EligibleApartmentPage,
  type EligibleApartmentStructure,
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

  @Get('apartments')
  apartments(
    @Param('tenantId') tenantId: string, @Param('projectId') projectId: string,
    @Query() query: unknown, @CurrentSession() session: ResolvedSession,
  ): Promise<EligibleApartmentPage> {
    this.assertUuid(tenantId, 'tenantId'); this.assertUuid(projectId, 'projectId');
    const parsed=eligibleApartmentFilterSchema.safeParse(query ?? {});
    if (!parsed.success) throw new BadRequestException('Invalid apartment filter or cursor.');
    return this.allocation.apartments({ actorUserId: session.userId, tenantId, projectId, filters: parsed.data });
  }
  @Get('hierarchy')
  structure(@Param('tenantId') tenantId:string,@Param('projectId') projectId:string,@CurrentSession() session:ResolvedSession): Promise<EligibleApartmentStructure> {
    this.assertUuid(tenantId,'tenantId');this.assertUuid(projectId,'projectId');
    return this.allocation.structure({actorUserId:session.userId,tenantId,projectId});
  }

  @Post('quotes')
  createQuote(
    @Param('tenantId') tenantId: string, @Param('projectId') projectId: string,
    @Body() body: unknown, @CurrentSession() session: ResolvedSession,
  ): Promise<ExactApartmentQuoteSnapshot> {
    const parsed=createExactApartmentQuoteSchema.safeParse({
      ...(body && typeof body==='object' && !Array.isArray(body) ? body : {}), tenantId, projectId,
    });
    if (!parsed.success) throw new BadRequestException('Invalid exact apartment quote request.');
    return this.allocation.createQuote({ actorUserId: session.userId, data: parsed.data });
  }

  @Get('quotes/:quoteId')
  quote(
    @Param('tenantId') tenantId: string, @Param('projectId') projectId: string, @Param('quoteId') quoteId: string,
    @CurrentSession() session: ResolvedSession,
  ): Promise<ExactApartmentQuoteSnapshot> {
    this.assertUuid(tenantId,'tenantId'); this.assertUuid(projectId,'projectId'); this.assertUuid(quoteId,'quoteId');
    return this.allocation.quote({ actorUserId: session.userId, tenantId, projectId, quoteId });
  }

  private assertUuid(value: string, field: string): void {
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!uuid.test(value)) throw new BadRequestException(`Invalid ${field}.`);
  }
}
