import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import {
  declareIdentityDocumentSchema,
  identityConsentSchema,
  identityRecoveryStartSchema,
  identityRecoveryVerifySchema,
  reviewIdentityDocumentSchema,
  type IdentityProfileSnapshot,
  type IdentityRecoveryStartResponse,
} from '@preneura/contracts/identity';
import type { ResolvedSession } from '../auth/auth.repository.js';
import { CurrentSession, SessionAuthGuard } from '../auth/session-auth.guard.js';
import { IdentityService } from './identity.service.js';

@UseGuards(SessionAuthGuard)
@Controller('tenants/:tenantId/me/identity')
export class SelfIdentityController {
  constructor(private readonly identity: IdentityService) {}

  @Get()
  get(
    @Param('tenantId') tenantId: string,
    @CurrentSession() session: ResolvedSession,
  ): Promise<IdentityProfileSnapshot> {
    this.assertUuid(tenantId, 'tenantId');
    return this.identity.snapshot({ tenantId, userId: session.userId });
  }

  @Put('document')
  declareDocument(
    @Param('tenantId') tenantId: string,
    @CurrentSession() session: ResolvedSession,
    @Body() body: unknown,
  ): Promise<IdentityProfileSnapshot> {
    this.assertUuid(tenantId, 'tenantId');
    const parsed = declareIdentityDocumentSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Invalid identity document declaration.');
    return this.identity.declareDocument({ tenantId, userId: session.userId, data: parsed.data });
  }

  @Post('consents')
  consent(
    @Param('tenantId') tenantId: string,
    @CurrentSession() session: ResolvedSession,
    @Body() body: unknown,
  ): Promise<IdentityProfileSnapshot> {
    this.assertUuid(tenantId, 'tenantId');
    const parsed = identityConsentSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Invalid identity consent event.');
    return this.identity.consent({ tenantId, userId: session.userId, data: parsed.data });
  }

  private assertUuid(value: string, field: string): void {
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!uuid.test(value)) throw new BadRequestException(`Invalid ${field}.`);
  }
}

@UseGuards(SessionAuthGuard)
@Controller('tenants/:tenantId/accounts/:userId/identity')
export class IdentityAdminController {
  constructor(private readonly identity: IdentityService) {}

  @Post('review')
  review(
    @Param('tenantId') tenantId: string,
    @Param('userId') userId: string,
    @CurrentSession() session: ResolvedSession,
    @Body() body: unknown,
  ): Promise<IdentityProfileSnapshot> {
    this.assertUuid(tenantId, 'tenantId');
    this.assertUuid(userId, 'userId');
    const parsed = reviewIdentityDocumentSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Invalid identity review decision.');
    return this.identity.review({
      tenantId,
      targetUserId: userId,
      actorUserId: session.userId,
      data: parsed.data,
    });
  }

  private assertUuid(value: string, field: string): void {
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!uuid.test(value)) throw new BadRequestException(`Invalid ${field}.`);
  }
}

@Controller('identity/recovery')
export class IdentityRecoveryController {
  constructor(private readonly identity: IdentityService) {}

  @Post('start')
  start(@Body() body: unknown): Promise<IdentityRecoveryStartResponse> {
    const parsed = identityRecoveryStartSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Enter valid recovery details.');
    return this.identity.startRecovery(parsed.data);
  }

  @Post('verify')
  async verify(
    @Body() body: unknown,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<{ userId: string; expiresAt: string }> {
    const parsed = identityRecoveryVerifySchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Enter a valid recovery code.');
    const result = await this.identity.verifyRecovery(parsed.data);
    reply.setCookie(process.env.SESSION_COOKIE_NAME ?? 'preneura_session', result.sessionToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: this.identitySessionTtlSeconds(),
      signed: Boolean(process.env.COOKIE_SIGNING_SECRET),
    });
    return { userId: result.userId, expiresAt: result.expiresAt.toISOString() };
  }

  private identitySessionTtlSeconds(): number {
    const parsed = Number(process.env.SESSION_TTL_SECONDS ?? 43_200);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : 43_200;
  }
}
