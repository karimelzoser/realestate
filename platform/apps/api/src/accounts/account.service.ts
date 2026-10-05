import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { randomInt, randomUUID } from 'node:crypto';
import { parsePhoneNumberFromString } from 'libphonenumber-js';
import type {
  AccountAdminScopeSnapshot,
  AccountProvisionInput,
  AccountSnapshot,
  AccountStatusInput,
  GrantAccountRoleInput,
  ProvisionedAccountSnapshot,
  VerifyEnrollmentInput,
} from '@preneura/contracts/accounts';
import {
  roleHasPermission,
  type RoleCode,
  type ScopeType,
} from '@preneura/contracts/access';
import {
  encryptContactValue,
  hmacSha256,
  phoneDisplayHint,
  secureDigestMatches,
} from '@preneura/security';
import { AccessService } from '../access/access.service.js';
import { AccountRepository } from './account.repository.js';
import { AccountVerificationDelivery } from './account-verification-delivery.js';

@Injectable()
export class AccountService {
  constructor(
    private readonly repository: AccountRepository,
    private readonly access: AccessService,
    private readonly delivery: AccountVerificationDelivery,
  ) {}

  async scopes(input: { actorUserId: string; tenantId: string }): Promise<AccountAdminScopeSnapshot> {
    const management = await this.managementScope(input.actorUserId, input.tenantId);
    if (!management.tenantUserAdmin && management.brokerCompanyIds.length === 0) {
      throw new ForbiddenException('You do not have account-administration access in this tenant.');
    }
    return this.repository.scopeSnapshot({
      tenantId: input.tenantId,
      tenantUserAdmin: management.tenantUserAdmin,
      brokerCompanyIds: management.brokerCompanyIds,
    });
  }

  async list(input: { actorUserId: string; tenantId: string }): Promise<AccountSnapshot[]> {
    const management = await this.managementScope(input.actorUserId, input.tenantId);
    if (!management.tenantUserAdmin && management.brokerCompanyIds.length === 0) {
      throw new ForbiddenException('You do not have account-administration access in this tenant.');
    }
    return this.repository.listAccounts({
      tenantId: input.tenantId,
      brokerCompanyIds: management.tenantUserAdmin ? null : management.brokerCompanyIds,
    });
  }

  async provision(input: {
    actorUserId: string;
    data: AccountProvisionInput;
  }): Promise<ProvisionedAccountSnapshot & { verificationDispatched: boolean }> {
    this.validateRoleScope(input.data.role, input.data.scopeType);
    await this.assertCanGrant({
      actorUserId: input.actorUserId,
      tenantId: input.data.tenantId,
      role: input.data.role,
      scopeType: input.data.scopeType,
      projectId: input.data.projectId ?? null,
      brokerCompanyId: input.data.brokerCompanyId ?? null,
    });

    const phone = this.normalizePhone(input.data.phone);
    const challengeId = randomUUID();
    const code = randomInt(100_000, 1_000_000).toString();
    const expiresAt = new Date(Date.now() + this.verificationTtlSeconds() * 1000);
    const created = await this.repository.provision({
      actorUserId: input.actorUserId,
      tenantId: input.data.tenantId,
      displayName: input.data.displayName,
      phoneIdentifierHmac: hmacSha256(phone, this.secret('AUTH_IDENTIFIER_HMAC_KEY')),
      contactCiphertext: encryptContactValue(phone, this.secret('CONTACT_ENCRYPTION_KEY_BASE64', false)),
      contactHmac: hmacSha256(phone, this.secret('CONTACT_HMAC_KEY')),
      contactDisplayHint: phoneDisplayHint(phone),
      role: input.data.role,
      scopeType: input.data.scopeType,
      projectId: input.data.projectId ?? null,
      brokerCompanyId: input.data.brokerCompanyId ?? null,
      challengeId,
      challengeDigest: this.verificationDigest(challengeId, code),
      channel: input.data.verificationChannel,
      expiresAt,
    });

    const verificationDispatched = await this.dispatchVerification({
      userId: created.userId,
      contactId: created.contactId,
      challengeId,
      code,
      channel: input.data.verificationChannel,
    });

    return {
      userId: created.userId,
      status: 'PENDING',
      contactDisplayHint: phoneDisplayHint(phone),
      verificationRequired: true,
      verificationChannel: input.data.verificationChannel,
      verificationDispatched,
    };
  }

