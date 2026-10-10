import { Inject, Injectable } from '@nestjs/common';
import type { ProjectBuyerSnapshot } from '@preneura/contracts/sales';
import type { Database } from '@preneura/database';
import { sql, type Kysely } from 'kysely';
import { DATABASE } from '../database/database.module.js';

@Injectable()
export class SalesBuyerListRepository {
  constructor(@Inject(DATABASE) private readonly db: Kysely<Database>) {}

  async list(input: { tenantId: string; projectId: string }): Promise<ProjectBuyerSnapshot[]> {
    const result = await sql<{
      buyer_profile_id: string;
      user_id: string;
      display_name: string;
      account_status: ProjectBuyerSnapshot['accountStatus'];
      membership_status: ProjectBuyerSnapshot['membershipStatus'];
      source: ProjectBuyerSnapshot['source'];
      contact_display_hint: string | null;
      contact_verified_at: Date | null;
      created_at: Date;
      eoi_id: string | null;
      eoi_status: NonNullable<ProjectBuyerSnapshot['latestEoi']>['status'] | null;
      eoi_amount: string | number | null;
      eoi_currency: string | null;
      eoi_paid_at: Date | null;
      eoi_created_at: Date | null;
    }>`
      SELECT
        bp.id AS buyer_profile_id,
        bp.user_id,
        u.display_name,
        u.status AS account_status,
        tm.status AS membership_status,
        bp.source,
        contact.display_hint AS contact_display_hint,
        contact.verified_at AS contact_verified_at,
        bp.created_at,
        eoi.id AS eoi_id,
        eoi.status AS eoi_status,
        eoi.amount AS eoi_amount,
        eoi.currency AS eoi_currency,
        eoi.paid_at AS eoi_paid_at,
        eoi.created_at AS eoi_created_at
      FROM buyer_profiles bp
      JOIN users u ON u.id = bp.user_id
      JOIN tenant_memberships tm
        ON tm.user_id = bp.user_id AND tm.tenant_id = bp.tenant_id
      LEFT JOIN LATERAL (
        SELECT display_hint, verified_at
        FROM auth_delivery_contacts
        WHERE user_id = bp.user_id
          AND kind = 'PHONE'
          AND is_primary = true
        ORDER BY created_at ASC
        LIMIT 1
      ) contact ON true
      LEFT JOIN LATERAL (
        SELECT id, status, amount, currency, paid_at, created_at
        FROM buyer_eois
        WHERE tenant_id = bp.tenant_id
          AND project_id = ${input.projectId}::uuid
          AND buyer_profile_id = bp.id
        ORDER BY created_at DESC, id DESC
        LIMIT 1
      ) eoi ON true
      WHERE bp.tenant_id = ${input.tenantId}::uuid
        AND bp.status = 'ACTIVE'
        AND (
          EXISTS (
            SELECT 1
            FROM access_role_assignments ara
            WHERE ara.user_id = bp.user_id
              AND ara.role_code = 'BUYER'
              AND ara.scope_type = 'PROJECT'
              AND ara.tenant_id = ${input.tenantId}::uuid
              AND ara.project_id = ${input.projectId}::uuid
              AND ara.status = 'ACTIVE'
              AND ara.revoked_at IS NULL
          )
          OR eoi.id IS NOT NULL
        )
      ORDER BY bp.created_at DESC, bp.id DESC
    `.execute(this.db);

    return result.rows.map((row) => ({
      buyerProfileId: row.buyer_profile_id,
      userId: row.user_id,
      displayName: row.display_name,
      accountStatus: row.account_status,
      membershipStatus: row.membership_status,
      source: row.source,
      contactDisplayHint: row.contact_display_hint,
      contactVerified: Boolean(row.contact_verified_at),
      latestEoi: row.eoi_id && row.eoi_status && row.eoi_amount !== null && row.eoi_currency && row.eoi_created_at
        ? {
            eoiId: row.eoi_id,
            status: row.eoi_status,
            amount: String(row.eoi_amount),
            currency: row.eoi_currency,
            paidAt: row.eoi_paid_at?.toISOString() ?? null,
            createdAt: row.eoi_created_at.toISOString(),
          }
        : null,
      createdAt: row.created_at.toISOString(),
    }));
  }
}
