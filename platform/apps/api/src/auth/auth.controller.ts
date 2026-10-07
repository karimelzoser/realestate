import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import {
  startLoginSchema,
  verifyOtpSchema,
  type StartLoginResponse,
} from '@preneura/contracts/auth';
import { AuthService } from './auth.service.js';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login/start')
  async startLogin(@Body() body: unknown): Promise<StartLoginResponse> {
    const parsed = startLoginSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException('Enter valid login details.');
    }
    return this.authService.startLogin(parsed.data);
  }

  @Post('login/verify')
  async verifyOtp(
    @Body() body: unknown,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<{ userId: string; expiresAt: string }> {
    const parsed = verifyOtpSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException('Enter a valid one-time code.');
    }

    const result = await this.authService.verifyOtp(parsed.data);
    this.setSessionCookie(reply, result.sessionToken);

    return {
      userId: result.userId,
      expiresAt: result.expiresAt.toISOString(),
    };
  }

  @Get('me')
  async me(@Req() request: FastifyRequest): Promise<{
    userId: string;
    sessionId: string;
    status: 'ACTIVE' | 'PENDING';
    expiresAt: string;
  }> {
    const token = this.readSessionCookie(request);
    const session = await this.authService.resolveSessionToken(token);
    if (!session || session.userStatus === 'DISABLED') {
      throw new UnauthorizedException('Authentication required.');
    }

    return {
      userId: session.userId,
      sessionId: session.sessionId,
      status: session.userStatus,
      expiresAt: session.expiresAt.toISOString(),
    };
  }

  @Post('logout')
  async logout(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<{ loggedOut: true }> {
    await this.authService.revokeSessionToken(this.readSessionCookie(request));
    reply.clearCookie(this.sessionCookieName(), { path: '/' });
    return { loggedOut: true };
  }

  private setSessionCookie(reply: FastifyReply, sessionToken: string): void {
    reply.setCookie(this.sessionCookieName(), sessionToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: this.authService.sessionTtlSeconds(),
      signed: Boolean(process.env.COOKIE_SIGNING_SECRET),
    });
  }

  private readSessionCookie(request: FastifyRequest): string | undefined {
    const raw = request.cookies[this.sessionCookieName()];
    if (!raw) return undefined;
    if (!process.env.COOKIE_SIGNING_SECRET) return raw;
    const unsigned = request.unsignCookie(raw);
    return unsigned.valid ? unsigned.value : undefined;
  }

  private sessionCookieName(): string {
    return (
      process.env.SESSION_COOKIE_NAME ??
      (process.env.NODE_ENV === 'production' ? '__Host-preneura_session' : 'preneura_session')
    );
  }
}
