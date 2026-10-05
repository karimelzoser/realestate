import { BadRequestException, Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import {
  requestEoiRefundSchema,
  reviewEoiRefundSchema,
  type EoiRefundQuote,
  type EoiRefundRequestSnapshot,
} from '@preneura/contracts/sales';
import type { ResolvedSession } from '../auth/auth.repository.js';
import { CurrentSession, SessionAuthGuard } from '../auth/session-auth.guard.js';
import { EoiRefundService } from './eoi-refund.service.js';

@UseGuards(SessionAuthGuard)
@Controller('tenants/:tenantId/projects/:projectId')
export class EoiRefundController {
  constructor(private readonly refunds: EoiRefundService) {}

  @Get('refund-requests')
  list(
    @Param('tenantId') tenantId: string,
    @Param('projectId') projectId: string,
    @CurrentSession() session: ResolvedSession,
  ): Promise<EoiRefundRequestSnapshot[]> {
    this.assertUuid(tenantId, 'tenantId');
    this.assertUuid(projectId, 'projectId');
    return this.refunds.list({ actorUserId: session.userId, tenantId, projectId });
  }

  @Get('eois/:eoiId/refund-quote')
  quote(
    @Param('tenantId') tenantId: string,
    @Param('projectId') projectId: string,
    @Param('eoiId') eoiId: string,
    @CurrentSession() session: ResolvedSession,
  ): Promise<EoiRefundQuote> {
    this.assertUuid(tenantId, 'tenantId');
    this.assertUuid(projectId, 'projectId');
    this.assertUuid(eoiId, 'eoiId');
    return this.refunds.quote({ actorUserId: session.userId, tenantId, projectId, eoiId });
  }

  @Post('eois/:eoiId/refund-requests')
  request(
    @Param('tenantId') tenantId: string,
    @Param('projectId') projectId: string,
    @Param('eoiId') eoiId: string,
    @CurrentSession() session: ResolvedSession,
  ) {
    const parsed = requestEoiRefundSchema.safeParse({ tenantId, projectId, eoiId });
    if (!parsed.success) throw new BadRequestException('Invalid refund request.');
    return this.refunds.request({ actorUserId: session.userId, data: parsed.data });
  }

  @Post('refund-requests/:refundRequestId/review')
  review(
    @Param('tenantId') tenantId: string,
    @Param('projectId') projectId: string,
    @Param('refundRequestId') refundRequestId: string,
    @Body() body: unknown,
    @CurrentSession() session: ResolvedSession,
  ) {
    const parsed = reviewEoiRefundSchema.safeParse({
      ...this.objectBody(body),
      tenantId,
      projectId,
      refundRequestId,
    });
    if (!parsed.success) throw new BadRequestException('Invalid refund review.');
    return this.refunds.review({ actorUserId: session.userId, data: parsed.data });
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
