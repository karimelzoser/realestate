import { BadRequestException, Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import {
  exactAllocationLockSchema,
  type ExactAllocationContextSnapshot,
  type ExactAllocationLockResult,
} from '@preneura/contracts/allocation';
import type { ResolvedSession } from '../auth/auth.repository.js';
import { CurrentSession, SessionAuthGuard } from '../auth/session-auth.guard.js';
import { ExactAllocationService } from './exact-allocation.service.js';

@UseGuards(SessionAuthGuard)
@Controller('tenants/:tenantId/projects/:projectId/queue/:queueEntryId/allocation')
export class ExactAllocationController {
  constructor(private readonly allocation: ExactAllocationService) {}

  @Get()
  context(
    @Param('tenantId') tenantId: string,
    @Param('projectId') projectId: string,
    @Param('queueEntryId') queueEntryId: string,
    @CurrentSession() session: ResolvedSession,
  ): Promise<ExactAllocationContextSnapshot> {
    this.assertUuid(tenantId, 'tenantId');
    this.assertUuid(projectId, 'projectId');
    this.assertUuid(queueEntryId, 'queueEntryId');
    return this.allocation.context({
      actorUserId: session.userId,
      tenantId,
      projectId,
      queueEntryId,
    });
  }

  @Post('lock')
  lock(
    @Param('tenantId') tenantId: string,
    @Param('projectId') projectId: string,
    @Param('queueEntryId') queueEntryId: string,
    @Body() body: unknown,
    @CurrentSession() session: ResolvedSession,
  ): Promise<ExactAllocationLockResult> {
    const parsed = exactAllocationLockSchema.safeParse({
      ...this.objectBody(body),
      tenantId,
      projectId,
      queueEntryId,
    });
    if (!parsed.success) throw new BadRequestException('Invalid exact-unit lock request.');
    return this.allocation.lock({ actorUserId: session.userId, data: parsed.data });
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
