import { BadRequestException, Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import {
  checkInQueueSchema,
  completeTransactionMilestoneSchema,
  convertLockToReservationSchema,
  createBuyerEoiSchema,
  createBuyerProfileSchema,
  createEoiRefundPolicySchema,
  markEoiPaidSchema,
  type QueueEntrySnapshot,
  type ReservationResult,
  type TransactionProgressSnapshot,
} from '@preneura/contracts/sales';
import type { ResolvedSession } from '../auth/auth.repository.js';
import { CurrentSession, SessionAuthGuard } from '../auth/session-auth.guard.js';
import { SalesService } from './sales.service.js';

@UseGuards(SessionAuthGuard)
@Controller('tenants/:tenantId/projects/:projectId')
export class SalesController {
  constructor(private readonly sales: SalesService) {}

  @Post('buyers')
  createBuyer(
    @Param('tenantId') tenantId: string,
    @Param('projectId') projectId: string,
    @Body() body: unknown,
    @CurrentSession() session: ResolvedSession,
  ): Promise<{ buyerProfileId: string }> {
    const parsed = createBuyerProfileSchema.safeParse({ ...this.objectBody(body), tenantId, projectId });
    if (!parsed.success) throw new BadRequestException('Invalid buyer profile data.');
    return this.sales.createBuyerProfile({ actorUserId: session.userId, data: parsed.data });
  }

  @Post('eoi-refund-policies')
  createRefundPolicy(
    @Param('tenantId') tenantId: string,
    @Param('projectId') projectId: string,
    @Body() body: unknown,
    @CurrentSession() session: ResolvedSession,
  ): Promise<{ refundPolicyId: string; versionNumber: number }> {
    const parsed = createEoiRefundPolicySchema.safeParse({ ...this.objectBody(body), tenantId, projectId });
    if (!parsed.success) throw new BadRequestException('Invalid EOI refund policy data.');
    return this.sales.createRefundPolicy({ actorUserId: session.userId, data: parsed.data });
  }

  @Post('buyers/:buyerProfileId/eois')
  createEoi(
    @Param('tenantId') tenantId: string,
    @Param('projectId') projectId: string,
    @Param('buyerProfileId') buyerProfileId: string,
    @CurrentSession() session: ResolvedSession,
  ): Promise<{ eoiId: string; amount: string; currency: string }> {
    const parsed = createBuyerEoiSchema.safeParse({ tenantId, projectId, buyerProfileId });
    if (!parsed.success) throw new BadRequestException('Invalid EOI request.');
    return this.sales.createEoi({ actorUserId: session.userId, data: parsed.data });
  }

  @Post('eois/:eoiId/mark-paid')
  markEoiPaid(
    @Param('tenantId') tenantId: string,
    @Param('projectId') projectId: string,
    @Param('eoiId') eoiId: string,
    @Body() body: unknown,
    @CurrentSession() session: ResolvedSession,
  ): Promise<{ paid: true }> {
    const parsed = markEoiPaidSchema.safeParse({ ...this.objectBody(body), tenantId, projectId, eoiId });
    if (!parsed.success) throw new BadRequestException('Invalid EOI payment verification.');
    return this.sales.markEoiPaid({ actorUserId: session.userId, data: parsed.data });
  }

  @Post('queue/check-in')
  checkIn(
    @Param('tenantId') tenantId: string,
    @Param('projectId') projectId: string,
    @Body() body: unknown,
    @CurrentSession() session: ResolvedSession,
  ): Promise<{ queueEntryId: string }> {
    const parsed = checkInQueueSchema.safeParse({ ...this.objectBody(body), tenantId, projectId });
    if (!parsed.success) throw new BadRequestException('Invalid queue check-in data.');
    return this.sales.checkInQueue({ actorUserId: session.userId, data: parsed.data });
  }

  @Get('queue')
  listQueue(
    @Param('tenantId') tenantId: string,
    @Param('projectId') projectId: string,
    @CurrentSession() session: ResolvedSession,
  ): Promise<QueueEntrySnapshot[]> {
    this.assertUuid(tenantId, 'tenantId');
    this.assertUuid(projectId, 'projectId');
    return this.sales.listQueue({ actorUserId: session.userId, tenantId, projectId });
  }

  @Post('reservations/from-lock')
  reserveFromLock(
    @Param('tenantId') tenantId: string,
    @Param('projectId') projectId: string,
    @Body() body: unknown,
    @CurrentSession() session: ResolvedSession,
  ): Promise<ReservationResult> {
    const parsed = convertLockToReservationSchema.safeParse({ ...this.objectBody(body), tenantId, projectId });
    if (!parsed.success) throw new BadRequestException('Invalid reservation request.');
    return this.sales.convertLockToReservation({ actorUserId: session.userId, data: parsed.data });
  }

  @Post('transactions/:transactionId/milestones/:milestoneCode/complete')
  completeMilestone(
    @Param('tenantId') tenantId: string,
    @Param('projectId') projectId: string,
    @Param('transactionId') transactionId: string,
    @Param('milestoneCode') milestoneCode: string,
    @Body() body: unknown,
    @CurrentSession() session: ResolvedSession,
  ): Promise<{ completed: true }> {
    const parsed = completeTransactionMilestoneSchema.safeParse({
      ...this.objectBody(body),
      tenantId,
      projectId,
      transactionId,
      milestoneCode,
    });
    if (!parsed.success) throw new BadRequestException('Invalid transaction milestone request.');
    return this.sales.completeMilestone({ actorUserId: session.userId, data: parsed.data });
  }

  @Get('transactions/:transactionId/progress')
  transactionProgress(
    @Param('tenantId') tenantId: string,
    @Param('projectId') projectId: string,
    @Param('transactionId') transactionId: string,
    @CurrentSession() session: ResolvedSession,
  ): Promise<TransactionProgressSnapshot> {
    this.assertUuid(tenantId, 'tenantId');
    this.assertUuid(projectId, 'projectId');
    this.assertUuid(transactionId, 'transactionId');
    return this.sales.getTransactionProgress({
      actorUserId: session.userId,
      tenantId,
      projectId,
      transactionId,
    });
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
