import { Inject, Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import type { Database } from '@preneura/database';
import type {
  AiProjectSettingsInput,
  AiProjectSettingsSnapshot,
  AiProviderCode,
  ManagerProjectMetricsSnapshot,
} from '@preneura/contracts/ai';
import { DATABASE } from '../database/database.module.js';

type SettingsRow = {
  tenant_id: string;
  project_id: string;
  buyer_enabled: boolean;
  manager_enabled: boolean;
  provider_code: AiProviderCode;
  model: string | null;
  updated_at: Date;
};

type MetricsRow = {
  available_inventory: string;
  reserved_inventory: string;
  sold_inventory: string;
  transactions_total: string;
  transactions_open: string;
  transactions_ready: string;
  transactions_completed: string;
  overdue_payment_items: string;
  overdue_payment_amount: string;
  due_commission_cases: string;
  due_commission_amount: string;
  failed_notification_jobs: string;
  pending_document_requirements: string;
};

@Injectable()
export class AiRepository {
  constructor(@Inject(DATABASE) private readonly db: Kysely<Database>) {}

  async settings(tenantId: string, projectId: string): Promise<SettingsRow | null> {
    const result = await sql<SettingsRow>`
      SELECT tenant_id, project_id, buyer_enabled, manager_enabled, provider_code, model, updated_at
      FROM project_ai_settings
      WHERE tenant_id = ${tenantId}::uuid AND project_id = ${projectId}::uuid
    `.execute(this.db);
    return result.rows[0] ?? null;
  }

  async upsertSettings(input: {
    actorUserId: string;
    tenantId: string;
    projectId: string;
    settings: AiProjectSettingsInput;
  }): Promise<SettingsRow> {
    return this.db.transaction().execute(async (trx) => {
      const result = await sql<SettingsRow>`
        INSERT INTO project_ai_settings (
          tenant_id, project_id, buyer_enabled, manager_enabled, provider_code, model, updated_by
        ) VALUES (
          ${input.tenantId}::uuid, ${input.projectId}::uuid,
          ${input.settings.buyerEnabled}, ${input.settings.managerEnabled},
          ${input.settings.providerCode}, ${input.settings.model ?? null}, ${input.actorUserId}::uuid
        )
        ON CONFLICT (tenant_id, project_id) DO UPDATE SET
          buyer_enabled = EXCLUDED.buyer_enabled,
          manager_enabled = EXCLUDED.manager_enabled,
          provider_code = EXCLUDED.provider_code,
          model = EXCLUDED.model,
          updated_by = EXCLUDED.updated_by,
          updated_at = now()
        RETURNING tenant_id, project_id, buyer_enabled, manager_enabled, provider_code, model, updated_at
      `.execute(trx);
      await trx.insertInto('domain_outbox_events').values({
        tenant_id: input.tenantId,
        project_id: input.projectId,
        aggregate_type: 'AI_SETTINGS',
        aggregate_id: input.projectId,
        event_type: 'ai.settings_updated',
        payload: {
          actorUserId: input.actorUserId,
          buyerEnabled: input.settings.buyerEnabled,
          managerEnabled: input.settings.managerEnabled,
          providerCode: input.settings.providerCode,
        },
        attempts: 0,
      }).execute();
      return result.rows[0]!;
    });
  }

  async managerMetrics(tenantId: string, projectId: string): Promise<ManagerProjectMetricsSnapshot> {
    const result = await sql<MetricsRow>`
      SELECT
        (SELECT count(*) FROM inventory_slots WHERE tenant_id = ${tenantId}::uuid AND project_id = ${projectId}::uuid AND state = 'AVAILABLE') AS available_inventory,
        (SELECT count(*) FROM inventory_slots WHERE tenant_id = ${tenantId}::uuid AND project_id = ${projectId}::uuid AND state = 'RESERVED') AS reserved_inventory,
        (SELECT count(*) FROM inventory_slots WHERE tenant_id = ${tenantId}::uuid AND project_id = ${projectId}::uuid AND state = 'SOLD') AS sold_inventory,
        (SELECT count(*) FROM transactions WHERE tenant_id = ${tenantId}::uuid AND project_id = ${projectId}::uuid) AS transactions_total,
        (SELECT count(*) FROM transactions WHERE tenant_id = ${tenantId}::uuid AND project_id = ${projectId}::uuid AND status = 'IN_PROGRESS') AS transactions_open,
        (SELECT count(*) FROM transactions WHERE tenant_id = ${tenantId}::uuid AND project_id = ${projectId}::uuid AND status = 'READY_FOR_COMPLETION') AS transactions_ready,
        (SELECT count(*) FROM transactions WHERE tenant_id = ${tenantId}::uuid AND project_id = ${projectId}::uuid AND status = 'COMPLETED') AS transactions_completed,
        (SELECT count(*)
           FROM payment_schedule_items item
           JOIN payment_schedules schedule ON schedule.id = item.payment_schedule_id
          WHERE schedule.tenant_id = ${tenantId}::uuid AND schedule.project_id = ${projectId}::uuid
            AND item.status IN ('DUE','OVERDUE') AND item.due_at < now()) AS overdue_payment_items,
        COALESCE((SELECT sum(item.amount)
           FROM payment_schedule_items item
           JOIN payment_schedules schedule ON schedule.id = item.payment_schedule_id
          WHERE schedule.tenant_id = ${tenantId}::uuid AND schedule.project_id = ${projectId}::uuid
            AND item.status IN ('DUE','OVERDUE') AND item.due_at < now()), 0)::text AS overdue_payment_amount,
        (SELECT count(*) FROM broker_commission_cases WHERE tenant_id = ${tenantId}::uuid AND project_id = ${projectId}::uuid AND status = 'DUE') AS due_commission_cases,
        COALESCE((SELECT sum(commission_amount) FROM broker_commission_cases WHERE tenant_id = ${tenantId}::uuid AND project_id = ${projectId}::uuid AND status = 'DUE'), 0)::text AS due_commission_amount,
        (SELECT count(*) FROM notification_jobs WHERE tenant_id = ${tenantId}::uuid AND project_id = ${projectId}::uuid AND status = 'FAILED') AS failed_notification_jobs,
        (SELECT count(*)
           FROM transaction_milestones milestone
           JOIN transactions transaction ON transaction.id = milestone.transaction_id
          WHERE transaction.tenant_id = ${tenantId}::uuid AND transaction.project_id = ${projectId}::uuid
            AND milestone.code = 'BUYER_DOCUMENTS_COMPLETE' AND milestone.status IN ('PENDING','BLOCKED')) AS pending_document_requirements
    `.execute(this.db);
    const row = result.rows[0]!;
    return {
      availableInventory: Number(row.available_inventory),
      reservedInventory: Number(row.reserved_inventory),
      soldInventory: Number(row.sold_inventory),
      transactionsTotal: Number(row.transactions_total),
      transactionsOpen: Number(row.transactions_open),
      transactionsReady: Number(row.transactions_ready),
      transactionsCompleted: Number(row.transactions_completed),
      overduePaymentItems: Number(row.overdue_payment_items),
      overduePaymentAmount: row.overdue_payment_amount,
      dueCommissionCases: Number(row.due_commission_cases),
      dueCommissionAmount: row.due_commission_amount,
      failedNotificationJobs: Number(row.failed_notification_jobs),
      pendingDocumentRequirements: Number(row.pending_document_requirements),
    };
  }

  async logInvocation(input: {
    tenantId: string;
    projectId: string;
    userId: string;
    purpose: 'BUYER_RECOMMENDATION' | 'MANAGER_INSIGHT';
    providerCode: AiProviderCode;
    model: string | null;
    requestFingerprint: string;
    candidateCount: number | null;
    status: 'SUCCESS' | 'FAILED' | 'FALLBACK';
    latencyMs: number;
    externalRequestId: string | null;
    errorCode: string | null;
  }): Promise<void> {
    await sql`
      INSERT INTO ai_invocations (
        tenant_id, project_id, user_id, purpose, provider_code, model,
        request_fingerprint, candidate_count, status, latency_ms,
        external_request_id, error_code
      ) VALUES (
        ${input.tenantId}::uuid, ${input.projectId}::uuid, ${input.userId}::uuid,
        ${input.purpose}, ${input.providerCode}, ${input.model}, ${input.requestFingerprint},
        ${input.candidateCount}, ${input.status}, ${input.latencyMs},
        ${input.externalRequestId}, ${input.errorCode}
      )
    `.execute(this.db);
  }

  snapshot(row: SettingsRow | null, tenantId: string, projectId: string): AiProjectSettingsSnapshot {
    return {
      tenantId,
      projectId,
      buyerEnabled: row?.buyer_enabled ?? false,
      managerEnabled: row?.manager_enabled ?? false,
      providerCode: row?.provider_code ?? 'DETERMINISTIC',
      model: row?.model ?? null,
      externalProviderConfigured: Boolean(process.env.AI_PROVIDER_URL),
      updatedAt: row?.updated_at.toISOString() ?? null,
    };
  }
}
