import { Inject, Injectable } from '@nestjs/common';
import type { TransactionPriceSnapshot } from '@preneura/contracts/pricing-quote';
import { sql, type Kysely } from 'kysely';
import type { Database } from '@preneura/database';
import { DATABASE } from '../database/database.module.js';

@Injectable()
export class TransactionPriceRepository {
  constructor(@Inject(DATABASE) private readonly db: Kysely<Database>) {}

  async getSnapshot(input: {
    tenantId: string;
    projectId: string;
    transactionId: string;
  }): Promise<TransactionPriceSnapshot | null> {
    const header = await sql<{
      transaction_id: string;
      reservation_id: string;
      unit_type_id: string;
      unit_type_code: string;
      unit_type_name: string;
      pricing_version_id: string;
      pricing_version_number: number;
      pricing_version_label: string;
      pricing_effective_at: Date;
      quoted_total: string;
      currency: string;
      reserved_at: Date;
    }>`
      SELECT
        t.id AS transaction_id,
        r.id AS reservation_id,
        r.unit_type_id,
        ut.code AS unit_type_code,
        ut.name AS unit_type_name,
        r.pricing_version_id,
        pv.version_number AS pricing_version_number,
        pv.label AS pricing_version_label,
        pv.effective_at AS pricing_effective_at,
        r.quoted_total::text AS quoted_total,
        r.currency,
        r.reserved_at
      FROM transactions t
      JOIN reservations r
        ON r.id = t.reservation_id
       AND r.tenant_id = t.tenant_id
       AND r.project_id = t.project_id
      JOIN catalog_unit_types ut
        ON ut.id = r.unit_type_id
       AND ut.tenant_id = r.tenant_id
       AND ut.project_id = r.project_id
      JOIN pricing_versions pv
        ON pv.id = r.pricing_version_id
       AND pv.tenant_id = r.tenant_id
       AND pv.project_id = r.project_id
      WHERE t.id = ${input.transactionId}::uuid
        AND t.tenant_id = ${input.tenantId}::uuid
        AND t.project_id = ${input.projectId}::uuid
        AND r.pricing_version_id IS NOT NULL
        AND r.quoted_total IS NOT NULL
      LIMIT 1
    `.execute(this.db);

    const row = header.rows[0];
    if (!row) return null;

    const components = await sql<{
      component: 'INDOOR' | 'ROOF' | 'GARDEN';
      area_sqm: string;
      rate_per_sqm: string;
      amount: string;
    }>`
      SELECT component, area_sqm::text, rate_per_sqm::text, amount::text
      FROM reservation_price_components
      WHERE tenant_id = ${input.tenantId}::uuid
        AND project_id = ${input.projectId}::uuid
        AND reservation_id = ${row.reservation_id}::uuid
      ORDER BY CASE component
        WHEN 'INDOOR' THEN 1
        WHEN 'ROOF' THEN 2
        WHEN 'GARDEN' THEN 3
      END
    `.execute(this.db);

    if (components.rows.length !== 3) return null;

    return {
      transactionId: row.transaction_id,
      reservationId: row.reservation_id,
      unitTypeId: row.unit_type_id,
      unitTypeCode: row.unit_type_code,
      unitTypeName: row.unit_type_name,
      pricingVersionId: row.pricing_version_id,
      pricingVersionNumber: Number(row.pricing_version_number),
      pricingVersionLabel: row.pricing_version_label,
      pricingEffectiveAt: row.pricing_effective_at.toISOString(),
      quotedTotal: row.quoted_total,
      currency: row.currency,
      reservedAt: row.reserved_at.toISOString(),
      components: components.rows.map((component) => ({
        component: component.component,
        areaSqm: component.area_sqm,
        ratePerSqm: component.rate_per_sqm,
        amount: component.amount,
      })),
    };
  }
}
