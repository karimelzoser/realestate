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
  accountProvisionSchema,
  accountStatusSchema,
  grantAccountRoleSchema,
  verifyEnrollmentSchema,
  type AccountAdminScopeSnapshot,
  type AccountSnapshot,
  type ProvisionedAccountSnapshot,
} from '@preneura/contracts/accounts';
import type { ResolvedSession } from '../auth/auth.repository.js';
import { CurrentSession, SessionAuthGuard } from '../auth/session-auth.guard.js';
import { AccountService } from './account.service.js';

@UseGuards(SessionAuthGuard)
@Controller('tenants/:tenantId')
export class AccountAdminController {
  constructor(private readonly accounts: AccountService) {}

  @Get('account-admin/scopes')
  scopes(
    @Param('tenantId') tenantId: string,
    @CurrentSession() session: ResolvedSession,
  ): Promise<AccountAdminScopeSnapshot> {
    this.assertUuid(tenantId, 'tenantId');
    return this.accounts.scopes({ actorUserId: session.userId, tenantId });
  }

  @Get('accounts')
  list(
    @Param('tenantId') tenantId: string,
    @CurrentSession() session: ResolvedSession,
  ): Promise<AccountSnapshot[]> {
    this.assertUuid(tenantId, 'tenantId');
    return this.accounts.list({ actorUserId: session.userId, tenantId });
  }

  @Post('accounts')
  provision(
    @Param('tenantId') tenantId: string,
    @Body() body: unknown,
    @CurrentSession() session: ResolvedSession,
  ): Promise<ProvisionedAccountSnapshot & { verificationDispatched: boolean }> {
    const parsed = accountProvisionSchema.safeParse({ ...this.objectBody(body), tenantId });
    if (!parsed.success) throw new BadRequestException('Invalid account provisioning request.');
    return this.accounts.provision({ actorUserId: session.userId, data: parsed.data });
  }

  @Post('accounts/:userId/verification/resend')
  resendVerification(
    @Param('tenantId') tenantId: string,
    @Param('userId') userId: string,
    @Body() body: unknown,
    @CurrentSession() session: ResolvedSession,
  ): Promise<{ sent: boolean }> {
    this.assertUuid(tenantId, 'tenantId');
    this.assertUuid(userId, 'userId');
    const channel = this.objectBody(body).channel;
    if (channel !== 'WHATSAPP' && channel !== 'SMS') {
      throw new BadRequestException('channel must be WHATSAPP or SMS.');
    }
    return this.accounts.resendVerification({
      actorUserId: session.userId,
      tenantId,
      userId,
      channel,
    });
  }

  @Post('accounts/:userId/roles')
  grantRole(
    @Param('tenantId') tenantId: string,
    @Param('userId') userId: string,
    @Body() body: unknown,
    @CurrentSession() session: ResolvedSession,
  ): Promise<{ assignmentId: string }> {
    const parsed = grantAccountRoleSchema.safeParse({ ...this.objectBody(body), tenantId, userId });
    if (!parsed.success) throw new BadRequestException('Invalid role assignment.');
    return this.accounts.grantRole({ actorUserId: session.userId, data: parsed.data });
  }

  @Post('account-roles/:assignmentId/revoke')
  revokeRole(
    @Param('tenantId') tenantId: string,
    @Param('assignmentId') assignmentId: string,
    @CurrentSession() session: ResolvedSession,
  ): Promise<{ revoked: true }> {
    this.assertUuid(tenantId, 'tenantId');
    this.assertUuid(assignmentId, 'assignmentId');
    return this.accounts.revokeRole({
      actorUserId: session.userId,
      tenantId,
      assignmentId,
    });
  }

  @Post('accounts/:userId/status')
  setStatus(
    @Param('tenantId') tenantId: string,
    @Param('userId') userId: string,
    @Body() body: unknown,
    @CurrentSession() session: ResolvedSession,
  ): Promise<{ updated: true }> {
    const parsed = accountStatusSchema.safeParse({ ...this.objectBody(body), tenantId, userId });
    if (!parsed.success) throw new BadRequestException('Invalid account status update.');
    return this.accounts.setStatus({ actorUserId: session.userId, data: parsed.data });
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

@Controller('enrollment')
export class EnrollmentController {
  constructor(private readonly accounts: AccountService) {}

  @Post('verify')
  verify(@Body() body: unknown): Promise<{ verified: true }> {
    const parsed = verifyEnrollmentSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Invalid verification request.');
    return this.accounts.verifyEnrollment(parsed.data);
  }
}
