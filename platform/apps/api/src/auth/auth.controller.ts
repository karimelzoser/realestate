import { BadRequestException, Body, Controller, Post, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
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
    const ttl = this.authService.sessionTtlSeconds();

    reply.setCookie(process.env.SESSION_COOKIE_NAME ?? 'preneura_session', result.sessionToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: ttl,
      signed: Boolean(process.env.COOKIE_SIGNING_SECRET),
    });

    return {
      userId: result.userId,
      expiresAt: result.expiresAt.toISOString(),
    };
  }
}
