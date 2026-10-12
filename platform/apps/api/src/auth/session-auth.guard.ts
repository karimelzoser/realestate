import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
  createParamDecorator,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import type { ResolvedSession } from './auth.repository.js';
import { AuthService } from './auth.service.js';

export interface AuthenticatedRequest extends FastifyRequest {
  authSession?: ResolvedSession;
}

@Injectable()
export class SessionAuthGuard implements CanActivate {
  constructor(private readonly authService: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const raw = request.cookies[this.sessionCookieName()];
    const token = this.readCookie(request, raw);
    const session = await this.authService.resolveSessionToken(token);

    if (!session || session.userStatus !== 'ACTIVE') {
      throw new UnauthorizedException('Authentication required.');
    }

    if (
      session.assuranceLevel !== 'AAL2' &&
      await this.authService.requiresPrivilegedAssurance(session.userId)
    ) {
      throw new ForbiddenException({
        statusCode: 403,
        error: 'STEP_UP_REQUIRED',
        message: 'A stronger authentication step is required for this privileged account.',
        requiredAssurance: 'AAL2',
        currentAssurance: session.assuranceLevel,
      });
    }

    request.authSession = session;
    return true;
  }

  private readCookie(
    request: FastifyRequest,
    raw: string | undefined,
  ): string | undefined {
    if (!raw) return undefined;
    if (!process.env.COOKIE_SIGNING_SECRET) return raw;
    const unsigned = request.unsignCookie(raw);
    return unsigned.valid ? unsigned.value : undefined;
  }

  private sessionCookieName(): string {
    return process.env.SESSION_COOKIE_NAME ?? 'preneura_session';
  }
}

export const CurrentSession = createParamDecorator(
  (_data: unknown, context: ExecutionContext): ResolvedSession => {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!request.authSession) {
      throw new UnauthorizedException('Authentication required.');
    }
    return request.authSession;
  },
);
