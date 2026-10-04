import { Controller, Get, Query, Req, Res, UnauthorizedException } from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { AuthService } from './auth.service.js';
import { GoogleOidcService } from './google-oidc.service.js';

const STATE_COOKIE = 'preneura_oidc_state';
const VERIFIER_COOKIE = 'preneura_oidc_verifier';

@Controller('auth/google')
export class GoogleAuthController {
  constructor(
    private readonly google: GoogleOidcService,
    private readonly authService: AuthService,
  ) {}

  @Get('start')
  async start(@Res() reply: FastifyReply): Promise<void> {
    this.requireCookieSecurity();
    const authorization = this.google.createAuthorizationRequest();
    const cookieOptions = this.oidcCookieOptions();

    reply.setCookie(STATE_COOKIE, authorization.state, cookieOptions);
    reply.setCookie(VERIFIER_COOKIE, authorization.codeVerifier, cookieOptions);
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
    if (!expectedState || !codeVerifier || !this.sameSecret(expectedState, returnedState)) {
      throw new UnauthorizedException('Google authentication state is invalid.');
    }

    reply.clearCookie(STATE_COOKIE, { path: '/v1/auth/google' });
    reply.clearCookie(VERIFIER_COOKIE, { path: '/v1/auth/google' });

    const result = await this.google.completeAuthorization({ code, codeVerifier });
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
