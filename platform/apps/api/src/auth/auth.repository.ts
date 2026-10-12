import { Inject, Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import type { Database, JsonValue } from '@preneura/database';
import { DATABASE } from '../database/database.module.js';
import type { SessionAssuranceEvidence } from './auth-assurance.js';

export type AliasKind = 'PHONE' | 'NATIONAL_ID';
export type DeliveryChannel = 'SMS' | 'WHATSAPP';
export type ExternalIdentityLinkResult = 'LINKED' | 'ALREADY_LINKED' | 'CONFLICT' | 'ENROLLMENT_REQUIRED';

export interface NewChallenge {
  id: string;
  userId: string | null;
  requestedKind: AliasKind;
  requestedIdentifierHmac: Uint8Array;
  otpDigest: Uint8Array;
  deliveryChannel: DeliveryChannel;
  attemptsRemaining: number;
  expiresAt: Date;
}

export interface SessionRecord {
  id: string;
  userId: string;
  tokenDigest: Uint8Array;
  expiresAt: Date;
  assurance: SessionAssuranceEvidence;
}

export interface ResolvedSession {
  sessionId: string;
  userId: string;
  userStatus: 'ACTIVE' | 'DISABLED' | 'PENDING';
  expiresAt: Date;
  authMethod: 'OTP' | 'OIDC_GOOGLE';
  assuranceLevel: 'AAL1' | 'AAL2';
  assuranceVerifiedAt: Date | null;
}

export interface ExternalIdentityResult {
  userId: string;
  status: 'ACTIVE' | 'DISABLED' | 'PENDING';
}

export abstract class AuthRepository {
  abstract findActiveUserByAlias(kind: AliasKind, identifierHmac: Uint8Array): Promise<string | null>;
  abstract countChallengesSince(kind: AliasKind, identifierHmac: Uint8Array, since: Date): Promise<number>;
  abstract findOrProvisionExternalIdentity(input: {
    provider: string;
    issuer: string;
    providerSubject: string;
    displayName: string;
    verifiedEmail?: string | null;
  }): Promise<ExternalIdentityResult>;
  abstract linkExternalIdentityToUser(input: {
    userId: string;
    provider: string;
    issuer: string;
    providerSubject: string;
    verifiedEmail?: string | null;
    allowNewLink?: boolean;
  }): Promise<ExternalIdentityLinkResult>;
  abstract createChallenge(challenge: NewChallenge): Promise<void>;
  abstract markDeliveryAttempted(challengeId: string): Promise<void>;
  abstract consumeChallenge(challengeId: string, otpDigest: Uint8Array, now: Date): Promise<string | null>;
  abstract decrementChallengeAttempt(challengeId: string, now: Date): Promise<void>;
  abstract createSession(session: SessionRecord): Promise<void>;
  abstract resolveSession(tokenDigest: Uint8Array, now: Date): Promise<ResolvedSession | null>;
  abstract userRequiresPrivilegedAssurance(userId: string): Promise<boolean>;
  abstract revokeSession(sessionId: string, now: Date): Promise<void>;
  abstract recordEvent(input: {
    userId?: string | null;
    eventType: string;
    result: 'SUCCESS' | 'REJECTED' | 'FAILED';
    challengeId?: string | null;
    sessionId?: string | null;
    metadata?: Record<string, JsonValue>;
  }): Promise<void>;
}

@Injectable()
export class PostgresAuthRepository extends AuthRepository {
  constructor(@Inject(DATABASE) private readonly db: Kysely<Database>) {
    super();
  }

  async findActiveUserByAlias(kind: AliasKind, identifierHmac: Uint8Array): Promise<string | null> {
    const row = await this.db
      .selectFrom('auth_login_aliases as alias')
      .innerJoin('users as user', 'user.id', 'alias.user_id')
      .select('alias.user_id')
      .where('alias.kind', '=', kind)
      .where('alias.identifier_hmac', '=', identifierHmac)
      .where('user.status', '=', 'ACTIVE')
      .executeTakeFirst();
    return row?.user_id ?? null;
  }

  async countChallengesSince(kind: AliasKind, identifierHmac: Uint8Array, since: Date): Promise<number> {
    const row = await this.db
      .selectFrom('auth_otp_challenges')
      .select((eb) => eb.fn.countAll<number>().as('count'))
      .where('requested_kind', '=', kind)
      .where('requested_identifier_hmac', '=', identifierHmac)
      .where('created_at', '>=', since)
      .executeTakeFirstOrThrow();
    return Number(row.count);
  }

  async findOrProvisionExternalIdentity(input: {
    provider: string;
    issuer: string;
    providerSubject: string;
    displayName: string;
    verifiedEmail?: string | null;
  }): Promise<ExternalIdentityResult> {
    const existing = await this.db
      .selectFrom('auth_external_identities as identity')
      .innerJoin('users as user', 'user.id', 'identity.user_id')
      .select(['identity.user_id', 'user.status'])
      .where('identity.provider', '=', input.provider)
      .where('identity.issuer', '=', input.issuer)
      .where('identity.provider_subject', '=', input.providerSubject)
      .executeTakeFirst();

    if (existing) {
      return { userId: existing.user_id, status: existing.status };
    }

    return this.db.transaction().execute(async (trx) => {
      const createdUser = await trx
        .insertInto('users')
        .values({
          display_name: input.displayName || 'PRENEURA User',
          status: 'PENDING',
        })
        .returning(['id', 'status'])
        .executeTakeFirstOrThrow();

      const linked = await trx
        .insertInto('auth_external_identities')
        .values({
          user_id: createdUser.id,
          provider: input.provider,
          issuer: input.issuer,
          provider_subject: input.providerSubject,
          email_at_link_time: input.verifiedEmail ?? null,
        })
        .onConflict((oc) => oc.doNothing())
        .returning('user_id')
        .executeTakeFirst();

      if (linked) {
        return { userId: createdUser.id, status: createdUser.status };
      }

      await trx.deleteFrom('users').where('id', '=', createdUser.id).execute();
      const winner = await trx
        .selectFrom('auth_external_identities as identity')
        .innerJoin('users as user', 'user.id', 'identity.user_id')
        .select(['identity.user_id', 'user.status'])
        .where('identity.provider', '=', input.provider)
      .where('identity.issuer', '=', input.issuer)
        .where('identity.provider_subject', '=', input.providerSubject)
        .executeTakeFirstOrThrow();

      return { userId: winner.user_id, status: winner.status };
    });
  }

  async linkExternalIdentityToUser(input: {
    userId: string;
    provider: string;
    issuer: string;
    providerSubject: string;
    verifiedEmail?: string | null;
    allowNewLink?: boolean;
  }): Promise<ExternalIdentityLinkResult> {
    return this.db.transaction().execute(async (trx) => {
      const subjectOwner = await trx
        .selectFrom('auth_external_identities')
        .select('user_id')
        .where('provider', '=', input.provider)
        .where('issuer', '=', input.issuer)
        .where('provider_subject', '=', input.providerSubject)
        .executeTakeFirst();
      if (subjectOwner) {
        return subjectOwner.user_id === input.userId ? 'ALREADY_LINKED' : 'CONFLICT';
      }

      const existingForUser = await trx
        .selectFrom('auth_external_identities')
        .select('provider_subject')
        .where('provider', '=', input.provider)
        .where('issuer', '=', input.issuer)
        .where('user_id', '=', input.userId)
        .executeTakeFirst();
      if (existingForUser) {
        return existingForUser.provider_subject === input.providerSubject
          ? 'ALREADY_LINKED'
          : 'CONFLICT';
      }

      // Possession of a phone OTP and MFA on an unrelated IdP account must not
      // enroll a new privileged factor. Only an authorized enrollment path may
      // permit first-time linking; ordinary step-up requires an existing binding.
      if (input.allowNewLink !== true) return 'ENROLLMENT_REQUIRED';

      const inserted = await trx
        .insertInto('auth_external_identities')
        .values({
          user_id: input.userId,
          provider: input.provider,
          issuer: input.issuer,
          provider_subject: input.providerSubject,
          email_at_link_time: input.verifiedEmail ?? null,
        })
        .onConflict((oc) => oc.doNothing())
        .returning('user_id')
        .executeTakeFirst();

      if (inserted) return 'LINKED';

      const winner = await trx
        .selectFrom('auth_external_identities')
        .select('user_id')
        .where('provider', '=', input.provider)
        .where('issuer', '=', input.issuer)
        .where('provider_subject', '=', input.providerSubject)
        .executeTakeFirst();
      return winner?.user_id === input.userId ? 'ALREADY_LINKED' : 'CONFLICT';
    });
  }

  async createChallenge(challenge: NewChallenge): Promise<void> {
    await this.db
      .insertInto('auth_otp_challenges')
      .values({
        id: challenge.id,
        user_id: challenge.userId,
        requested_kind: challenge.requestedKind,
        requested_identifier_hmac: challenge.requestedIdentifierHmac,
        otp_digest: challenge.otpDigest,
        delivery_channel: challenge.deliveryChannel,
        attempts_remaining: challenge.attemptsRemaining,
        expires_at: challenge.expiresAt,
        consumed_at: null,
      })
      .executeTakeFirstOrThrow();
  }

  async markDeliveryAttempted(challengeId: string): Promise<void> {
    await this.db
      .updateTable('auth_otp_challenges')
      .set({ delivery_attempted: true })
      .where('id', '=', challengeId)
      .execute();
  }

  async consumeChallenge(challengeId: string, otpDigest: Uint8Array, now: Date): Promise<string | null> {
    const row = await this.db
      .updateTable('auth_otp_challenges')
      .set({ consumed_at: now })
      .where('id', '=', challengeId)
      .where('otp_digest', '=', otpDigest)
      .where('consumed_at', 'is', null)
      .where('expires_at', '>', now)
      .where('attempts_remaining', '>', 0)
      .returning('user_id')
      .executeTakeFirst();
    return row?.user_id ?? null;
  }

  async decrementChallengeAttempt(challengeId: string, now: Date): Promise<void> {
    await this.db
      .updateTable('auth_otp_challenges')
      .set((eb) => ({ attempts_remaining: eb('attempts_remaining', '-', 1) }))
      .where('id', '=', challengeId)
      .where('consumed_at', 'is', null)
      .where('expires_at', '>', now)
      .where('attempts_remaining', '>', 0)
      .execute();
  }

  async createSession(session: SessionRecord): Promise<void> {
    await this.db.transaction().execute(async (trx) => {
      await trx
        .insertInto('auth_sessions')
        .values({
          id: session.id,
          user_id: session.userId,
          token_digest: session.tokenDigest,
          expires_at: session.expiresAt,
          revoked_at: null,
        })
        .executeTakeFirstOrThrow();

      await sql`
        INSERT INTO auth_session_assurance (
          session_id, auth_method, assurance_level, provider_acr, provider_amr, verified_at
        ) VALUES (
          ${session.id}::uuid,
          ${session.assurance.authMethod},
          ${session.assurance.assuranceLevel},
          ${session.assurance.providerAcr ?? null},
          ${JSON.stringify(session.assurance.providerAmr ?? [])}::jsonb,
          now()
        )
      `.execute(trx);
    });
  }

  async resolveSession(tokenDigest: Uint8Array, now: Date): Promise<ResolvedSession | null> {
    const row = await this.db
      .selectFrom('auth_sessions as session')
      .innerJoin('users as user', 'user.id', 'session.user_id')
      .select([
        'session.id as session_id',
        'session.user_id',
        'session.expires_at',
        'user.status as user_status',
      ])
      .where('session.token_digest', '=', tokenDigest)
      .where('session.revoked_at', 'is', null)
      .where('session.expires_at', '>', now)
      .executeTakeFirst();

    if (!row || row.user_status === 'DISABLED') return null;

    const assuranceResult = await sql<{
      auth_method: 'OTP' | 'OIDC_GOOGLE';
      assurance_level: 'AAL1' | 'AAL2';
      verified_at: Date;
    }>`
      SELECT auth_method, assurance_level, verified_at
      FROM auth_session_assurance
      WHERE session_id = ${row.session_id}::uuid
    `.execute(this.db);
    const assurance = assuranceResult.rows[0];

    return {
      sessionId: row.session_id,
      userId: row.user_id,
      userStatus: row.user_status,
      expiresAt: row.expires_at as Date,
      authMethod: assurance?.auth_method ?? 'OTP',
      assuranceLevel: assurance?.assurance_level ?? 'AAL1',
      assuranceVerifiedAt: assurance?.verified_at ?? null,
    };
  }

  async userRequiresPrivilegedAssurance(userId: string): Promise<boolean> {
    const row = await this.db
      .selectFrom('access_role_assignments')
      .select('id')
      .where('user_id', '=', userId)
      .where('status', '=', 'ACTIVE')
      .where('revoked_at', 'is', null)
      .where('role_code', 'in', [
        'PRENEURA_SUPER_ADMIN',
        'OPERATIONS_DIRECTOR',
        'MANAGER',
        'ALLOCATOR',
        'TRANSACTION_OPERATOR',
        'BROKER_MANAGER',
        'BROKER_FINANCE',
      ])
      .limit(1)
      .executeTakeFirst();
    return Boolean(row);
  }

  async revokeSession(sessionId: string, now: Date): Promise<void> {
    await this.db
      .updateTable('auth_sessions')
      .set({ revoked_at: now })
      .where('id', '=', sessionId)
      .where('revoked_at', 'is', null)
      .execute();
  }

  async recordEvent(input: {
    userId?: string | null;
    eventType: string;
    result: 'SUCCESS' | 'REJECTED' | 'FAILED';
    challengeId?: string | null;
    sessionId?: string | null;
    metadata?: Record<string, JsonValue>;
  }): Promise<void> {
    await this.db
      .insertInto('auth_security_events')
      .values({
        user_id: input.userId ?? null,
        event_type: input.eventType,
        result: input.result,
        challenge_id: input.challengeId ?? null,
        session_id: input.sessionId ?? null,
        request_id: null,
        ip_digest: null,
        user_agent_digest: null,
        metadata: input.metadata ?? {},
      })
      .executeTakeFirstOrThrow();
  }
}
