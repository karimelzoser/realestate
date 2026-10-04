import { BadRequestException, Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import {
  createChequeScheduleSchema,
  createPaymentScheduleSchema,
  markPaymentItemPaidSchema,
  updateChequeStatusSchema,
  type ChequeSnapshot,
  type PaymentScheduleSnapshot,
} from '@preneura/contracts/finance';
import type { ResolvedSession } from '../auth/auth.repository.js';
import { CurrentSession, SessionAuthGuard } from '../auth/session-auth.guard.js';
import { FinanceService } from './finance.service.js';

@UseGuards(SessionAuthGuard)
@Controller('tenants/:tenantId/projects/:projectId/transactions/:transactionId/finance')
export class FinanceController {
  constructor(private readonly finance: FinanceService) {}

  @Post('payment-schedule')
  createPaymentSchedule(
    @Param('tenantId') tenantId: string,
    @Param('projectId') projectId: string,
    @Param('transactionId') transactionId: string,
    @Body() body: unknown,
    @CurrentSession() session: ResolvedSession,
  ): Promise<{ scheduleId: string }> {
    const parsed = createPaymentScheduleSchema.safeParse({
      ...this.objectBody(body), tenantId, projectId, transactionId,
    });
    if (!parsed.success) throw new BadRequestException('Invalid payment schedule.');
    return this.finance.createPaymentSchedule({ actorUserId: session.userId, data: parsed.data });
  }

  @Get('payment-schedule')
  getPaymentSchedule(
    @Param('tenantId') tenantId: string,
    @Param('projectId') projectId: string,
    @Param('transactionId') transactionId: string,
    @CurrentSession() session: ResolvedSession,
  ): Promise<PaymentScheduleSnapshot> {
    this.assertUuid(tenantId, 'tenantId');
    this.assertUuid(projectId, 'projectId');
    this.assertUuid(transactionId, 'transactionId');
    return this.finance.getPaymentSchedule({ actorUserId: session.userId, tenantId, projectId, transactionId });
  }

  @Post('payments/:paymentItemId/mark-paid')
  markPaymentPaid(
    @Param('tenantId') tenantId: string,
    @Param('projectId') projectId: string,
    @Param('transactionId') transactionId: string,
    @Param('paymentItemId') paymentItemId: string,
    @Body() body: unknown,
    @CurrentSession() session: ResolvedSession,
  ): Promise<{ paid: true }> {
    const parsed = markPaymentItemPaidSchema.safeParse({
      ...this.objectBody(body), tenantId, projectId, transactionId, paymentItemId,
    });
    if (!parsed.success) throw new BadRequestException('Invalid payment verification request.');
    return this.finance.markPaymentItemPaid({ actorUserId: session.userId, data: parsed.data });
  }

  @Post('cheques')
  createCheques(
    @Param('tenantId') tenantId: string,
    @Param('projectId') projectId: string,
    @Param('transactionId') transactionId: string,
    @Body() body: unknown,
    @CurrentSession() session: ResolvedSession,
  ): Promise<{ created: number }> {
    const parsed = createChequeScheduleSchema.safeParse({
      ...this.objectBody(body), tenantId, projectId, transactionId,
    });
    if (!parsed.success) throw new BadRequestException('Invalid cheque schedule.');
    return this.finance.createChequeSchedule({ actorUserId: session.userId, data: parsed.data });
  }

  @Get('cheques')
  listCheques(
    @Param('tenantId') tenantId: string,
    @Param('projectId') projectId: string,
    @Param('transactionId') transactionId: string,
    @CurrentSession() session: ResolvedSession,
  ): Promise<ChequeSnapshot[]> {
    this.assertUuid(tenantId, 'tenantId');
    this.assertUuid(projectId, 'projectId');
    this.assertUuid(transactionId, 'transactionId');
    return this.finance.listCheques({ actorUserId: session.userId, tenantId, projectId, transactionId });
  }

  @Post('cheques/:chequeId/status')
  updateCheque(
    @Param('tenantId') tenantId: string,
    @Param('projectId') projectId: string,
    @Param('transactionId') transactionId: string,
    @Param('chequeId') chequeId: string,
    @Body() body: unknown,
    @CurrentSession() session: ResolvedSession,
  ): Promise<{ updated: true }> {
    const parsed = updateChequeStatusSchema.safeParse({
      ...this.objectBody(body), tenantId, projectId, transactionId, chequeId,
    });
    if (!parsed.success) throw new BadRequestException('Invalid cheque status update.');
    return this.finance.updateChequeStatus({ actorUserId: session.userId, data: parsed.data });
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
