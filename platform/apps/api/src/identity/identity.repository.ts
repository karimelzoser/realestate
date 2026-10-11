import { Inject, Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import type { Database } from '@preneura/database';
import type {
  IdentityConsentPurpose,
  IdentityDocumentKind,
  IdentityDocumentStatus,
  IdentityProfileSnapshot,
} from '@preneura/contracts/identity';
import { DATABASE } from '../database/database.module.js';

interface IdentityProfileRow {
  document_kind: IdentityDocumentKind;
  document_country_code: string;
  document_display_hint: string;
  status: IdentityDocumentStatus;
  declared_at: Date;
  reviewed_at: Date | null;
  verified_at: Date | null;
}

interface RecoveryTargetRow {
  user_id: string;
  contact_id: string;
}

@Injectable()
export class IdentityRepository {
  constructor(@Inject(DATABASE) private readonly db: Kysely<Database>) {}

  async assertActiveMembership(input: { tenantId: string; userId: string }): Promise<void> {
    const result = await sql<{ ok: boolean }>`
      SELECT true AS ok
      FROM tenant_memberships tm
      JOIN tenants t ON t.id = tm.tenant_id
      JOIN users u ON u.id = tm.user_id
      WHERE tm.tenant_id = ${input.tenantId}::uuid
        AND tm.user_id = ${input.userId}::uuid
        AND tm.status = 'ACTIVE'
        AND t.status = 'ACTIVE'
        AND u.status = 'ACTIVE'
      LIMIT 1
    `.execute(this.db);
    if (!result.rows[0]) throw new Error('ACTIVE_MEMBERSHIP_REQUIRED');
  }

  async snapshot(input: { tenantId: string; userId: string }): Promise<IdentityProfileSnapshot> {
    const profileResult = await sql<IdentityProfileRow>`
      SELECT document_kind, document_country_code, document_display_hint,
             status, declared_at, reviewed_at, verified_at
      FROM identity_profiles
      WHERE tenant_id = ${input.tenantId}::uuid
        AND user_id = ${input.userId}::uuid
    `.execute(this.db);

    const phoneResult = await sql<{ verified: boolean }>`
      SELECT EXISTS (
        SELECT 1 FROM auth_delivery_contacts
        WHERE user_id = ${input.userId}::uuid
          AND kind = 'PHONE'
          AND is_primary = true
          AND verified_at IS NOT NULL
      ) AS verified
    `.execute(this.db);

    const consentResult = await sql<{
      purpose: IdentityConsentPurpose;
      action: 'GRANTED' | 'REVOKED';
      policy_version: string;
      created_at: Date;
    }>`
      SELECT DISTINCT ON (purpose) purpose, action, policy_version, created_at
      FROM identity_consent_events
      WHERE tenant_id = ${input.tenantId}::uuid
        AND user_id = ${input.userId}::uuid
      ORDER BY purpose, created_at DESC, id DESC
    `.execute(this.db);

    const consentByPurpose = new Map(consentResult.rows.map((row) => [row.purpose, row]));
    const purposes: IdentityConsentPurpose[] = ['IDENTITY_PROCESSING', 'ACCOUNT_RECOVERY'];
    const profile = profileResult.rows[0];

    return {
      tenantId: input.tenantId,
      userId: input.userId,
      phonePossessionVerified: phoneResult.rows[0]?.verified ?? false,
      document: profile
        ? {
            kind: profile.document_kind,
            countryCode: profile.document_country_code,
            displayHint: profile.document_display_hint,
            status: profile.status,
            declaredAt: profile.declared_at.toISOString(),
            reviewedAt: profile.reviewed_at?.toISOString() ?? null,
            verifiedAt: profile.verified_at?.toISOString() ?? null,
          }
        : null,
      consents: purposes.map((purpose) => {
        const row = consentByPurpose.get(purpose);
        return {
          purpose,
          granted: row?.action === 'GRANTED',
          policyVersion: row?.policy_version ?? null,
          changedAt: row?.created_at.toISOString() ?? null,
        };
      }),
      verificationSemantics: {
        phoneOtpProves: 'PHONE_POSSESSION',
        phoneOtpDoesNotProve: 'NATIONAL_ID_OR_PASSPORT_OWNERSHIP',
      },
    };
  }

  async declareDocument(input: {
    tenantId: string;
    userId: string;
    kind: IdentityDocumentKind;
    countryCode: string;
    documentHmac: Uint8Array;
    displayHint: string;
    consentPolicyVersion: string;
  }): Promise<void> {
    await this.db.transaction().execute(async (trx) => {
      const current = await sql<{ status: IdentityDocumentStatus }>`
        SELECT status FROM identity_profiles
        WHERE tenant_id = ${input.tenantId}::uuid AND user_id = ${input.userId}::uuid
        FOR UPDATE
      `.execute(trx);
      const status = current.rows[0]?.status;
      if (status === 'REVIEWED' || status === 'EXTERNAL_VERIFIED') {
        throw new Error('DOCUMENT_LOCKED_AFTER_VERIFICATION');
      }

      await sql`
        INSERT INTO identity_consent_events
          (tenant_id, user_id, purpose, action, policy_version, actor_user_id, source)
        VALUES
          (${input.tenantId}::uuid, ${input.userId}::uuid, 'IDENTITY_PROCESSING', 'GRANTED',
           ${input.consentPolicyVersion}, ${input.userId}::uuid, 'SELF_SERVICE')
      `.execute(trx);

      await sql`
        INSERT INTO identity_profiles
          (tenant_id, user_id, document_kind, document_country_code, document_hmac,
           document_display_hint, status, declared_at, reviewed_at, verified_at,
           reviewed_by, verification_provider, verification_reference_hmac, updated_at)
        VALUES
          (${input.tenantId}::uuid, ${input.userId}::uuid, ${input.kind}, ${input.countryCode},
           ${input.documentHmac}, ${input.displayHint}, 'DECLARED', now(), NULL, NULL,
           NULL, NULL, NULL, now())
        ON CONFLICT (tenant_id, user_id) DO UPDATE SET
          document_kind = EXCLUDED.document_kind,
          document_country_code = EXCLUDED.document_country_code,
          document_hmac = EXCLUDED.document_hmac,
          document_display_hint = EXCLUDED.document_display_hint,
          status = 'DECLARED',
          declared_at = now(),
          reviewed_at = NULL,
          verified_at = NULL,
          reviewed_by = NULL,
          verification_provider = NULL,
          verification_reference_hmac = NULL,
          updated_at = now()
      `.execute(trx);

      await sql`
        INSERT INTO identity_verification_events
          (tenant_id, user_id, assertion_type, document_kind, actor_user_id, evidence_source, metadata)
        VALUES
          (${input.tenantId}::uuid, ${input.userId}::uuid, 'DOCUMENT_DECLARED', ${input.kind},
           ${input.userId}::uuid, 'SELF_SERVICE', jsonb_build_object('countryCode', ${input.countryCode}))
      `.execute(trx);
    });
  }

  async recordConsent(input: {
    tenantId: string;
    userId: string;
    purpose: IdentityConsentPurpose;
    action: 'GRANTED' | 'REVOKED';
    policyVersion: string;
  }): Promise<void> {
    await sql`
      INSERT INTO identity_consent_events
        (tenant_id, user_id, purpose, action, policy_version, actor_user_id, source)
      VALUES
        (${input.tenantId}::uuid, ${input.userId}::uuid, ${input.purpose}, ${input.action},
         ${input.policyVersion}, ${input.userId}::uuid, 'SELF_SERVICE')
    `.execute(this.db);
  }

  async reviewDocument(input: {
    tenantId: string;
    userId: string;
    actorUserId: string;
    decision: 'REVIEWED' | 'REJECTED';
    note?: string;
  }): Promise<void> {
    await this.db.transaction().execute(async (trx) => {
      const result = await sql<{ document_kind: IdentityDocumentKind }>`
        UPDATE identity_profiles
        SET status = ${input.decision}, reviewed_at = now(), verified_at = NULL,
            reviewed_by = ${input.actorUserId}::uuid, verification_provider = NULL,
            verification_reference_hmac = NULL, updated_at = now()
        WHERE tenant_id = ${input.tenantId}::uuid
          AND user_id = ${input.userId}::uuid
          AND status IN ('DECLARED','REJECTED')
        RETURNING document_kind
      `.execute(trx);
      const row = result.rows[0];
      if (!row) throw new Error('IDENTITY_PROFILE_NOT_REVIEWABLE');

      await sql`
        INSERT INTO identity_verification_events
          (tenant_id, user_id, assertion_type, document_kind, actor_user_id, evidence_source, metadata)
        VALUES
          (${input.tenantId}::uuid, ${input.userId}::uuid,
           ${input.decision === 'REVIEWED' ? 'DOCUMENT_REVIEWED' : 'DOCUMENT_REJECTED'},
           ${row.document_kind}, ${input.actorUserId}::uuid, 'TENANT_ADMIN_REVIEW',
           ${JSON.stringify(input.note ? { note: input.note } : {})}::jsonb)
      `.execute(trx);
    });
  }

  async countRecoveryChallengesSince(input: {
    tenantId: string;
    kind: IdentityDocumentKind;
    documentHmac: Uint8Array;
    since: Date;
  }): Promise<number> {
    const result = await sql<{ count: string }>`
      SELECT count(*)::text AS count
      FROM identity_recovery_challenges
      WHERE tenant_id = ${input.tenantId}::uuid
        AND requested_document_kind = ${input.kind}
        AND requested_document_hmac = ${input.documentHmac}
        AND created_at >= ${input.since}
    `.execute(this.db);
    return Number(result.rows[0]?.count ?? 0);
  }

  async findRecoveryTarget(input: {
    tenantId: string;
    kind: IdentityDocumentKind;
    documentHmac: Uint8Array;
  }): Promise<RecoveryTargetRow | null> {
    const result = await sql<RecoveryTargetRow>`
      SELECT ip.user_id, adc.id AS contact_id
      FROM identity_profiles ip
      JOIN tenant_memberships tm
        ON tm.tenant_id = ip.tenant_id AND tm.user_id = ip.user_id AND tm.status = 'ACTIVE'
      JOIN tenants t ON t.id = ip.tenant_id AND t.status = 'ACTIVE'
      JOIN users u ON u.id = ip.user_id AND u.status = 'ACTIVE'
      JOIN auth_delivery_contacts adc
        ON adc.user_id = ip.user_id
       AND adc.kind = 'PHONE'
       AND adc.is_primary = true
       AND adc.verified_at IS NOT NULL
      WHERE ip.tenant_id = ${input.tenantId}::uuid
        AND ip.document_kind = ${input.kind}
        AND ip.document_hmac = ${input.documentHmac}
        AND ip.status IN ('DECLARED','REVIEWED','EXTERNAL_VERIFIED')
        AND EXISTS (
          SELECT 1 FROM identity_consent_events ice
          WHERE ice.tenant_id = ip.tenant_id
            AND ice.user_id = ip.user_id
            AND ice.purpose = 'ACCOUNT_RECOVERY'
          ORDER BY ice.created_at DESC, ice.id DESC
          LIMIT 1
        )
        AND (
          SELECT ice.action FROM identity_consent_events ice
          WHERE ice.tenant_id = ip.tenant_id
            AND ice.user_id = ip.user_id
            AND ice.purpose = 'ACCOUNT_RECOVERY'
          ORDER BY ice.created_at DESC, ice.id DESC
          LIMIT 1
        ) = 'GRANTED'
      LIMIT 1
    `.execute(this.db);
    return result.rows[0] ?? null;
  }

  async createRecoveryChallenge(input: {
    id: string;
    tenantId: string;
    userId: string | null;
    contactId: string | null;
    kind: IdentityDocumentKind;
    documentHmac: Uint8Array;
    channel: 'SMS' | 'WHATSAPP';
    codeDigest: Uint8Array;
    attemptsRemaining: number;
    expiresAt: Date;
  }): Promise<void> {
    await sql`
      INSERT INTO identity_recovery_challenges
        (id, tenant_id, user_id, contact_id, requested_document_kind, requested_document_hmac,
         channel, code_digest, attempts_remaining, expires_at)
      VALUES
        (${input.id}::uuid, ${input.tenantId}::uuid, ${input.userId}::uuid,
         ${input.contactId}::uuid, ${input.kind}, ${input.documentHmac}, ${input.channel},
         ${input.codeDigest}, ${input.attemptsRemaining}, ${input.expiresAt})
    `.execute(this.db);
  }

  async markRecoverySent(challengeId: string): Promise<void> {
    await sql`
      UPDATE identity_recovery_challenges SET sent_at = now()
      WHERE id = ${challengeId}::uuid AND sent_at IS NULL
    `.execute(this.db);
  }

  async consumeRecoveryChallenge(input: {
    challengeId: string;
    codeDigest: Uint8Array;
    at: Date;
  }): Promise<{ userId: string; tenantId: string } | null> {
    return this.db.transaction().execute(async (trx) => {
      const result = await sql<{
        user_id: string | null;
        tenant_id: string;
        code_digest: Uint8Array;
        attempts_remaining: number;
        expires_at: Date;
        consumed_at: Date | null;
      }>`
        SELECT user_id, tenant_id, code_digest, attempts_remaining, expires_at, consumed_at
        FROM identity_recovery_challenges
        WHERE id = ${input.challengeId}::uuid
        FOR UPDATE
      `.execute(trx);
      const row = result.rows[0];
      if (!row || row.consumed_at || row.expires_at <= input.at || row.attempts_remaining <= 0) return null;

      const matches = Buffer.from(row.code_digest).equals(Buffer.from(input.codeDigest));
      if (!matches || !row.user_id) {
        await sql`
          UPDATE identity_recovery_challenges
          SET attempts_remaining = greatest(0, attempts_remaining - 1)
          WHERE id = ${input.challengeId}::uuid
        `.execute(trx);
        return null;
      }

      await sql`
        UPDATE identity_recovery_challenges SET consumed_at = ${input.at}
        WHERE id = ${input.challengeId}::uuid
      `.execute(trx);
      return { userId: row.user_id, tenantId: row.tenant_id };
    });
  }

  async recordVerificationEvent(input: {
    tenantId: string;
    userId: string;
    assertionType: 'RECOVERY_CHALLENGE_CREATED' | 'RECOVERY_CHALLENGE_VERIFIED' | 'RECOVERY_CHALLENGE_REJECTED';
    evidenceSource: string;
    actorUserId?: string | null;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    await sql`
      INSERT INTO identity_verification_events
        (tenant_id, user_id, assertion_type, actor_user_id, evidence_source, metadata)
      VALUES
        (${input.tenantId}::uuid, ${input.userId}::uuid, ${input.assertionType},
         ${input.actorUserId ?? null}::uuid, ${input.evidenceSource},
         ${JSON.stringify(input.metadata ?? {})}::jsonb)
    `.execute(this.db);
  }
}
