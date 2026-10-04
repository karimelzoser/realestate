import { Inject, Injectable } from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { Database, JsonValue } from '@preneura/database';

export const DATABASE = Symbol('DATABASE');

export type AliasKind = 'PHONE' | 'NATIONAL_ID';
export type DeliveryChannel = 'SMS' | 'WHATSAPP';

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
}

export abstract class AuthRepository {
  abstract findActiveUserByAlias(kind: AliasKind, identifierHmac: Uint8Array): Promise<string | null>;
  abstract createChallenge(challenge: NewChallenge): Promise<void>;
  abstract markDeliveryAttempted(challengeId: string): Promise<void>;
  abstract consumeChallenge(challengeId: string, otpDigest: Uint8Array, now: Date): Promise<string | null>;
  abstract decrementChallengeAttempt(challengeId: string, now: Date): Promise<void>;
  abstract createSession(session: SessionRecord): Promise<void>;
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
    await this.db
      .insertInto('auth_sessions')
      .values({
        id: session.id,
        user_id: session.userId,
        token_digest: session.tokenDigest,
        expires_at: session.expiresAt,
        revoked_at: null,
      })
      .executeTakeFirstOrThrow();
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
