import { BadRequestException, Injectable } from '@nestjs/common';
import { randomInt, randomUUID } from 'node:crypto';
import { parsePhoneNumberFromString } from 'libphonenumber-js';
import type { BootstrapOperationsDirectorInput } from '@preneura/contracts/onboarding';
import type { ProvisionedAccountSnapshot } from '@preneura/contracts/accounts';
import {
  encryptContactValue,
  hmacSha256,
  phoneDisplayHint,
} from '@preneura/security';
import { AccessService } from '../access/access.service.js';
import { AccountRepository } from './account.repository.js';
import { AccountVerificationDelivery } from './account-verification-delivery.js';

@Injectable()
export class AccountBootstrapService {
  constructor(
    private readonly repository: AccountRepository,
    private readonly access: AccessService,
    private readonly delivery: AccountVerificationDelivery,
  ) {}

  async provisionOperationsDirector(input: {
    actorUserId: string;
    tenantId: string;
    data: BootstrapOperationsDirectorInput;
  }): Promise<ProvisionedAccountSnapshot & { verificationDispatched: boolean }> {
    await this.access.assert({
      userId: input.actorUserId,
      permission: 'platform.tenants.manage',
    });

    const phone = this.normalizePhone(input.data.phone);
    const challengeId = randomUUID();
    const code = randomInt(100_000, 1_000_000).toString();
    const expiresAt = new Date(Date.now() + this.verificationTtlSeconds() * 1000);
    const created = await this.repository.provision({
      actorUserId: input.actorUserId,
      tenantId: input.tenantId,
      displayName: input.data.displayName,
      phoneIdentifierHmac: hmacSha256(phone, this.secret('AUTH_IDENTIFIER_HMAC_KEY')),
      contactCiphertext: encryptContactValue(phone, this.secret('CONTACT_ENCRYPTION_KEY_BASE64', false)),
      contactHmac: hmacSha256(phone, this.secret('CONTACT_HMAC_KEY')),
      contactDisplayHint: phoneDisplayHint(phone),
      role: 'OPERATIONS_DIRECTOR',
      scopeType: 'TENANT',
      projectId: null,
      brokerCompanyId: null,
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
      // The pending account remains recoverable through Account Center resend. Do not
      // roll back identity/role creation merely because the external channel is down.
    }

    return {
      userId: created.userId,
      status: 'PENDING',
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
