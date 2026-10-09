import { Inject, Injectable } from '@nestjs/common';
import type {
  BuyerPropertyContractSnapshot,
  BuyerPropertyFinanceSnapshot,
  BuyerPropertyInstallmentSnapshot,
  BuyerPropertySnapshot,
} from '@preneura/contracts/property';
import type { Database } from '@preneura/database';
import { sql, type Kysely } from 'kysely';
import { DATABASE } from '../database/database.module.js';

interface BasePropertyRow {
  transaction_id: string;
  reservation_id: string;
  transaction_status: 'IN_PROGRESS' | 'READY_FOR_COMPLETION' | 'COMPLETED';
  project_id: string;
  project_name: string;
  unit_type_id: string;
  unit_type_code: string;
  unit_type_name: string;
  quoted_total: string | number | null;
  currency: string;
  completion_percent: string | number;
  opened_at: Date;
  completed_at: Date | null;
}

type InstallmentRow = {
  id: string;
  sequence_number: number;
  item_type: BuyerPropertyInstallmentSnapshot['itemType'];
  amount: string | number;
  paid_amount: string | number;
  remaining_amount: string | number;
  has_paid: boolean;
  has_remaining: boolean;
  due_at: Date;
  status: string;
  paid_at: Date | null;
};

@Injectable()
export class PropertyRepository {
  constructor(@Inject(DATABASE) private readonly db: Kysely<Database>) {}

  async projectExists(tenantId: string, projectId: string): Promise<boolean> {
    const result = await sql<{ exists: boolean }>`
      SELECT EXISTS (
        SELECT 1 FROM projects
        WHERE id = ${projectId}::uuid AND tenant_id = ${tenantId}::uuid
      ) AS exists
    `.execute(this.db);
    return Boolean(result.rows[0]?.exists);
  }

  async listBuyerProperties(input: {
    tenantId: string;
    projectId: string;
    buyerUserId: string;
    now: Date;
  }): Promise<BuyerPropertySnapshot[]> {
    const baseResult = await sql<BasePropertyRow>`
      SELECT
        t.id AS transaction_id,
        r.id AS reservation_id,
        t.status AS transaction_status,
        p.id AS project_id,
        p.name AS project_name,
        ut.id AS unit_type_id,
        ut.code AS unit_type_code,
        ut.name AS unit_type_name,
        r.quoted_total,
        r.currency,
        COALESCE(
          SUM(
            CASE WHEN tm.status IN ('COMPLETED', 'WAIVED')
              THEN tm.weight_percent ELSE 0 END
          ),
          0
        ) AS completion_percent,
        t.opened_at,
        t.completed_at
      FROM transactions t
      JOIN buyer_profiles bp ON bp.id = t.buyer_profile_id
      JOIN reservations r ON r.id = t.reservation_id
      JOIN catalog_unit_types ut ON ut.id = r.unit_type_id
      JOIN projects p ON p.id = t.project_id AND p.tenant_id = t.tenant_id
      LEFT JOIN transaction_milestones tm ON tm.transaction_id = t.id
      WHERE t.tenant_id = ${input.tenantId}::uuid
        AND t.project_id = ${input.projectId}::uuid
        AND bp.user_id = ${input.buyerUserId}::uuid
        AND t.status <> 'CANCELLED'
      GROUP BY t.id, r.id, p.id, p.name, ut.id, ut.code, ut.name
      ORDER BY t.opened_at DESC, t.id DESC
    `.execute(this.db);

    return Promise.all(baseResult.rows.map(async (row) => ({
      transactionId: row.transaction_id,
      reservationId: row.reservation_id,
      state: row.transaction_status === 'COMPLETED' ? 'PROPERTY_ACTIVE' : 'PURCHASE_IN_PROGRESS',
      transactionStatus: row.transaction_status,
      projectId: row.project_id,
      projectName: row.project_name,
      unitTypeId: row.unit_type_id,
      unitTypeCode: row.unit_type_code,
      unitTypeName: row.unit_type_name,
      quotedTotal: row.quoted_total === null ? null : String(row.quoted_total),
      currency: row.currency,
      completionPercent: String(row.completion_percent),
      openedAt: row.opened_at.toISOString(),
      completedAt: row.completed_at?.toISOString() ?? null,
      contract: await this.getContract(row.transaction_id, input.tenantId, input.projectId),
      finance: await this.getFinance(row.transaction_id, input.tenantId, input.projectId, input.now),
    })));
  }

  private async getContract(
    transactionId: string,
    tenantId: string,
    projectId: string,
  ): Promise<BuyerPropertyContractSnapshot | null> {
    const result = await sql<{
      id: string;
      document_sha256_hex: string;
      object_trust_status: 'CLEAN' | 'LEGACY_UNSCANNED';
      template_version_number: number;
      manifest_sha256_hex: string;
      executed_at: Date;
    }>`
      SELECT id, document_sha256_hex, object_trust_status,
             template_version_number, manifest_sha256_hex, executed_at
      FROM contract_execution_snapshots
      WHERE tenant_id = ${tenantId}::uuid
        AND project_id = ${projectId}::uuid
        AND transaction_id = ${transactionId}::uuid
      LIMIT 1
    `.execute(this.db);
    const row = result.rows[0];
    if (!row) return null;
    return {
      executionSnapshotId: row.id,
      executed: true,
      documentSha256Hex: row.document_sha256_hex,
      objectTrustStatus: row.object_trust_status,
      templateVersionNumber: Number(row.template_version_number),
      manifestSha256Hex: row.manifest_sha256_hex,
      executedAt: row.executed_at.toISOString(),
    };
  }

