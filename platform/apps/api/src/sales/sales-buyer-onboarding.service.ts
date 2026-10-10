import { BadRequestException, Injectable } from '@nestjs/common';
import type { InviteProjectBuyerInput, InvitedProjectBuyerSnapshot } from '@preneura/contracts/sales';
import { encryptContactValue, hmacSha256, phoneDisplayHint } from '@preneura/security';
import { randomInt, randomUUID } from 'node:crypto';
import { parsePhoneNumberFromString } from 'libphonenumber-js';
import { AccessService } from '../access/access.service.js';
import { AccountVerificationDelivery } from '../accounts/account-verification-delivery.js';
import { SalesBuyerOnboardingRepository } from './sales-buyer-onboarding.repository.js';

@Injectable()
export class SalesBuyerOnboardingService {
  constructor(
    private readonly repository: SalesBuyerOnboardingRepository,
    private readonly access: AccessService,
    private readonly delivery: AccountVerificationDelivery,
  ) {}

  async invite(input: {
    actorUserId: string;
    data: InviteProjectBuyerInput;
  }): Promise<InvitedProjectBuyerSnapshot> {
    await this.access.assert({
      userId: input.actorUserId,
      permission: 'buyers.manage',
      context: { tenantId: input.data.tenantId, projectId: input.data.projectId },
    });

    const phone = this.normalizePhone(input.data.phone);
    const challengeId = randomUUID();
    const code = randomInt(100_000, 1_000_000).toString();
    const expiresAt = new Date(Date.now() + this.verificationTtlSeconds() * 1000);
    const created = await this.repository.provision({
      actorUserId: input.actorUserId,
      tenantId: input.data.tenantId,
      projectId: input.data.projectId,
      displayName: input.data.displayName,
      source: input.data.source,
      phoneIdentifierHmac: hmacSha256(phone, this.secret('AUTH_IDENTIFIER_HMAC_KEY')),
      contactCiphertext: encryptContactValue(phone, this.secret('CONTACT_ENCRYPTION_KEY_BASE64', false)),
      contactHmac: hmacSha256(phone, this.secret('CONTACT_HMAC_KEY')),
      contactDisplayHint: phoneDisplayHint(phone),
      challengeId,
      challengeDigest: this.verificationDigest(challengeId, code),
      channel: input.data.verificationChannel,
      expiresAt,
    });

    let verificationDispatched = false;
    try {
      await this.delivery.send({
        userId: created.userId,
        contactId: created.contactId,
        challengeId,
        code,
        channel: input.data.verificationChannel,
      });
      await this.repository.markChallengeSent(challengeId, new Date());
      verificationDispatched = true;
    } catch {
      verificationDispatched = false;
    }

    return {
      userId: created.userId,
      buyerProfileId: created.buyerProfileId,
      accountStatus: 'PENDING',
      contactDisplayHint: phoneDisplayHint(phone),
      verificationRequired: true,
      verificationChannel: input.data.verificationChannel,
      verificationDispatched,
    };
  }

  private normalizePhone(value: string): string {
    const phone = parsePhoneNumberFromString(value, 'EG');
    if (!phone?.isValid()) throw new BadRequestException('Enter a valid phone number.');
    return phone.number;
  }

  private verificationDigest(challengeId: string, code: string): Buffer {
    return hmacSha256(`${challengeId}:${code}`, this.secret('CONTACT_VERIFICATION_PEPPER'));
  }

  private verificationTtlSeconds(): number {
    const value = Number(process.env.CONTACT_VERIFICATION_TTL_SECONDS ?? 600);
    if (!Number.isInteger(value) || value < 60 || value > 86_400) {
      throw new Error('CONTACT_VERIFICATION_TTL_SECONDS must be between 60 and 86400.');
    }
    return value;
  }

  private secret(name: string, enforceLength = true): string {
    const value = process.env[name];
    if (!value || (enforceLength && value.length < 32)) {
      throw new Error(`${name} is not configured correctly.`);
    }
    return value;
  }
}
