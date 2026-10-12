import { BadRequestException, Body, ConflictException, Controller, ForbiddenException, Get, Param, Post, Req, UnauthorizedException, UseGuards } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { AuthService } from './auth.service.js';
import { IdentityEnrollmentRepository, type EnrollmentSnapshot } from './identity-enrollment.repository.js';
import { CurrentSession, SessionAuthGuard } from './session-auth.guard.js';
import type { ResolvedSession } from './auth.repository.js';

@Controller('auth/identity-enrollment')
export class IdentityEnrollmentController {
  constructor(private readonly auth: AuthService, private readonly repository: IdentityEnrollmentRepository) {}

  // Deliberately permits AAL1 only for this user's own enrollment status. No
  // business/workspace permission or stronger session is issued here.
  @Get('mine')
  async mine(@Req() request: FastifyRequest): Promise<EnrollmentSnapshot[]> {
    const raw = request.cookies[process.env.SESSION_COOKIE_NAME ?? 'preneura_session'];
    const unsigned = raw && process.env.COOKIE_SIGNING_SECRET ? request.unsignCookie(raw) : undefined;
    const session = await this.auth.resolveSessionToken(unsigned ? unsigned.valid ? unsigned.value : undefined : raw);
    if (!session || session.userStatus !== 'ACTIVE') throw new UnauthorizedException('Authentication required.');
    return this.repository.list(session.userId);
  }

  @UseGuards(SessionAuthGuard)
  @Get('review')
  async inbox(@CurrentSession() session: ResolvedSession): Promise<EnrollmentSnapshot[]> {
    await this.requireReviewer(session);
    return this.repository.list();
  }

  @UseGuards(SessionAuthGuard)
  @Post(':requestId/review')
  async review(@Param('requestId') id: string, @Body() body: unknown, @CurrentSession() session: ResolvedSession): Promise<{ reviewed: true }> {
    await this.requireReviewer(session);
    const data = body as { decision?: unknown; note?: unknown } | null;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id) ||
      !data || !['APPROVED','REJECTED'].includes(String(data.decision)) || typeof data.note !== 'string' || data.note.trim().length<10 || data.note.trim().length>1000) {
      throw new BadRequestException('Enter an enrollment decision and an independent identity-verification note.');
    }
    try {
      const reviewed = await this.repository.review({ id, reviewerUserId: session.userId, reviewerSessionId: session.sessionId,
        decision: data.decision as 'APPROVED' | 'REJECTED', note: data.note.trim() });
      if (!reviewed) throw new ConflictException('The enrollment decision conflicts with the stored request.');
    } catch (error) {
      if (error instanceof ConflictException) throw error;
      const code = (error as { code?: string }).code;
      if (['P0001','23505','23514'].includes(code ?? '')) throw new ConflictException('Enrollment is expired, conflicted, or no longer eligible.');
      throw error;
    }
    return { reviewed: true };
  }

  private async requireReviewer(session: ResolvedSession): Promise<void> {
    const age = session.assuranceVerifiedAt ? Date.now()-session.assuranceVerifiedAt.getTime() : Infinity;
    if (session.assuranceLevel !== 'AAL2' || age < -1000 || age>600_000 || !await this.repository.isPlatformReviewer(session.userId)) {
      throw new ForbiddenException('A recent platform administrator MFA sign-in is required.');
    }
  }
}
