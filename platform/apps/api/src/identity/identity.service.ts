import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { createHmac, randomInt, randomUUID } from 'node:crypto';
import type {
  DeclareIdentityDocumentInput,
  IdentityConsentInput,
  IdentityProfileSnapshot,
  IdentityRecoveryStartInput,
  IdentityRecoveryStartResponse,
  IdentityRecoveryVerifyInput,
  ReviewIdentityDocumentInput,
} from '@preneura/contracts/identity';
import { genericIdentityRecoveryMessage } from '@preneura/contracts/identity';
import { AccessService } from '../access/access.service.js';
import { AuthService, type VerifiedLogin } from '../auth/auth.service.js';
import { IdentityRepository } from './identity.repository.js';
import { IdentityRecoveryDelivery } from './identity-recovery-delivery.js';
import { normalizeIdentityDocument } from './identity-normalization.js';

@Injectable()
export class IdentityService {
  constructor(
    private readonly repository: IdentityRepository,
    private readonly access: AccessService,
    private readonly auth: AuthService,
    private readonly delivery: IdentityRecoveryDelivery,
  ) {}

  async snapshot(input: { tenantId: string; userId: string }): Promise<IdentityProfileSnapshot> {
    await this.requireMembership(input);
    return this.repository.snapshot(input);
  }

  async declareDocument(input: {
    tenantId: string;
    userId: string;
    data: DeclareIdentityDocumentInput;
  }): Promise<IdentityProfileSnapshot> {
    await this.requireMembership(input);
    const normalized = normalizeIdentityDocument(input.data);
    try {
      await this.repository.declareDocument({
        tenantId: input.tenantId,
        userId: input.userId,
        kind: normalized.kind,
        countryCode: normalized.countryCode,
        documentHmac: this.documentHmac(normalized.normalizedIdentifier),
        displayHint: normalized.displayHint,
        consentPolicyVersion: input.data.consentPolicyVersion,
      });
    } catch (error) {
      if (this.databaseConstraint(error, 'identity_profiles_tenant_document_unique')) {
        throw new ConflictException('This identity document is already linked inside this tenant.');
      }
      if (error instanceof Error && error.message === 'DOCUMENT_LOCKED_AFTER_VERIFICATION') {
        throw new ConflictException('A reviewed identity document cannot be replaced through self-service.');
      }
      throw error;
    }
    return this.repository.snapshot(input);
  }

  async consent(input: {
    tenantId: string;
    userId: string;
    data: IdentityConsentInput;
  }): Promise<IdentityProfileSnapshot> {
    await this.requireMembership(input);
    await this.repository.recordConsent({
      tenantId: input.tenantId,
      userId: input.userId,
      purpose: input.data.purpose,
      action: input.data.action,
      policyVersion: input.data.policyVersion,
    });
    return this.repository.snapshot(input);
  }

  async review(input: {
    tenantId: string;
    targetUserId: string;
    actorUserId: string;
    data: ReviewIdentityDocumentInput;
  }): Promise<IdentityProfileSnapshot> {
    await this.access.assert({
      userId: input.actorUserId,
      permission: 'tenant.users.manage',
      context: { tenantId: input.tenantId },
    });
    try {
      await this.repository.reviewDocument({
        tenantId: input.tenantId,
        userId: input.targetUserId,
        actorUserId: input.actorUserId,
        decision: input.data.decision,
        ...(input.data.note ? { note: input.data.note } : {}),
      });
    } catch (error) {
      if (error instanceof Error && error.message === 'IDENTITY_PROFILE_NOT_REVIEWABLE') {
        throw new NotFoundException('Reviewable identity profile not found.');
      }
      throw error;
    }
    return this.repository.snapshot({ tenantId: input.tenantId, userId: input.targetUserId });
  }

