import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  MessageEvent,
  Param,
  Post,
  Query,
  Sse,
  UseGuards,
} from '@nestjs/common';
import {
  upsertMilestoneSlaSchema,
  type MilestoneSlaSnapshot,
  type UserNotificationSnapshot,
} from '@preneura/contracts/notifications';
import type { ResolvedSession } from '../auth/auth.repository.js';
import { CurrentSession, SessionAuthGuard } from '../auth/session-auth.guard.js';
import { Observable } from 'rxjs';
import { NotificationService } from './notification.service.js';

@UseGuards(SessionAuthGuard)
@Controller('tenants/:tenantId/projects/:projectId/notification-slas')
export class NotificationSlaController {
  constructor(private readonly notifications: NotificationService) {}

  @Get()
  list(
    @Param('tenantId') tenantId: string,
    @Param('projectId') projectId: string,
    @CurrentSession() session: ResolvedSession,
  ): Promise<MilestoneSlaSnapshot[]> {
    this.assertUuid(tenantId, 'tenantId');
    this.assertUuid(projectId, 'projectId');
    return this.notifications.listMilestoneSlas({
      actorUserId: session.userId,
      tenantId,
      projectId,
    });
  }

  @Post()
  save(
    @Param('tenantId') tenantId: string,
    @Param('projectId') projectId: string,
    @Body() body: unknown,
    @CurrentSession() session: ResolvedSession,
  ): Promise<{ saved: true }> {
    const parsed = upsertMilestoneSlaSchema.safeParse({
      ...this.objectBody(body), tenantId, projectId,
    });
    if (!parsed.success) throw new BadRequestException('Invalid milestone SLA configuration.');
    return this.notifications.upsertMilestoneSla({ actorUserId: session.userId, data: parsed.data });
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

@UseGuards(SessionAuthGuard)
@Controller('me/notifications')
export class UserNotificationController {
  constructor(private readonly notifications: NotificationService) {}

  @Get()
  list(
    @Query('after') after: string | undefined,
    @Query('limit') rawLimit: string | undefined,
    @CurrentSession() session: ResolvedSession,
  ): Promise<UserNotificationSnapshot[]> {
    const limit = rawLimit === undefined ? 100 : Number(rawLimit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
      throw new BadRequestException('limit must be an integer between 1 and 200.');
    }
    return this.notifications.listUserNotifications({
      userId: session.userId,
      afterSequence: after ?? '0',
      limit,
    });
  }

  @Post(':notificationId/read')
  markRead(
    @Param('notificationId') notificationId: string,
    @CurrentSession() session: ResolvedSession,
  ): Promise<{ read: true }> {
    this.assertUuid(notificationId, 'notificationId');
    return this.notifications.markRead({ userId: session.userId, notificationId });
  }

  @Sse('events')
  events(
    @Headers('last-event-id') lastEventId: string | undefined,
    @Query('after') after: string | undefined,
    @CurrentSession() session: ResolvedSession,
  ): Observable<MessageEvent> {
    return this.notifications.streamUserNotifications({
      userId: session.userId,
      afterSequence: lastEventId ?? after ?? '0',
    });
  }

  private assertUuid(value: string, field: string): void {
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!uuid.test(value)) throw new BadRequestException(`Invalid ${field}.`);
  }
}
