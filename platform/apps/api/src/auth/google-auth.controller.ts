import { Controller, Get, Post, Query, Req, Res, UnauthorizedException } from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { AuthService } from './auth.service.js';
import { GoogleOidcService } from './google-oidc.service.js';

const STATE_COOKIE = 'preneura_oidc_state';
const VERIFIER_COOKIE = 'preneura_oidc_verifier';
const ASSURANCE_COOKIE = 'preneura_oidc_assurance';
const TARGET_SESSION_COOKIE = 'preneura_oidc_target_session';
const FLOW_COOKIE = 'preneura_oidc_flow';

@Controller('auth/google')
export class GoogleAuthController {
  constructor(
    private readonly google: GoogleOidcService,
    private readonly authService: AuthService,
  ) {}

  @Get('start')
  async start(
    @Query('assurance') requestedAssurance: string | undefined,
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    return this.begin(requestedAssurance, request, reply, false);
  }

  @Post('enrollment/start')
  async startEnrollment(@Req() request: FastifyRequest, @Res() reply: FastifyReply): Promise<void> {
    return this.begin('aal2', request, reply, true);
  }

  private async begin(requestedAssurance: string | undefined, request: FastifyRequest, reply: FastifyReply, enrollment: boolean): Promise<void> {
    this.requireCookieSecurity();
    const requireAal2 = requestedAssurance?.toLowerCase() === 'aal2';
    const authorization = this.google.createAuthorizationRequest({ requireAal2 });
    const cookieOptions = this.oidcCookieOptions();
    reply.setCookie(FLOW_COOKIE, JSON.stringify({ nonce: authorization.nonce, issuedAt: Date.now(), mode: enrollment ? 'ENROLLMENT' : 'LOGIN' }), cookieOptions);

    reply.setCookie(STATE_COOKIE, authorization.state, cookieOptions);
    reply.setCookie(VERIFIER_COOKIE, authorization.codeVerifier, cookieOptions);
    reply.setCookie(ASSURANCE_COOKIE, requireAal2 ? 'aal2' : 'aal1', cookieOptions);

    if (requireAal2) {
      const currentToken = this.readSessionCookie(request);
      const currentSession = await this.authService.resolveSessionToken(currentToken);
      if (currentSession?.userStatus === 'ACTIVE') {
        if (enrollment && !await this.authService.requiresPrivilegedAssurance(currentSession.userId)) throw new UnauthorizedException('This account does not require privileged enrollment.');
        if (
          currentSession.assuranceLevel === 'AAL1' &&
          !this.isRecentAssurance(currentSession.assuranceVerifiedAt)
        ) {
          throw new UnauthorizedException(
            'Repeat phone or National ID verification before enrolling a stronger sign-in method.',
          );
        }
        reply.setCookie(TARGET_SESSION_COOKIE, currentSession.sessionId, cookieOptions);
      } else {
        if (enrollment) throw new UnauthorizedException('Verify your account before requesting MFA enrollment.');
        reply.clearCookie(TARGET_SESSION_COOKIE, { path: this.oidcCookiePath() });
      }
    } else {
      reply.clearCookie(TARGET_SESSION_COOKIE, { path: this.oidcCookiePath() });
    }

    if (enrollment) { await reply.send({ authorizationUrl: authorization.url }); return; }
    await reply.redirect(authorization.url);
  }

