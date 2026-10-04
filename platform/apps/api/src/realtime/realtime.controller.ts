import {
  BadRequestException,
  Controller,
  Headers,
  MessageEvent,
  Query,
  Sse,
  Param,
  UseGuards,
} from '@nestjs/common';
import type { ResolvedSession } from '../auth/auth.repository.js';
import { CurrentSession, SessionAuthGuard } from '../auth/session-auth.guard.js';
import { Observable } from 'rxjs';
import { RealtimeService } from './realtime.service.js';

@UseGuards(SessionAuthGuard)
@Controller('tenants/:tenantId/projects/:projectId')
export class RealtimeController {
  constructor(private readonly realtime: RealtimeService) {}

  @Sse('events')
  projectEvents(
    @Param('tenantId') tenantId: string,
    @Param('projectId') projectId: string,
    @Headers('last-event-id') lastEventId: string | undefined,
    @Query('after') after: string | undefined,
    @CurrentSession() session: ResolvedSession,
  ): Promise<Observable<MessageEvent>> {
    this.assertUuid(tenantId, 'tenantId');
    this.assertUuid(projectId, 'projectId');
    return this.realtime.projectStream({
      userId: session.userId,
      tenantId,
      projectId,
      afterSequence: lastEventId ?? after ?? '0',
    });
  }

  @Sse('brokers/:brokerCompanyId/events')
  brokerCommissionEvents(
    @Param('tenantId') tenantId: string,
    @Param('projectId') projectId: string,
    @Param('brokerCompanyId') brokerCompanyId: string,
    @Headers('last-event-id') lastEventId: string | undefined,
    @Query('after') after: string | undefined,
    @CurrentSession() session: ResolvedSession,
  ): Promise<Observable<MessageEvent>> {
    this.assertUuid(tenantId, 'tenantId');
    this.assertUuid(projectId, 'projectId');
    this.assertUuid(brokerCompanyId, 'brokerCompanyId');
    return this.realtime.brokerCommissionStream({
      userId: session.userId,
      tenantId,
      projectId,
      brokerCompanyId,
      afterSequence: lastEventId ?? after ?? '0',
    });
  }

  private assertUuid(value: string, field: string): void {
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!uuid.test(value)) throw new BadRequestException(`Invalid ${field}.`);
  }
}
