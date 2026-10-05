import { BadRequestException, Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import {
  upsertMilestoneReminderPolicySchema,
  type MilestoneReminderPolicySnapshot,
} from '@preneura/contracts/notifications';
import type { ResolvedSession } from '../auth/auth.repository.js';
import { CurrentSession, SessionAuthGuard } from '../auth/session-auth.guard.js';
import { MilestoneReminderService } from './milestone-reminder.service.js';

@UseGuards(SessionAuthGuard)
@Controller('tenants/:tenantId/projects/:projectId/milestone-reminder-policies')
export class MilestoneReminderController {
  constructor(private readonly reminders: MilestoneReminderService) {}

  @Get()
  list(
    @Param('tenantId') tenantId: string,
    @Param('projectId') projectId: string,
    @CurrentSession() session: ResolvedSession,
  ): Promise<MilestoneReminderPolicySnapshot[]> {
    this.assertUuid(tenantId, 'tenantId');
    this.assertUuid(projectId, 'projectId');
    return this.reminders.list({ actorUserId: session.userId, tenantId, projectId });
  }

  @Post()
  save(
    @Param('tenantId') tenantId: string,
    @Param('projectId') projectId: string,
    @Body() body: unknown,
    @CurrentSession() session: ResolvedSession,
  ): Promise<MilestoneReminderPolicySnapshot> {
    const parsed = upsertMilestoneReminderPolicySchema.safeParse({
      ...this.objectBody(body),
      tenantId,
      projectId,
    });
    if (!parsed.success) throw new BadRequestException('Invalid milestone reminder policy.');
    return this.reminders.upsert({ actorUserId: session.userId, data: parsed.data });
  }

  private objectBody(body: unknown): Record<string, unknown> {
    return body && typeof body === 'object' && !Array.isArray(body)
      ? body as Record<string, unknown>
      : {};
  }

  private assertUuid(value: string, field: string): void {
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!uuid.test(value)) throw new BadRequestException(`Invalid ${field}.`);
  }
}