  @Get('callback')
  async callback(
    @Query('code') code: string | undefined,
    @Query('state') returnedState: string | undefined,
    @Query('error') providerError: string | undefined,
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    this.requireCookieSecurity();
    if (providerError || !code || !returnedState) {
      throw new UnauthorizedException('Google authentication was cancelled or rejected.');
    }

    const expectedState = this.readProtectedCookie(request, STATE_COOKIE);
    const codeVerifier = this.readProtectedCookie(request, VERIFIER_COOKIE);
    const requestedAssurance = this.readProtectedCookie(request, ASSURANCE_COOKIE);
    const targetSessionId = this.readProtectedCookie(request, TARGET_SESSION_COOKIE);
    let flow: { nonce: string; issuedAt: number; mode: 'LOGIN' | 'ENROLLMENT' };
    try {
      flow = JSON.parse(this.readProtectedCookie(request, FLOW_COOKIE) ?? 'null');
      if (!flow || typeof flow.nonce !== 'string' || !Number.isFinite(flow.issuedAt) || Date.now()-flow.issuedAt>600_000 || flow.issuedAt>Date.now()+1000 || !['LOGIN','ENROLLMENT'].includes(flow.mode)) throw new Error('invalid');
    } catch { throw new UnauthorizedException('Authentication flow is missing or expired.'); }
    if (flow.mode === 'ENROLLMENT' && (!targetSessionId || requestedAssurance !== 'aal2')) throw new UnauthorizedException('Enrollment base session is missing.');
    if (!expectedState || !codeVerifier || !this.sameSecret(expectedState, returnedState)) {
      throw new UnauthorizedException('Google authentication state is invalid.');
    }

    let targetUserId: string | undefined;
    const currentSessionToken = this.readSessionCookie(request);
    if (targetSessionId) {
      if (requestedAssurance !== 'aal2') {
        throw new UnauthorizedException('Invalid step-up authentication state.');
      }
      const currentSession = await this.authService.resolveSessionToken(currentSessionToken);
      if (
        !currentSession ||
        currentSession.userStatus !== 'ACTIVE' ||
        currentSession.sessionId !== targetSessionId
      ) {
        throw new UnauthorizedException('The step-up base session is no longer valid.');
      }
      if (
        currentSession.assuranceLevel === 'AAL1' &&
        !this.isRecentAssurance(currentSession.assuranceVerifiedAt)
      ) {
        throw new UnauthorizedException('The step-up base session is too old.');
      }
      targetUserId = currentSession.userId;
    }

    reply.clearCookie(STATE_COOKIE, { path: this.oidcCookiePath() });
    reply.clearCookie(VERIFIER_COOKIE, { path: this.oidcCookiePath() });
    reply.clearCookie(ASSURANCE_COOKIE, { path: this.oidcCookiePath() });
    reply.clearCookie(TARGET_SESSION_COOKIE, { path: this.oidcCookiePath() });
    reply.clearCookie(FLOW_COOKIE, { path: this.oidcCookiePath() });

    const result = await this.google.completeAuthorization({
      code,
      codeVerifier,
      nonce: flow.nonce,
      requireAal2: requestedAssurance === 'aal2',
      ...(targetUserId ? { targetUserId } : {}),
      ...(flow.mode === 'ENROLLMENT' && targetSessionId ? { enrollmentBaseSessionId: targetSessionId } : {}),
    });

    if (result.kind === 'ENROLLMENT') {
      const webOrigin = (process.env.WEB_ORIGIN ?? 'http://localhost:3000').split(',')[0]!;
      await reply.redirect(new URL('/mfa-enrollment', webOrigin).toString());
      return;
    }

    if (targetUserId && currentSessionToken) {
      await this.authService.revokeSessionToken(currentSessionToken);
    }

    reply.setCookie(
      process.env.SESSION_COOKIE_NAME ?? 'preneura_session',
      result.login.sessionToken,
      {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
        maxAge: this.authService.sessionTtlSeconds(),
        signed: Boolean(process.env.COOKIE_SIGNING_SECRET),
      },
    );

    const webOrigin = (process.env.WEB_ORIGIN ?? 'http://localhost:3000').split(',')[0] ?? 'http://localhost:3000';
    const destination = result.accountStatus === 'ACTIVE' ? '/' : '/access-pending';
    await reply.redirect(new URL(destination, webOrigin).toString());
  }

  private oidcCookiePath(): string {
    const callback = new URL(process.env.OIDC_REDIRECT_URI ?? 'http://localhost:4100/v1/auth/google/callback');
    if (!callback.pathname.endsWith('/v1/auth/google/callback')) throw new Error('OIDC_REDIRECT_URI must end with /v1/auth/google/callback.');
    return callback.pathname.slice(0, -'/callback'.length);
  }

  private oidcCookieOptions() {
    return {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax' as const,
      path: this.oidcCookiePath(),
      maxAge: 600,
      signed: Boolean(process.env.COOKIE_SIGNING_SECRET),
    };
  }

  private readProtectedCookie(request: FastifyRequest, name: string): string | undefined {
    const raw = request.cookies[name];
    if (!raw) return undefined;
    if (!process.env.COOKIE_SIGNING_SECRET) return raw;
    const unsigned = request.unsignCookie(raw);
    return unsigned.valid ? unsigned.value : undefined;
  }

  private readSessionCookie(request: FastifyRequest): string | undefined {
    return this.readProtectedCookie(
      request,
      process.env.SESSION_COOKIE_NAME ?? 'preneura_session',
    );
  }

  private isRecentAssurance(verifiedAt: Date | null): boolean {
    if (!verifiedAt) return false;
    const maxAgeSeconds = Number(process.env.AUTH_STEP_UP_BASE_MAX_AGE_SECONDS ?? 600);
    if (!Number.isInteger(maxAgeSeconds) || maxAgeSeconds <= 0) {
      throw new Error('AUTH_STEP_UP_BASE_MAX_AGE_SECONDS must be a positive integer.');
    }
    const age = Date.now() - verifiedAt.getTime();
    return age >= -1000 && age <= Math.min(maxAgeSeconds,600) * 1000;
  }

  private sameSecret(left: string, right: string): boolean {
    const a = Buffer.from(left);
    const b = Buffer.from(right);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  private requireCookieSecurity(): void {
    if (process.env.NODE_ENV === 'production' && !process.env.COOKIE_SIGNING_SECRET) {
      throw new Error('COOKIE_SIGNING_SECRET is required in production');
    }
  }
}