  private async getFinance(
    transactionId: string,
    tenantId: string,
    projectId: string,
    now: Date,
  ): Promise<BuyerPropertyFinanceSnapshot | null> {
    const scheduleResult = await sql<{
      id: string;
      currency: string;
      total_contract_amount: string | number;
      status: BuyerPropertyFinanceSnapshot['scheduleStatus'];
    }>`
      SELECT id, currency, total_contract_amount, status
      FROM payment_schedules
      WHERE tenant_id = ${tenantId}::uuid
        AND project_id = ${projectId}::uuid
        AND transaction_id = ${transactionId}::uuid
      LIMIT 1
    `.execute(this.db);
    const schedule = scheduleResult.rows[0];
    if (!schedule) return null;

    const itemResult = await sql<InstallmentRow>`
      SELECT id, sequence_number, item_type, amount, paid_amount,
             GREATEST(amount - paid_amount, 0) AS remaining_amount,
             (paid_amount > 0) AS has_paid,
             (amount > paid_amount) AS has_remaining,
             due_at, status, paid_at
      FROM payment_schedule_items
      WHERE payment_schedule_id = ${schedule.id}::uuid
      ORDER BY sequence_number ASC, id ASC
    `.execute(this.db);

    const installments = itemResult.rows.map((row) => this.toInstallment(row, now));
    const summaryResult = await sql<{
      paid_toward_contract: string | number;
      remaining_contract_amount: string | number;
      overdue_amount: string | number;
      overdue_item_count: number;
    }>`
      SELECT
        COALESCE(SUM(paid_amount), 0) AS paid_toward_contract,
        COALESCE(SUM(
          CASE WHEN status NOT IN ('WAIVED', 'CANCELLED')
            THEN GREATEST(amount - paid_amount, 0) ELSE 0 END
        ), 0) AS remaining_contract_amount,
        COALESCE(SUM(
          CASE WHEN status NOT IN ('PAID', 'WAIVED', 'CANCELLED')
                    AND due_at < ${now}::timestamptz
            THEN GREATEST(amount - paid_amount, 0) ELSE 0 END
        ), 0) AS overdue_amount,
        COUNT(*) FILTER (
          WHERE status NOT IN ('PAID', 'WAIVED', 'CANCELLED')
            AND due_at < ${now}::timestamptz
            AND amount > paid_amount
        )::int AS overdue_item_count
      FROM payment_schedule_items
      WHERE payment_schedule_id = ${schedule.id}::uuid
    `.execute(this.db);
    const summary = summaryResult.rows[0]!;

    const nextDue = installments
      .filter((item) => !['PAID', 'WAIVED', 'CANCELLED'].includes(item.status) && item.remainingAmount !== '0' && item.remainingAmount !== '0.00')
      .sort((a, b) => a.dueAt.localeCompare(b.dueAt))[0] ?? null;

    return {
      scheduleId: schedule.id,
      scheduleStatus: schedule.status,
      currency: schedule.currency,
      totalContractAmount: String(schedule.total_contract_amount),
      paidTowardContract: String(summary.paid_toward_contract),
      remainingContractAmount: String(summary.remaining_contract_amount),
      overdueAmount: String(summary.overdue_amount),
      overdueItemCount: Number(summary.overdue_item_count),
      nextDueAt: nextDue?.dueAt ?? null,
      nextDueAmount: nextDue?.remainingAmount ?? null,
      installments,
    };
  }

  private toInstallment(row: InstallmentRow, now: Date): BuyerPropertyInstallmentSnapshot {
    let status: BuyerPropertyInstallmentSnapshot['status'];
    if (row.status === 'WAIVED' || row.status === 'CANCELLED' || row.status === 'PAID') {
      status = row.status;
    } else if (!row.has_remaining) {
      status = 'PAID';
    } else if (row.due_at.getTime() < now.getTime()) {
      status = 'OVERDUE';
    } else if (row.has_paid) {
      status = 'PARTIALLY_PAID';
    } else if (row.due_at.getTime() <= now.getTime()) {
      status = 'DUE';
    } else {
      status = 'UPCOMING';
    }
    return {
      paymentItemId: row.id,
      sequenceNumber: row.sequence_number,
      itemType: row.item_type,
      amount: String(row.amount),
      paidAmount: String(row.paid_amount),
      remainingAmount: String(row.remaining_amount),
      dueAt: row.due_at.toISOString(),
      status,
      paidAt: row.paid_at?.toISOString() ?? null,
    };
  }
}