  async resendVerification(input: {
    actorUserId: string;
    tenantId: string;
    userId: string;
    channel: 'WHATSAPP' | 'SMS';
  }): Promise<{ sent: boolean }> {
    await this.assertCanManageTarget(input.actorUserId, input.tenantId, input.userId);
    const target = await this.repository.pendingVerificationTarget({
      tenantId: input.tenantId,
      userId: input.userId,
    });
    if (!target) throw new NotFoundException('Pending phone verification was not found.');

    const challengeId = randomUUID();
    const code = randomInt(100_000, 1_000_000).toString();
    await this.repository.createVerificationChallenge({
      id: challengeId,
      userId: target.userId,
      contactId: target.contactId,
      aliasId: target.aliasId,
      channel: input.channel,
      digest: this.verificationDigest(challengeId, code),
      expiresAt: new Date(Date.now() + this.verificationTtlSeconds() * 1000),
    });
    const sent = await this.dispatchVerification({
      userId: target.userId,
      contactId: target.contactId,
      challengeId,
      code,
      channel: input.channel,
    });
    return { sent };
  }

  async verifyEnrollment(data: VerifyEnrollmentInput): Promise<{ verified: true }> {
    const phone = this.normalizePhone(data.phone);
    const now = new Date();
    const challenge = await this.repository.enrollmentChallenge(
      hmacSha256(phone, this.secret('AUTH_IDENTIFIER_HMAC_KEY')),
      now,
    );
    if (!challenge) throw new UnauthorizedException('The verification code is invalid or expired.');

    const candidate = this.verificationDigest(challenge.challenge_id, data.code);
    if (!secureDigestMatches(candidate, challenge.code_digest)) {
      await this.repository.decrementVerificationAttempt(challenge.challenge_id, now);
      throw new UnauthorizedException('The verification code is invalid or expired.');
    }

    await this.repository.completeEnrollment(challenge, now);
    return { verified: true };
  }

  async grantRole(input: { actorUserId: string; data: GrantAccountRoleInput }): Promise<{ assignmentId: string }> {
    this.validateRoleScope(input.data.role, input.data.scopeType);
    const targetExists = (await this.repository.listAccounts({
      tenantId: input.data.tenantId,
      brokerCompanyIds: null,
    })).some((account) => account.userId === input.data.userId);
    if (!targetExists) throw new NotFoundException('Account not found in this tenant.');

    await this.assertCanManageTarget(input.actorUserId, input.data.tenantId, input.data.userId);
    await this.assertCanGrant({
      actorUserId: input.actorUserId,
      tenantId: input.data.tenantId,
      role: input.data.role,
      scopeType: input.data.scopeType,
      projectId: input.data.projectId ?? null,
      brokerCompanyId: input.data.brokerCompanyId ?? null,
    });
    const assignmentId = await this.repository.grantRole({
      actorUserId: input.actorUserId,
      tenantId: input.data.tenantId,
      userId: input.data.userId,
      role: input.data.role,
      scopeType: input.data.scopeType,
      projectId: input.data.projectId ?? null,
      brokerCompanyId: input.data.brokerCompanyId ?? null,
    });
    return { assignmentId };
  }

  async revokeRole(input: {
    actorUserId: string;
    tenantId: string;
    assignmentId: string;
  }): Promise<{ revoked: true }> {
    const assignment = await this.repository.assignment(input.assignmentId);
    if (assignment.tenantId !== input.tenantId) throw new NotFoundException('Role assignment not found.');
    if (assignment.userId === input.actorUserId) {
      throw new ForbiddenException('Self-revocation is blocked in Account Center.');
    }
    await this.assertCanGrant({
      actorUserId: input.actorUserId,
      tenantId: input.tenantId,
      role: assignment.role,
      scopeType: assignment.scopeType,
      projectId: assignment.projectId,
      brokerCompanyId: assignment.brokerCompanyId,
    });
    await this.repository.revokeRole({
      assignmentId: input.assignmentId,
      actorUserId: input.actorUserId,
      now: new Date(),
    });
    return { revoked: true };
  }