  async startRecovery(rawInput: IdentityRecoveryStartInput): Promise<IdentityRecoveryStartResponse> {
    const normalized = normalizeIdentityDocument(rawInput);
    const documentHmac = this.documentHmac(normalized.normalizedIdentifier);
    const windowSeconds = this.positiveIntegerEnv('IDENTITY_RECOVERY_REQUEST_WINDOW_SECONDS', 600);
    const recent = await this.repository.countRecoveryChallengesSince({
      tenantId: rawInput.tenantId,
      kind: normalized.kind,
      documentHmac,
      since: new Date(Date.now() - windowSeconds * 1000),
    });
    if (recent >= this.positiveIntegerEnv('IDENTITY_RECOVERY_MAX_REQUESTS_PER_WINDOW', 5)) {
      throw new HttpException('Too many recovery attempts. Try again later.', HttpStatus.TOO_MANY_REQUESTS);
    }

    const target = await this.repository.findRecoveryTarget({
      tenantId: rawInput.tenantId,
      kind: normalized.kind,
      documentHmac,
    });
    const challengeId = randomUUID();
    const code = randomInt(100_000, 1_000_000).toString();
    const expiresInSeconds = this.positiveIntegerEnv('IDENTITY_RECOVERY_OTP_TTL_SECONDS', 300);

    await this.repository.createRecoveryChallenge({
      id: challengeId,
      tenantId: rawInput.tenantId,
      userId: target?.user_id ?? null,
      contactId: target?.contact_id ?? null,
      kind: normalized.kind,
      documentHmac,
      channel: rawInput.channel,
      codeDigest: this.recoveryCodeDigest(challengeId, code),
      attemptsRemaining: this.positiveIntegerEnv('IDENTITY_RECOVERY_OTP_MAX_ATTEMPTS', 5),
      expiresAt: new Date(Date.now() + expiresInSeconds * 1000),
    });

    if (target) {
      try {
        await this.delivery.send({
          userId: target.user_id,
          contactId: target.contact_id,
          challengeId,
          code,
          channel: rawInput.channel,
        });
        await this.repository.markRecoverySent(challengeId);
        await this.repository.recordVerificationEvent({
          tenantId: rawInput.tenantId,
          userId: target.user_id,
          assertionType: 'RECOVERY_CHALLENGE_CREATED',
          evidenceSource: 'TENANT_SCOPED_DOCUMENT_RECOVERY',
          metadata: { channel: rawInput.channel, documentKind: normalized.kind },
        });
      } catch {
        // Preserve the same external response so delivery failures do not become an account-enumeration oracle.
      }
    }

    return { challengeId, expiresInSeconds, message: genericIdentityRecoveryMessage };
  }

  async verifyRecovery(input: IdentityRecoveryVerifyInput): Promise<VerifiedLogin> {
    const recovered = await this.repository.consumeRecoveryChallenge({
      challengeId: input.challengeId,
      codeDigest: this.recoveryCodeDigest(input.challengeId, input.code),
      at: new Date(),
    });
    if (!recovered) {
      throw new UnauthorizedException('The recovery code is invalid or expired.');
    }

    await this.repository.recordVerificationEvent({
      tenantId: recovered.tenantId,
      userId: recovered.userId,
      assertionType: 'RECOVERY_CHALLENGE_VERIFIED',
      evidenceSource: 'VERIFIED_PHONE_POSSESSION',
      metadata: { challengeId: input.challengeId },
    });

    return this.auth.issueSessionForUser(recovered.userId, {
      eventType: 'IDENTITY_RECOVERY_OTP_VERIFIED',
      challengeId: input.challengeId,
    });
  }

  private async requireMembership(input: { tenantId: string; userId: string }): Promise<void> {
    try {
      await this.repository.assertActiveMembership(input);
    } catch (error) {
      if (error instanceof Error && error.message === 'ACTIVE_MEMBERSHIP_REQUIRED') {
        throw new ForbiddenException('Active tenant membership is required.');
      }
      throw error;
    }
  }

  private documentHmac(normalizedIdentifier: string): Buffer {
    return createHmac('sha256', this.requiredSecret('IDENTITY_DOCUMENT_HMAC_KEY'))
      .update(normalizedIdentifier, 'utf8')
      .digest();
  }

  private recoveryCodeDigest(challengeId: string, code: string): Buffer {
    return createHmac('sha256', this.requiredSecret('IDENTITY_RECOVERY_OTP_PEPPER'))
      .update(`${challengeId}:${code}`, 'utf8')
      .digest();
  }

  private requiredSecret(name: string): string {
    const value = process.env[name];
    if (!value || value.length < 32) {
      throw new Error(`${name} must be configured with at least 32 characters.`);
    }
    return value;
  }

  private positiveIntegerEnv(name: string, fallback: number): number {
    const parsed = Number(process.env[name] ?? fallback);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      throw new Error(`${name} must be a positive integer.`);
    }
    return parsed;
  }

  private databaseConstraint(error: unknown, constraint: string): boolean {
    return Boolean(
      error &&
      typeof error === 'object' &&
      'constraint' in error &&
      (error as { constraint?: unknown }).constraint === constraint,
    );
  }
}
