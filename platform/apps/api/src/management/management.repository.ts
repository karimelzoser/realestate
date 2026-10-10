import { Inject, Injectable } from '@nestjs/common';
import type { ManagementProjectOverviewSnapshot } from '@preneura/contracts/management';
import type { Database } from '@preneura/database';
import { sql, type Kysely } from 'kysely';
import { DATABASE } from '../database/database.module.js';

export type ManagementProjectCoreSnapshot = Omit<ManagementProjectOverviewSnapshot, 'generatedAt' | 'completionBacklog'>;

@Injectable()
export class ManagementRepository {
  constructor(@Inject(DATABASE) private readonly db: Kysely<Database>) {}

  async projectExists(tenantId: string, projectId: string): Promise<boolean> {
    const row = await this.db
      .selectFrom('projects')
      .select('id')
      .where('tenant_id', '=', tenantId)
      .where('id', '=', projectId)
      .where('status', 'in', ['DRAFT', 'ACTIVE', 'PAUSED', 'CLOSED'])
      .executeTakeFirst();
    return Boolean(row);
  }

  async overview(input: {
    tenantId: string;
    projectId: string;
    now: Date;
  }): Promise<ManagementProjectCoreSnapshot> {
    const [projectResult, inventoryResult, queueResult, transactionResult, financeResult, commissionResult, refundResult, notificationResult] = await Promise.all([
      sql<{ currency: string }>`
        SELECT currency
        FROM projects
        WHERE tenant_id = ${input.tenantId}::uuid
          AND id = ${input.projectId}::uuid
        LIMIT 1
      `.execute(this.db),
      sql<{
        unit_types: number;
        available: number;
        reserved: number;
        sold: number;
        withdrawn: number;
        scheduled_price_versions: number;
        next_price_change_at: Date | null;
      }>`
        SELECT
          (SELECT COUNT(*)::int FROM catalog_unit_types u
           WHERE u.tenant_id=${input.tenantId}::uuid AND u.project_id=${input.projectId}::uuid AND u.status <> 'ARCHIVED') AS unit_types,
          COUNT(*) FILTER (WHERE s.state='AVAILABLE')::int AS available,
          COUNT(*) FILTER (WHERE s.state='RESERVED')::int AS reserved,
          COUNT(*) FILTER (WHERE s.state='SOLD')::int AS sold,
          COUNT(*) FILTER (WHERE s.state='WITHDRAWN')::int AS withdrawn,
          (SELECT COUNT(*)::int FROM pricing_versions p
           WHERE p.tenant_id=${input.tenantId}::uuid AND p.project_id=${input.projectId}::uuid
             AND p.status='SCHEDULED' AND p.effective_at > ${input.now}) AS scheduled_price_versions,
          (SELECT MIN(p.effective_at) FROM pricing_versions p
           WHERE p.tenant_id=${input.tenantId}::uuid AND p.project_id=${input.projectId}::uuid
             AND p.status='SCHEDULED' AND p.effective_at > ${input.now}) AS next_price_change_at
        FROM inventory_slots s
        WHERE s.tenant_id=${input.tenantId}::uuid AND s.project_id=${input.projectId}::uuid
      `.execute(this.db),
      sql<{ waiting: number; called: number; locked: number }>`
        SELECT
          COUNT(*) FILTER (WHERE status='WAITING')::int AS waiting,
          COUNT(*) FILTER (WHERE status='CALLED')::int AS called,
          COUNT(*) FILTER (WHERE status='LOCKED')::int AS locked
        FROM queue_entries
        WHERE tenant_id=${input.tenantId}::uuid AND project_id=${input.projectId}::uuid
      `.execute(this.db),
      sql<{
        open_count: number;
        ready_count: number;
        completed_count: number;
        cancelled_count: number;
        average_completion: string | number;
        oldest_open_hours: number | null;
      }>`
        WITH progress AS (
          SELECT
            t.id,
            t.status,
            t.opened_at,
            COALESCE(SUM(CASE WHEN m.status IN ('COMPLETED','WAIVED') THEN m.weight_percent ELSE 0 END), 0) AS completion
          FROM transactions t
          LEFT JOIN transaction_milestones m ON m.transaction_id=t.id
          WHERE t.tenant_id=${input.tenantId}::uuid AND t.project_id=${input.projectId}::uuid
          GROUP BY t.id, t.status, t.opened_at
        )
        SELECT
          COUNT(*) FILTER (WHERE status='IN_PROGRESS')::int AS open_count,
          COUNT(*) FILTER (WHERE status='READY_FOR_COMPLETION')::int AS ready_count,
          COUNT(*) FILTER (WHERE status='COMPLETED')::int AS completed_count,
          COUNT(*) FILTER (WHERE status='CANCELLED')::int AS cancelled_count,
          COALESCE(AVG(completion) FILTER (WHERE status IN ('IN_PROGRESS','READY_FOR_COMPLETION')), 0)::numeric(7,2)::text AS average_completion,
          CASE WHEN MIN(opened_at) FILTER (WHERE status IN ('IN_PROGRESS','READY_FOR_COMPLETION')) IS NULL THEN NULL
               ELSE FLOOR(EXTRACT(EPOCH FROM (${input.now} - MIN(opened_at) FILTER (WHERE status IN ('IN_PROGRESS','READY_FOR_COMPLETION'))) / 3600))::int
          END AS oldest_open_hours
        FROM progress
      `.execute(this.db),
      sql<{ overdue_items: number; overdue_amount: string | number }>`
        SELECT
          COUNT(*)::int AS overdue_items,
          COALESCE(SUM(GREATEST(i.amount - i.paid_amount, 0)), 0)::numeric(18,2)::text AS overdue_amount
        FROM payment_schedule_items i
        JOIN payment_schedules s ON s.id=i.payment_schedule_id
        WHERE s.tenant_id=${input.tenantId}::uuid
          AND s.project_id=${input.projectId}::uuid
          AND s.status <> 'CANCELLED'
          AND i.due_at < ${input.now}
          AND i.status NOT IN ('PAID','WAIVED','CANCELLED')
          AND i.amount > i.paid_amount
      `.execute(this.db),
      sql<{
        pending: number;
        eligible: number;
        invoiced: number;
        due: number;
        paid: number;
        disputed: number;
        overdue: number;
        outstanding_amount: string | number;
      }>`
        SELECT
          COUNT(*) FILTER (WHERE status='PENDING_PREREQUISITES')::int AS pending,
          COUNT(*) FILTER (WHERE status='ELIGIBLE')::int AS eligible,
          COUNT(*) FILTER (WHERE status='INVOICED')::int AS invoiced,
          COUNT(*) FILTER (WHERE status='DUE')::int AS due,
          COUNT(*) FILTER (WHERE status='PAID')::int AS paid,
          COUNT(*) FILTER (WHERE status='DISPUTED')::int AS disputed,
          COUNT(*) FILTER (WHERE due_at < ${input.now} AND status NOT IN ('PAID','CANCELLED'))::int AS overdue,
          COALESCE(SUM(commission_amount) FILTER (WHERE status IN ('ELIGIBLE','INVOICED','DUE','DISPUTED')), 0)::numeric(18,2)::text AS outstanding_amount
        FROM broker_commission_cases
        WHERE tenant_id=${input.tenantId}::uuid AND project_id=${input.projectId}::uuid
      `.execute(this.db),
      sql<{ requested: number; approved: number; approved_amount: string | number }>`
        SELECT
          COUNT(*) FILTER (WHERE status='REQUESTED')::int AS requested,
          COUNT(*) FILTER (WHERE status='APPROVED')::int AS approved,
          COALESCE(SUM(requested_amount) FILTER (WHERE status='APPROVED'), 0)::numeric(18,2)::text AS approved_amount
        FROM eoi_refund_requests
        WHERE tenant_id=${input.tenantId}::uuid AND project_id=${input.projectId}::uuid
      `.execute(this.db),
      sql<{ pending: number; failed: number }>`
        SELECT
          COUNT(*) FILTER (WHERE status IN ('PENDING','PROCESSING'))::int AS pending,
          COUNT(*) FILTER (WHERE status='FAILED')::int AS failed
        FROM notification_jobs
        WHERE tenant_id=${input.tenantId}::uuid AND project_id=${input.projectId}::uuid
      `.execute(this.db),
    ]);

    const project = projectResult.rows[0];
    if (!project) throw new Error('Project disappeared during management snapshot.');
    const inventory = inventoryResult.rows[0]!;
    const allocation = queueResult.rows[0]!;
    const transactions = transactionResult.rows[0]!;
    const finance = financeResult.rows[0]!;
    const commissions = commissionResult.rows[0]!;
    const refunds = refundResult.rows[0]!;
    const notifications = notificationResult.rows[0]!;

    return {
      tenantId: input.tenantId,
      projectId: input.projectId,
      currency: project.currency,
      inventory: {
        unitTypes: inventory.unit_types,
        available: inventory.available,
        reserved: inventory.reserved,
        sold: inventory.sold,
        withdrawn: inventory.withdrawn,
        scheduledPriceVersions: inventory.scheduled_price_versions,
        nextPriceChangeAt: inventory.next_price_change_at?.toISOString() ?? null,
      },
      allocation: {
        waiting: allocation.waiting,
        called: allocation.called,
        locked: allocation.locked,
      },
      transactions: {
        open: transactions.open_count,
        readyForCompletion: transactions.ready_count,
        completed: transactions.completed_count,
        cancelled: transactions.cancelled_count,
        averageCompletionPercent: String(transactions.average_completion),
        oldestOpenHours: transactions.oldest_open_hours,
      },
      finance: {
        overdueItems: finance.overdue_items,
        overdueOutstandingAmount: String(finance.overdue_amount),
      },
      commissions: {
        pendingPrerequisites: commissions.pending,
        eligible: commissions.eligible,
        invoiced: commissions.invoiced,
        due: commissions.due,
        paid: commissions.paid,
        disputed: commissions.disputed,
        overdue: commissions.overdue,
        outstandingAmount: String(commissions.outstanding_amount),
      },
      refunds: {
        requested: refunds.requested,
        approved: refunds.approved,
        approvedAmount: String(refunds.approved_amount),
      },
      notifications: {
        pending: notifications.pending,
        failed: notifications.failed,
      },
    };
  }
}