  async setStatus(input: { actorUserId: string; data: AccountStatusInput }): Promise<{ updated: true }> {
    if (input.actorUserId === input.data.userId) {
      throw new ForbiddenException('Self-disable is blocked in Account Center.');
    }
    await this.access.assert({
      userId: input.actorUserId,
      permission: 'tenant.users.manage',
      context: { tenantId: input.data.tenantId },
    });
    const updated = await this.repository.setUserStatus({
      tenantId: input.data.tenantId,
      userId: input.data.userId,
      status: input.data.status,
      now: new Date(),
    });
    if (!updated) throw new NotFoundException('Verified account not found.');
    return { updated: true };
  }

  private async managementScope(actorUserId: string, tenantId: string): Promise<{
    tenantUserAdmin: boolean;
    brokerCompanyIds: string[];
  }> {
    const tenantDecision = await this.access.can({
      userId: actorUserId,
      permission: 'tenant.users.manage',
      context: { tenantId },
    });
    const assignments = await this.access.assignmentsForUser(actorUserId);
    const brokerCompanyIds = [...new Set(assignments
      .filter((assignment) =>
        assignment.tenantId === tenantId &&
        assignment.brokerCompanyId &&
        roleHasPermission(assignment.role, 'broker.users.manage'),
      )
      .map((assignment) => assignment.brokerCompanyId!))];
    return { tenantUserAdmin: tenantDecision.allowed, brokerCompanyIds };
  }

  private async assertCanManageTarget(actorUserId: string, tenantId: string, userId: string): Promise<void> {
    const management = await this.managementScope(actorUserId, tenantId);
    if (management.tenantUserAdmin) return;
    if (management.brokerCompanyIds.length === 0) throw new ForbiddenException('Account management is not allowed.');
    const visible = await this.repository.listAccounts({ tenantId, brokerCompanyIds: management.brokerCompanyIds });
    if (!visible.some((account) => account.userId === userId)) {
      throw new ForbiddenException('Account management is not allowed for this user.');
    }
  }

  private async assertCanGrant(input: {
    actorUserId: string;
    tenantId: string;
    role: RoleCode;
    scopeType: ScopeType;
    projectId: string | null;
    brokerCompanyId: string | null;
  }): Promise<void> {
    if (input.role === 'PRENEURA_SUPER_ADMIN' || input.scopeType === 'PLATFORM') {
      throw new ForbiddenException('Platform administration is not delegated through tenant Account Center.');
    }

    if (input.role === 'OPERATIONS_DIRECTOR' || input.role === 'BROKER_MANAGER') {
      await this.access.assert({
        userId: input.actorUserId,
        permission: 'tenant.users.manage',
        context: {
          tenantId: input.tenantId,
          ...(input.projectId ? { projectId: input.projectId } : {}),
        },
      });
      return;
    }

    if (input.scopeType === 'BROKER_COMPANY') {
      await this.access.assert({
        userId: input.actorUserId,
        permission: 'broker.users.manage',
        context: {
          tenantId: input.tenantId,
          ...(input.brokerCompanyId ? { brokerCompanyId: input.brokerCompanyId } : {}),
        },
      });
      return;
    }

    await this.access.assert({
      userId: input.actorUserId,
      permission: 'tenant.users.manage',
      context: {
        tenantId: input.tenantId,
        ...(input.projectId ? { projectId: input.projectId } : {}),
      },
    });
  }

  private validateRoleScope(role: RoleCode, scopeType: ScopeType): void {
    const expected: Partial<Record<RoleCode, ScopeType>> = {
      OPERATIONS_DIRECTOR: 'TENANT',
      MANAGER: 'PROJECT',
      SALES: 'PROJECT',
      QUEUE_RECEPTIONIST: 'PROJECT',
      ALLOCATOR: 'PROJECT',
      TRANSACTION_OPERATOR: 'PROJECT',
      BROKER_MANAGER: 'BROKER_COMPANY',
      BROKER_FINANCE: 'BROKER_COMPANY',
      BROKER_AGENT: 'BROKER_COMPANY',
    };
    const required = expected[role];
    if (!required) throw new BadRequestException('This role is provisioned through its dedicated business workflow.');
    if (required !== scopeType) throw new BadRequestException(`${role} requires ${required} scope.`);
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

  private async dispatchVerification(input: {
    userId: string;
    contactId: string;
    challengeId: string;
    code: string;
    channel: 'WHATSAPP' | 'SMS';
  }): Promise<boolean> {
    try {
      await this.delivery.send(input);
      await this.repository.markChallengeSent(input.challengeId, new Date());
      return true;
    } catch {
      return false;
    }
  }
}
