import { Controller, Get, Query, Req, Res, UnauthorizedException } from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { AuthService } from './auth.service.js';
import { GoogleOidcService } from './google-oidc.service.js';

const STATE_COOKIE = 'preneura_oidc_state';
const VERIFIER_COOKIE = 'preneura_oidc_verifier';
const ASSURANCE_COOKIE = 'preneura_oidc_assurance';
const TARGET_SESSION_COOKIE = 'preneura_oidc_target_session';

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
    this.requireCookieSecurity();
    const requireAal2 = requestedAssurance?.toLowerCase() === 'aal2';
    const authorization = this.google.createAuthorizationRequest({ requireAal2 });
    const cookieOptions = this.oidcCookieOptions();

    reply.setCookie(STATE_COOKIE, authorization.state, cookieOptions);
    reply.setCookie(VERIFIER_COOKIE, authorization.codeVerifier, cookieOptions);
    reply.setCookie(ASSURANCE_COOKIE, requireAal2 ? 'aal2' : 'aal1', cookieOptions);

    if (requireAal2) {
      const currentToken = this.readSessionCookie(request);
      const currentSession = await this.authService.resolveSessionToken(currentToken);
      if (currentSession?.userStatus === 'ACTIVE') {
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
        reply.clearCookie(TARGET_SESSION_COOKIE, { path: '/v1/auth/google' });
      }
    } else {
      reply.clearCookie(TARGET_SESSION_COOKIE, { path: '/v1/auth/google' });
    }

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

    reply.clearCookie(STATE_COOKIE, { path: '/v1/auth/google' });
    reply.clearCookie(VERIFIER_COOKIE, { path: '/v1/auth/google' });
    reply.clearCookie(ASSURANCE_COOKIE, { path: '/v1/auth/google' });
    reply.clearCookie(TARGET_SESSION_COOKIE, { path: '/v1/auth/google' });

    const result = await this.google.completeAuthorization({
      code,
      codeVerifier,
      requireAal2: requestedAssurance === 'aal2',
      ...(targetUserId ? { targetUserId } : {}),
    });

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

  private oidcCookieOptions() {
    return {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax' as const,
      path: '/v1/auth/google',
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
    return Date.now() - verifiedAt.getTime() <= maxAgeSeconds * 1000;
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
