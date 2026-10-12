import { Inject, Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import type { Database } from '@preneura/database';
import { DATABASE } from '../database/database.module.js';

export interface EnrollmentProof {
  issuer: string;
  subject: string;
  verifiedEmail: string | null;
  acr: string | null;
  amr: string[];
  tokenSha256: string;
}
export interface EnrollmentSnapshot {
  id: string;
  userId: string;
  displayName: string;
  issuer: string;
  subject: string;
  verifiedEmail: string | null;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'EXPIRED';
  expiresAt: string;
  createdAt: string;
  decisionNote: string | null;
}

@Injectable()
export class IdentityEnrollmentRepository {
  constructor(@Inject(DATABASE) private readonly db: Kysely<Database>) {}

  async submit(userId: string, baseSessionId: string, proof: EnrollmentProof): Promise<string> {
    return this.db.transaction().execute(async (trx) => {
      await sql`SELECT id FROM users WHERE id=${userId}::uuid FOR NO KEY UPDATE`.execute(trx);
      await sql`UPDATE auth_identity_enrollment_requests SET status='EXPIRED'
        WHERE user_id=${userId}::uuid AND status='PENDING' AND expires_at<=now()`.execute(trx);
      const pending = await sql<{ id: string; issuer: string; provider_subject: string }>`
        SELECT id,issuer,provider_subject FROM auth_identity_enrollment_requests
        WHERE user_id=${userId}::uuid AND status='PENDING' FOR UPDATE`.execute(trx);
      if (pending.rows[0]) {
        if (pending.rows[0].issuer !== proof.issuer || pending.rows[0].provider_subject !== proof.subject) {
          throw new Error('ENROLLMENT_PENDING_DIFFERENT_IDENTITY');
        }
        return pending.rows[0].id;
      }
      // Verified proof enters only through the server's OIDC callback, never a
      // client-supplied issuer/subject or an email match.
      const inserted = await sql<{ id: string }>`INSERT INTO auth_identity_enrollment_requests
        (user_id,base_session_id,provider,issuer,provider_subject,verified_email,provider_acr,provider_amr,id_token_sha256)
        VALUES (${userId}::uuid,${baseSessionId}::uuid,'google',${proof.issuer},${proof.subject},${proof.verifiedEmail},
          ${proof.acr},${JSON.stringify(proof.amr)}::jsonb,${proof.tokenSha256}) RETURNING id`.execute(trx);
      await sql`INSERT INTO auth_security_events(user_id,event_type,result,session_id,metadata)
        VALUES (${userId}::uuid,'IDENTITY_ENROLLMENT_REQUESTED','SUCCESS',${baseSessionId}::uuid,
          jsonb_build_object('requestId',${inserted.rows[0]!.id}::text))`.execute(trx);
      return inserted.rows[0]!.id;
    });
  }

  async list(userId?: string): Promise<EnrollmentSnapshot[]> {
    const result = await sql<EnrollmentSnapshot>`SELECT e.id,e.user_id AS "userId",u.display_name AS "displayName",
      e.issuer,e.provider_subject AS subject,e.verified_email AS "verifiedEmail",
      CASE WHEN e.status='PENDING' AND e.expires_at<=now() THEN 'EXPIRED' ELSE e.status END AS status,
      e.expires_at::text AS "expiresAt",e.created_at::text AS "createdAt",e.decision_note AS "decisionNote"
      FROM auth_identity_enrollment_requests e JOIN users u ON u.id=e.user_id
      WHERE (${userId ?? null}::uuid IS NULL OR e.user_id=${userId ?? null}::uuid)
      ORDER BY e.created_at DESC,e.id DESC LIMIT 100`.execute(this.db);
    return result.rows;
  }

  async review(input: { id: string; reviewerUserId: string; reviewerSessionId: string; decision: 'APPROVED' | 'REJECTED'; note: string }): Promise<boolean> {
    return this.db.transaction().execute(async (trx) => {
      const target = await sql<{ user_id: string }>`SELECT user_id FROM auth_identity_enrollment_requests WHERE id=${input.id}::uuid`.execute(trx);
      if (!target.rows[0]) return false;
      // Same lock order as submission; two reviewers cannot bind two identities.
      await sql`SELECT id FROM users WHERE id=${target.rows[0].user_id}::uuid FOR NO KEY UPDATE`.execute(trx);
      const locked = await sql<{ status: string; reviewed_by: string | null; decision_note: string | null }>`
        SELECT status,reviewed_by,decision_note FROM auth_identity_enrollment_requests WHERE id=${input.id}::uuid FOR UPDATE`.execute(trx);
      const row = locked.rows[0]!;
      if (row.status !== 'PENDING') {
        return row.status === input.decision && row.reviewed_by === input.reviewerUserId && row.decision_note === input.note;
      }
      await sql`UPDATE auth_identity_enrollment_requests SET status=${input.decision},reviewed_by=${input.reviewerUserId}::uuid,
        reviewer_session_id=${input.reviewerSessionId}::uuid,reviewed_at=now(),decision_note=${input.note}
        WHERE id=${input.id}::uuid`.execute(trx);
      return true;
    });
  }

  async isPlatformReviewer(userId: string): Promise<boolean> {
    const result = await sql`SELECT 1 FROM access_role_assignments r JOIN users u ON u.id=r.user_id
      WHERE u.id=${userId}::uuid AND u.status='ACTIVE' AND r.role_code='PRENEURA_SUPER_ADMIN'
      AND r.scope_type='PLATFORM' AND r.status='ACTIVE' AND r.revoked_at IS NULL LIMIT 1`.execute(this.db);
    return result.rows.length === 1;
  }
}
