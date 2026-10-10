import { ConflictException, Inject, Injectable } from '@nestjs/common';
import type { Database } from '@preneura/database';
import { sql, type Kysely } from 'kysely';
import { DATABASE } from '../database/database.module.js';

@Injectable()
export class SalesBuyerOnboardingRepository {
  constructor(@Inject(DATABASE) private readonly db: Kysely<Database>) {}

  async provision(input: {
    actorUserId: string;
    tenantId: string;
    projectId: string;
    displayName: string;
    source: 'DIRECT' | 'INTERNAL';
    phoneIdentifierHmac: Uint8Array;
    contactCiphertext: Uint8Array;
    contactHmac: Uint8Array;
    contactDisplayHint: string;
    challengeId: string;
    challengeDigest: Uint8Array;
    channel: 'WHATSAPP' | 'SMS';
    expiresAt: Date;
  }): Promise<{ userId: string; buyerProfileId: string; contactId: string }> {
    try {
      return await this.db.transaction().execute(async (trx) => {
        const project = await trx
          .selectFrom('projects')
          .select('id')
          .where('id', '=', input.projectId)
          .where('tenant_id', '=', input.tenantId)
          .where('status', 'in', ['DRAFT', 'ACTIVE', 'PAUSED'])
          .forShare()
          .executeTakeFirst();
        if (!project) throw new ConflictException('Project is not available for buyer onboarding.');

        const user = await trx
          .insertInto('users')
          .values({ display_name: input.displayName, status: 'PENDING' })
          .returning('id')
          .executeTakeFirstOrThrow();

        await trx
          .insertInto('tenant_memberships')
          .values({ tenant_id: input.tenantId, user_id: user.id, status: 'INVITED' })
          .execute();

        const aliasResult = await sql<{ id: string }>`
          INSERT INTO auth_login_aliases (user_id, kind, identifier_hmac, verified_at)
          VALUES (${user.id}::uuid, 'PHONE', ${input.phoneIdentifierHmac}, NULL)
          RETURNING id
        `.execute(trx);
        const aliasId = aliasResult.rows[0]?.id;
        if (!aliasId) throw new Error('Unable to create buyer phone login alias.');

        const contactResult = await sql<{ id: string }>`
          INSERT INTO auth_delivery_contacts (
            user_id, kind, value_ciphertext, value_hmac, verified_at, is_primary, display_hint
          ) VALUES (
            ${user.id}::uuid, 'PHONE', ${input.contactCiphertext}, ${input.contactHmac},
            NULL, true, ${input.contactDisplayHint}
          )
          RETURNING id
        `.execute(trx);
        const contactId = contactResult.rows[0]?.id;
        if (!contactId) throw new Error('Unable to create buyer delivery contact.');

        await trx
          .insertInto('access_role_assignments')
          .values({
            user_id: user.id,
            role_code: 'BUYER',
            scope_type: 'PROJECT',
            tenant_id: input.tenantId,
            project_id: input.projectId,
            broker_company_id: null,
            status: 'ACTIVE',
            granted_by: input.actorUserId,
            revoked_at: null,
          })
          .execute();

        const buyer = await trx
          .insertInto('buyer_profiles')
          .values({
            tenant_id: input.tenantId,
            user_id: user.id,
            status: 'ACTIVE',
            source: input.source,
            broker_company_id: null,
            broker_agent_user_id: null,
            created_by: input.actorUserId,
          })
          .returning('id')
          .executeTakeFirstOrThrow();

        await sql`
          INSERT INTO auth_contact_verification_challenges (
            id, user_id, contact_id, alias_id, channel, code_digest,
            attempts_remaining, expires_at
          ) VALUES (
            ${input.challengeId}::uuid, ${user.id}::uuid, ${contactId}::uuid,
            ${aliasId}::uuid, ${input.channel}, ${input.challengeDigest}, 5,
            ${input.expiresAt}
          )
        `.execute(trx);

        await trx.insertInto('auth_security_events').values({
          user_id: user.id,
          event_type: 'SALES_BUYER_INVITED',
          result: 'SUCCESS',
          challenge_id: input.challengeId,
          session_id: null,
          request_id: null,
          ip_digest: null,
          user_agent_digest: null,
          metadata: {
            tenantId: input.tenantId,
            projectId: input.projectId,
            actorUserId: input.actorUserId,
          },
        }).execute();

        await trx.insertInto('domain_outbox_events').values({
          tenant_id: input.tenantId,
          project_id: input.projectId,
          aggregate_type: 'BUYER_PROFILE',
          aggregate_id: buyer.id,
          event_type: 'buyer.invited',
          payload: {
            buyerUserId: user.id,
            source: input.source,
            actorUserId: input.actorUserId,
          },
          published_at: null,
          attempts: 0,
        }).execute();

        return { userId: user.id, buyerProfileId: buyer.id, contactId };
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException('That phone number is already associated with a PRENEURA account.');
      }
      throw error;
    }
  }

  async markChallengeSent(challengeId: string, at: Date): Promise<void> {
    await sql`
      UPDATE auth_contact_verification_challenges
      SET sent_at = COALESCE(sent_at, ${at})
      WHERE id = ${challengeId}::uuid
    `.execute(this.db);
  }
}

function isUniqueViolation(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === '23505');
}
