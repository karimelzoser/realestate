import {
  HttpException,
  HttpStatus,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  createHash,
  createHmac,
  randomBytes,
  randomInt,
  randomUUID,
} from 'node:crypto';
import {
  genericLoginMessage,
  startLoginSchema,
  verifyOtpSchema,
  type StartLoginInput,
  type StartLoginResponse,
  type VerifyOtpInput,
} from '@preneura/contracts/auth';
import {
  AuthRepository,
  type AliasKind,
  type ResolvedSession,
} from './auth.repository.js';
import { otpAssurance, type SessionAssuranceEvidence } from './auth-assurance.js';
import { OtpDeliveryPort } from './otp-delivery.js';
import {
  normalizeEgyptPhone,
  normalizeIdentityDocument,
} from '../identity/identity-normalization.js';

export interface VerifiedLogin {
  userId: string;
  sessionId: string;
  sessionToken: string;
  expiresAt: Date;
  assuranceLevel: 'AAL1' | 'AAL2';
}

@Injectable()
export class AuthService {
  constructor(
    private readonly repository: AuthRepository,
    private readonly otpDelivery: OtpDeliveryPort,
  ) {}

  async startLogin(rawInput: StartLoginInput): Promise<StartLoginResponse> {
    if (process.env.AUTH_PHONE_LOGIN_ENABLED === 'false') {
      throw new ServiceUnavailableException('Phone sign-in is awaiting delivery-provider configuration.');
    }
    const input = startLoginSchema.parse(rawInput);
    const normalized = this.normalizeIdentifier(input.method, input.identifier);
    const kind: AliasKind = input.method === 'phone' ? 'PHONE' : 'NATIONAL_ID';
    const identifierHmac = this.identifierHmac(normalized);

    const windowSeconds = this.otpRequestWindowSeconds();
    const recentChallengeCount = await this.repository.countChallengesSince(
      kind,
      identifierHmac,
      new Date(Date.now() - windowSeconds * 1000),
    );
    if (recentChallengeCount >= this.otpMaxRequestsPerWindow()) {
      await this.repository.recordEvent({
        eventType: 'LOGIN_CHALLENGE_RATE_LIMITED',
        result: 'REJECTED',
        metadata: { method: input.method, windowSeconds },
      });
      throw new HttpException(
        'Too many one-time-code requests. Try again later.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const userId = await this.repository.findActiveUserByAlias(kind, identifierHmac);
    const challengeId = randomUUID();
    const code = this.generateOtp();
    const expiresInSeconds = this.otpTtlSeconds();
    const expiresAt = new Date(Date.now() + expiresInSeconds * 1000);
    const otpDigest = this.otpDigest(challengeId, code);

    await this.repository.createChallenge({
      id: challengeId,
      userId,
      requestedKind: kind,
      requestedIdentifierHmac: identifierHmac,
      otpDigest,
      deliveryChannel: input.channel === 'whatsapp' ? 'WHATSAPP' : 'SMS',
      attemptsRemaining: this.otpMaxAttempts(),
      expiresAt,
    });

    if (userId) {
      try {
        await this.otpDelivery.sendToUser({
          userId,
          challengeId,
          code,
          channel: input.channel === 'whatsapp' ? 'WHATSAPP' : 'SMS',
        });
        await this.repository.markDeliveryAttempted(challengeId);
      } catch {
        await this.repository.recordEvent({
          userId,
          eventType: 'OTP_DELIVERY_FAILED',
          result: 'FAILED',
          challengeId,
        });
      }
    }

    await this.repository.recordEvent({
      userId,
      eventType: 'LOGIN_CHALLENGE_CREATED',
      result: 'SUCCESS',
      challengeId,
      metadata: { method: input.method, channel: input.channel },
    });

    return {
      challengeId,
      expiresInSeconds,
      message: genericLoginMessage,
    };
  }

  publicCapabilities(): { phoneSignInEnabled: boolean; oidcSignInEnabled: boolean; oidcProvider: 'GOOGLE' | 'ORGANIZATION'; defaultOtpChannel: 'sms' | 'whatsapp' } {
    return {
      phoneSignInEnabled: process.env.AUTH_PHONE_LOGIN_ENABLED !== 'false',
      oidcSignInEnabled: Boolean(process.env.OIDC_ISSUER && process.env.OIDC_CLIENT_ID && process.env.OIDC_CLIENT_SECRET && process.env.OIDC_REDIRECT_URI),
      oidcProvider: (process.env.OIDC_IDP_HINT ?? 'google') === 'google' ? 'GOOGLE' : 'ORGANIZATION',
      defaultOtpChannel: process.env.OTP_CHANNEL === 'whatsapp' ? 'whatsapp' : 'sms',
    };
  }

  async verifyOtp(rawInput: VerifyOtpInput): Promise<VerifiedLogin> {
    const input = verifyOtpSchema.parse(rawInput);
    const now = new Date();
    const digest = this.otpDigest(input.challengeId, input.code);
    const userId = await this.repository.consumeChallenge(input.challengeId, digest, now);

    if (!userId) {
      await this.repository.decrementChallengeAttempt(input.challengeId, now);
      await this.repository.recordEvent({
        eventType: 'LOGIN_OTP_REJECTED',
        result: 'REJECTED',
        challengeId: input.challengeId,
      });
      throw new UnauthorizedException('The code is invalid or expired.');
    }

    return this.issueSessionForUser(
      userId,
      {
        eventType: 'LOGIN_OTP_VERIFIED',
        challengeId: input.challengeId,
      },
      otpAssurance(),
    );
  }

  async issueSessionForUser(
    userId: string,
    audit: { eventType: string; challengeId?: string | null },
    assurance: SessionAssuranceEvidence = otpAssurance(),
  ): Promise<VerifiedLogin> {
    const sessionId = randomUUID();
    const sessionToken = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + this.sessionTtlSeconds() * 1000);

    await this.repository.createSession({
      id: sessionId,
      userId,
      tokenDigest: this.sessionDigest(sessionToken),
      expiresAt,
      assurance,
    });

    await this.repository.recordEvent({
      userId,
      eventType: audit.eventType,
      result: 'SUCCESS',
      challengeId: audit.challengeId ?? null,
      sessionId,
      metadata: {
        authMethod: assurance.authMethod,
        assuranceLevel: assurance.assuranceLevel,
        ...(assurance.providerAcr ? { providerAcr: assurance.providerAcr } : {}),
      },
    });

    return {
      userId,
      sessionId,
      sessionToken,
      expiresAt,
      assuranceLevel: assurance.assuranceLevel,
    };
  }

  async resolveSessionToken(sessionToken: string | undefined): Promise<ResolvedSession | null> {
    if (!sessionToken) return null;
    return this.repository.resolveSession(this.sessionDigest(sessionToken), new Date());
  }

  async requiresPrivilegedAssurance(userId: string): Promise<boolean> {
    return this.repository.userRequiresPrivilegedAssurance(userId);
  }

  async revokeSessionToken(sessionToken: string | undefined): Promise<void> {
    const session = await this.resolveSessionToken(sessionToken);
    if (!session) return;
    await this.repository.revokeSession(session.sessionId, new Date());
    await this.repository.recordEvent({
      userId: session.userId,
      eventType: 'SESSION_REVOKED',
      result: 'SUCCESS',
      sessionId: session.sessionId,
    });
  }

  sessionTtlSeconds(): number {
    return this.positiveIntegerEnv('SESSION_TTL_SECONDS', 43_200);
  }

  private otpTtlSeconds(): number {
    return this.positiveIntegerEnv('AUTH_OTP_TTL_SECONDS', 300);
  }

  private otpMaxAttempts(): number {
    return this.positiveIntegerEnv('AUTH_OTP_MAX_ATTEMPTS', 5);
  }

  private otpRequestWindowSeconds(): number {
    return this.positiveIntegerEnv('AUTH_OTP_REQUEST_WINDOW_SECONDS', 600);
  }

  private otpMaxRequestsPerWindow(): number {
    return this.positiveIntegerEnv('AUTH_OTP_MAX_REQUESTS_PER_WINDOW', 5);
  }

  private generateOtp(): string {
    return randomInt(100_000, 1_000_000).toString();
  }

  private normalizeIdentifier(method: StartLoginInput['method'], value: string): string {
    if (method === 'phone') return normalizeEgyptPhone(value);
    return normalizeIdentityDocument({ kind: 'NATIONAL_ID', identifier: value }).normalizedIdentifier;
  }

  private identifierHmac(normalizedIdentifier: string): Buffer {
    return createHmac('sha256', this.requiredSecret('AUTH_IDENTIFIER_HMAC_KEY'))
      .update(normalizedIdentifier, 'utf8')
      .digest();
  }

  private otpDigest(challengeId: string, code: string): Buffer {
    return createHmac('sha256', this.requiredSecret('AUTH_OTP_PEPPER'))
      .update(`${challengeId}:${code}`, 'utf8')
      .digest();
  }

  private sessionDigest(sessionToken: string): Buffer {
    return createHash('sha256').update(sessionToken, 'utf8').digest();
  }

  private requiredSecret(name: string): string {
    const value = process.env[name];
    if (!value || value.length < 32) {
      throw new Error(`${name} must be configured with at least 32 characters`);
    }
    return value;
  }

  private positiveIntegerEnv(name: string, fallback: number): number {
    const parsed = Number(process.env[name] ?? fallback);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      throw new Error(`${name} must be a positive integer`);
    }
    return parsed;
  }
}
