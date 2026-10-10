import { ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { sql, type Kysely, type RawBuilder } from 'kysely';
import type { Database } from '@preneura/database';
import type { PermissionCode } from '@preneura/contracts/access';
import { AccessService } from '../access/access.service.js';
import { DATABASE } from '../database/database.module.js';

export const EXPORT_DATASETS = [
  'buyers','eois','queue','inventory','pricing','transactions','payments','cheques','documents','refunds','commissions','notifications','audit','accounts','templates',
] as const;
export type ExportDataset = (typeof EXPORT_DATASETS)[number];

type ExportScope =
  | { kind: 'PROJECT' }
  | { kind: 'BROKER'; brokerCompanyIds: string[]; agentUserId: string | null }
  | { kind: 'SELF'; userId: string };

type ExportRow = Record<string, unknown>;

export interface ExportDescriptor {
  dataset: ExportDataset;
  label: string;
}

export interface CsvExportResult {
  dataset: ExportDataset;
  filename: string;
  csv: string;
  rowCount: number;
}

const LABELS: Record<ExportDataset, string> = {
  buyers: 'Buyers',
  eois: 'EOIs',
  queue: 'Queue',
  inventory: 'Inventory by unit type',
  pricing: 'Published & scheduled pricing',
  transactions: 'Transactions',
  payments: 'Payment schedule',
  cheques: 'Cheques',
  documents: 'Documents',
  refunds: 'EOI refunds',
  commissions: 'Broker commissions',
  notifications: 'Notifications',
  audit: 'Transaction audit',
  accounts: 'Accounts & roles',
  templates: 'Document templates',
};

const BROKER_ROLES = new Set(['BROKER_MANAGER','BROKER_FINANCE','BROKER_AGENT']);

@Injectable()
export class ExportService {
  constructor(
    @Inject(DATABASE) private readonly db: Kysely<Database>,
    private readonly access: AccessService,
  ) {}

  async available(input: { actorUserId: string; tenantId: string; projectId: string }): Promise<ExportDescriptor[]> {
    await this.assertProject(input.tenantId, input.projectId);
    const available: ExportDescriptor[] = [];
    for (const dataset of EXPORT_DATASETS) {
      try {
        await this.scopeFor({ ...input, dataset });
        available.push({ dataset, label: LABELS[dataset] });
      } catch (error) {
        if (!(error instanceof ForbiddenException)) throw error;
      }
    }
    return available;
  }

  async exportCsv(input: {
    actorUserId: string;
    tenantId: string;
    projectId: string;
    dataset: ExportDataset;
  }): Promise<CsvExportResult> {
    await this.assertProject(input.tenantId, input.projectId);
    const scope = await this.scopeFor(input);
    const rows = await this.rowsFor(input, scope);
    const csv = this.toCsv(rows);

    await sql`
      INSERT INTO domain_outbox_events(tenant_id, project_id, aggregate_type, aggregate_id, event_type, payload)
      VALUES (
        ${input.tenantId}::uuid,
        ${input.projectId}::uuid,
        'EXPORT',
        ${input.projectId}::uuid,
        'DATA_EXPORT_GENERATED',
        ${JSON.stringify({ dataset: input.dataset, actorUserId: input.actorUserId, rowCount: rows.length })}::jsonb
      )
    `.execute(this.db);

    return {
      dataset: input.dataset,
      filename: `preneura-${input.dataset}-${new Date().toISOString().slice(0, 10)}.csv`,
      csv,
      rowCount: rows.length,
    };
  }

  private async scopeFor(input: {
    actorUserId: string;
    tenantId: string;
    projectId: string;
    dataset: ExportDataset;
  }): Promise<ExportScope> {
    if (input.dataset === 'notifications') {
      const managers = await this.access.matchingAssignments({
        userId: input.actorUserId,
        permission: 'notifications.manage',
        context: { tenantId: input.tenantId, projectId: input.projectId },
      });
      if (managers.length > 0) return { kind: 'PROJECT' };
      const readers = await this.access.matchingAssignments({
        userId: input.actorUserId,
        permission: 'notifications.read',
        context: { tenantId: input.tenantId, projectId: input.projectId },
      });
      if (readers.length > 0) return { kind: 'SELF', userId: input.actorUserId };
      throw new ForbiddenException('You do not have permission to export notifications.');
    }

    if (input.dataset === 'accounts') {
      const tenantAdmins = await this.access.matchingAssignments({
        userId: input.actorUserId,
        permission: 'tenant.users.manage',
        context: { tenantId: input.tenantId, projectId: input.projectId },
      });
      if (tenantAdmins.length > 0) return { kind: 'PROJECT' };
      const brokerAdmins = await this.access.matchingAssignments({
        userId: input.actorUserId,
        permission: 'broker.users.manage',
        context: { tenantId: input.tenantId, projectId: input.projectId },
      });
      const brokerIds = [...new Set(brokerAdmins.map((item) => item.brokerCompanyId).filter((value): value is string => Boolean(value)))];
      if (brokerIds.length > 0) return { kind: 'BROKER', brokerCompanyIds: brokerIds, agentUserId: null };
      throw new ForbiddenException('You do not have permission to export accounts.');
    }

    const permission = this.fullPermission(input.dataset);
    const full = await this.access.matchingAssignments({
      userId: input.actorUserId,
      permission,
      context: { tenantId: input.tenantId, projectId: input.projectId },
    });
    const internal = full.filter((assignment) => !BROKER_ROLES.has(assignment.role));
    if (internal.length > 0) return { kind: 'PROJECT' };

    const brokers = full.filter((assignment) => BROKER_ROLES.has(assignment.role) && assignment.brokerCompanyId);
    if (brokers.length > 0) {
      const wide = brokers.filter((assignment) => assignment.role !== 'BROKER_AGENT');
      const effective = wide.length > 0 ? wide : brokers;
      return {
        kind: 'BROKER',
        brokerCompanyIds: [...new Set(effective.map((item) => item.brokerCompanyId!))],
        agentUserId: wide.length === 0 ? input.actorUserId : null,
      };
    }

    const selfPermission = this.selfPermission(input.dataset);
    if (selfPermission) {
      const self = await this.access.matchingAssignments({
        userId: input.actorUserId,
        permission: selfPermission,
        context: {
          tenantId: input.tenantId,
          projectId: input.projectId,
          resourceOwnerUserId: input.actorUserId,
        },
      });
      if (self.length > 0) return { kind: 'SELF', userId: input.actorUserId };
    }

    if (input.dataset === 'refunds') {
      const requester = await this.access.matchingAssignments({
        userId: input.actorUserId,
        permission: 'refund.request',
        context: { tenantId: input.tenantId, projectId: input.projectId },
      });
      if (requester.some((assignment) => assignment.role === 'BUYER')) {
        return { kind: 'SELF', userId: input.actorUserId };
      }
    }

    throw new ForbiddenException(`You do not have permission to export ${input.dataset}.`);
  }

  private fullPermission(dataset: ExportDataset): PermissionCode {
    const map: Record<ExportDataset, PermissionCode> = {
      buyers: 'buyers.read', eois: 'eoi.read', queue: 'queue.read', inventory: 'inventory.read', pricing: 'pricing.read', transactions: 'transaction.read',
      payments: 'payment.read', cheques: 'payment.read', documents: 'documents.read', refunds: 'refund.read', commissions: 'commission.status.read', notifications: 'notifications.read',
      audit: 'audit.read', accounts: 'tenant.users.manage', templates: 'documents.templates.manage',
    };
    return map[dataset];
  }

  private selfPermission(dataset: ExportDataset): PermissionCode | null {
    const map: Partial<Record<ExportDataset, PermissionCode>> = {
      buyers: 'buyers.read.self', eois: 'eoi.read.self', transactions: 'transaction.read.self', payments: 'installment.read.self', documents: 'documents.read.self',
    };
    return map[dataset] ?? null;
  }

  private async rowsFor(
    input: { actorUserId: string; tenantId: string; projectId: string; dataset: ExportDataset },
    scope: ExportScope,
  ): Promise<ExportRow[]> {
    const buyerScope = this.buyerScope(scope);
    switch (input.dataset) {
      case 'buyers':
        return (await sql<ExportRow>`
          SELECT bp.id AS buyer_id, u.display_name AS buyer_name, bp.source, bp.status,
                 bc.name AS broker_company, agent.display_name AS broker_agent, bp.created_at
          FROM buyer_profiles bp
          JOIN users u ON u.id=bp.user_id
          LEFT JOIN broker_companies bc ON bc.id=bp.broker_company_id
          LEFT JOIN users agent ON agent.id=bp.broker_agent_user_id
          WHERE bp.tenant_id=${input.tenantId}::uuid ${buyerScope}
          ORDER BY bp.created_at DESC
        `.execute(this.db)).rows;

      case 'eois':
        return (await sql<ExportRow>`
          SELECT e.id AS eoi_id, u.display_name AS buyer_name, e.amount, e.currency, e.status,
                 p.name AS refund_policy, e.paid_at, e.applied_at, e.refund_requested_at, e.refunded_at, e.created_at
          FROM buyer_eois e JOIN buyer_profiles bp ON bp.id=e.buyer_profile_id JOIN users u ON u.id=bp.user_id
          JOIN eoi_refund_policies p ON p.id=e.refund_policy_id
          WHERE e.tenant_id=${input.tenantId}::uuid AND e.project_id=${input.projectId}::uuid ${buyerScope}
          ORDER BY e.created_at DESC
        `.execute(this.db)).rows;

      case 'queue':
        return (await sql<ExportRow>`
          SELECT q.id AS queue_id, u.display_name AS buyer_name, q.channel, q.priority_group, q.priority_score,
                 q.status, q.checked_in_at, q.called_at, q.completed_at
          FROM queue_entries q JOIN buyer_profiles bp ON bp.id=q.buyer_profile_id JOIN users u ON u.id=bp.user_id
          WHERE q.tenant_id=${input.tenantId}::uuid AND q.project_id=${input.projectId}::uuid ${buyerScope}
          ORDER BY q.checked_in_at
        `.execute(this.db)).rows;

      case 'inventory':
        return (await sql<ExportRow>`
          SELECT ut.code AS unit_type_code, ut.name AS unit_type, ut.bedroom_count, ut.indoor_area_sqm, ut.roof_area_sqm, ut.garden_area_sqm,
                 count(*) FILTER (WHERE s.state='AVAILABLE') AS available,
                 count(*) FILTER (WHERE s.state='RESERVED') AS reserved,
                 count(*) FILTER (WHERE s.state='SOLD') AS sold,
                 count(*) FILTER (WHERE s.state='WITHDRAWN') AS withdrawn
          FROM catalog_unit_types ut LEFT JOIN inventory_slots s ON s.unit_type_id=ut.id
          WHERE ut.tenant_id=${input.tenantId}::uuid AND ut.project_id=${input.projectId}::uuid
          GROUP BY ut.id ORDER BY ut.sort_order, ut.name
        `.execute(this.db)).rows;

      case 'pricing':
        return (await sql<ExportRow>`
          SELECT pv.version_number, pv.label, pv.status, pv.effective_at, ut.code AS unit_type_code, ut.name AS unit_type,
                 pr.component, pr.rate_per_sqm
          FROM pricing_versions pv JOIN pricing_rates pr ON pr.pricing_version_id=pv.id JOIN catalog_unit_types ut ON ut.id=pr.unit_type_id
          WHERE pv.tenant_id=${input.tenantId}::uuid AND pv.project_id=${input.projectId}::uuid
            AND pv.status IN ('PUBLISHED','SCHEDULED')
          ORDER BY pv.version_number DESC, ut.sort_order, pr.component
        `.execute(this.db)).rows;

      case 'transactions':
        return (await sql<ExportRow>`
          SELECT t.id AS transaction_id, u.display_name AS buyer_name, t.status, ut.code AS unit_type_code, ut.name AS unit_type,
                 r.quoted_total, r.currency, t.opened_at, t.completed_at, t.cancelled_at
          FROM transactions t JOIN buyer_profiles bp ON bp.id=t.buyer_profile_id JOIN users u ON u.id=bp.user_id
          JOIN reservations r ON r.id=t.reservation_id JOIN catalog_unit_types ut ON ut.id=r.unit_type_id
          WHERE t.tenant_id=${input.tenantId}::uuid AND t.project_id=${input.projectId}::uuid ${buyerScope}
          ORDER BY t.opened_at DESC
        `.execute(this.db)).rows;

      case 'payments':
        return (await sql<ExportRow>`
          SELECT t.id AS transaction_id, u.display_name AS buyer_name, psi.sequence_number, psi.item_type, psi.amount, psi.due_at, psi.status,
                 COALESCE(sum(a.amount),0) AS net_allocated,
                 (psi.amount - COALESCE(sum(a.amount),0)) AS remaining_amount
          FROM payment_schedule_items psi JOIN payment_schedules ps ON ps.id=psi.payment_schedule_id
          JOIN transactions t ON t.id=ps.transaction_id JOIN buyer_profiles bp ON bp.id=t.buyer_profile_id JOIN users u ON u.id=bp.user_id
          LEFT JOIN finance_payment_allocations a ON a.payment_schedule_item_id=psi.id
          WHERE ps.tenant_id=${input.tenantId}::uuid AND ps.project_id=${input.projectId}::uuid ${buyerScope}
          GROUP BY t.id,u.display_name,psi.id ORDER BY u.display_name, psi.sequence_number
        `.execute(this.db)).rows;

      case 'cheques':
        return (await sql<ExportRow>`
          SELECT t.id AS transaction_id, u.display_name AS buyer_name, c.sequence_number, c.generation, c.amount, c.due_at,
                 c.cheque_number, c.bank_name, c.status, c.received_at
          FROM transaction_cheques c JOIN transactions t ON t.id=c.transaction_id
          JOIN buyer_profiles bp ON bp.id=t.buyer_profile_id JOIN users u ON u.id=bp.user_id
          WHERE c.tenant_id=${input.tenantId}::uuid AND c.project_id=${input.projectId}::uuid ${buyerScope}
          ORDER BY u.display_name,c.sequence_number,c.generation
        `.execute(this.db)).rows;

      case 'documents':
        return (await sql<ExportRow>`
          SELECT t.id AS transaction_id, u.display_name AS buyer_name, d.category, d.revision_number, d.status,
                 d.original_filename, d.mime_type, d.byte_size, d.uploaded_at, d.verified_at
          FROM transaction_documents d JOIN transactions t ON t.id=d.transaction_id
          JOIN buyer_profiles bp ON bp.id=t.buyer_profile_id JOIN users u ON u.id=bp.user_id
          WHERE d.tenant_id=${input.tenantId}::uuid AND d.project_id=${input.projectId}::uuid ${buyerScope}
          ORDER BY d.created_at DESC
        `.execute(this.db)).rows;

      case 'refunds':
        return (await sql<ExportRow>`
          SELECT r.id AS refund_request_id, u.display_name AS buyer_name, r.stage, r.original_eoi_amount, r.refund_percent,
                 r.processing_fee, r.requested_amount, r.currency, r.status, r.requested_at, r.reviewed_at, r.paid_at, r.decision_note
          FROM eoi_refund_requests r JOIN buyer_profiles bp ON bp.id=r.buyer_profile_id JOIN users u ON u.id=bp.user_id
          WHERE r.tenant_id=${input.tenantId}::uuid AND r.project_id=${input.projectId}::uuid ${buyerScope}
          ORDER BY r.requested_at DESC
        `.execute(this.db)).rows;

      case 'commissions': {
        const canAmount = await this.hasPermission(input, 'commission.amount.read');
        const canRate = await this.hasPermission(input, 'commission.rate.read');
        const financialColumns = sql.raw(`${canAmount ? ', c.basis_amount, c.commission_amount' : ''}${canRate ? ', c.rate_percent' : ''}`);
        const brokerCaseScope = this.commissionScope(scope);
        return (await sql<ExportRow>`
          SELECT c.id AS commission_case_id, c.transaction_id, bc.name AS broker_company, agent.display_name AS broker_agent,
                 c.status, c.completion_percent_snapshot, c.eligible_at, c.due_at, c.invoiced_at, c.paid_at
                 ${financialColumns}
          FROM broker_commission_cases c JOIN broker_companies bc ON bc.id=c.broker_company_id
          LEFT JOIN users agent ON agent.id=c.broker_agent_user_id
          WHERE c.tenant_id=${input.tenantId}::uuid AND c.project_id=${input.projectId}::uuid ${brokerCaseScope}
          ORDER BY c.created_at DESC
        `.execute(this.db)).rows;
      }

      case 'notifications': {
        const recipientScope = scope.kind === 'SELF' ? sql`AND n.recipient_user_id=${scope.userId}::uuid` : sql``;
        return (await sql<ExportRow>`
          SELECT n.id AS notification_id, u.display_name AS recipient, n.audience, n.channel, n.template_code, n.status,
                 n.scheduled_for, n.sent_at, n.delivered_at, n.read_at, n.attempts
          FROM notification_jobs n JOIN users u ON u.id=n.recipient_user_id
          WHERE n.tenant_id=${input.tenantId}::uuid AND (n.project_id=${input.projectId}::uuid OR n.project_id IS NULL) ${recipientScope}
          ORDER BY n.scheduled_for DESC
        `.execute(this.db)).rows;
      }

      case 'audit':
        return (await sql<ExportRow>`
          SELECT e.id AS event_id, e.transaction_id, actor.display_name AS actor, e.event_type, e.created_at
          FROM transaction_events e JOIN transactions t ON t.id=e.transaction_id LEFT JOIN users actor ON actor.id=e.actor_user_id
          WHERE t.tenant_id=${input.tenantId}::uuid AND t.project_id=${input.projectId}::uuid
          ORDER BY e.created_at DESC
        `.execute(this.db)).rows;

      case 'accounts': {
        const accountScope = scope.kind === 'BROKER'
          ? sql`AND a.broker_company_id = ANY(${scope.brokerCompanyIds}::uuid[])`
          : sql``;
        return (await sql<ExportRow>`
          SELECT u.id AS user_id, u.display_name, u.status AS user_status, a.role_code, a.scope_type,
                 bc.name AS broker_company, a.status AS assignment_status, a.granted_at, a.revoked_at
          FROM access_role_assignments a JOIN users u ON u.id=a.user_id LEFT JOIN broker_companies bc ON bc.id=a.broker_company_id
          WHERE a.tenant_id=${input.tenantId}::uuid AND (a.project_id=${input.projectId}::uuid OR a.project_id IS NULL) ${accountScope}
          ORDER BY u.display_name,a.role_code
        `.execute(this.db)).rows;
      }

      case 'templates':
        return (await sql<ExportRow>`
          SELECT code,name,category,version_number,status,requires_signature,activated_at,created_at
          FROM document_templates
          WHERE tenant_id=${input.tenantId}::uuid AND (project_id=${input.projectId}::uuid OR project_id IS NULL)
          ORDER BY code,project_id NULLS LAST,version_number DESC
        `.execute(this.db)).rows;
    }
  }

  private buyerScope(scope: ExportScope): RawBuilder<unknown> {
    if (scope.kind === 'PROJECT') return sql``;
    if (scope.kind === 'SELF') return sql`AND bp.user_id=${scope.userId}::uuid`;
    return sql`AND bp.broker_company_id = ANY(${scope.brokerCompanyIds}::uuid[])
      ${scope.agentUserId ? sql`AND bp.broker_agent_user_id=${scope.agentUserId}::uuid` : sql``}`;
  }

  private commissionScope(scope: ExportScope): RawBuilder<unknown> {
    if (scope.kind === 'PROJECT') return sql``;
    if (scope.kind === 'BROKER') return sql`AND c.broker_company_id = ANY(${scope.brokerCompanyIds}::uuid[])
      ${scope.agentUserId ? sql`AND c.broker_agent_user_id=${scope.agentUserId}::uuid` : sql``}`;
    return sql`AND FALSE`;
  }

  private async hasPermission(
    input: { actorUserId: string; tenantId: string; projectId: string },
    permission: PermissionCode,
  ): Promise<boolean> {
    return (await this.access.matchingAssignments({
      userId: input.actorUserId,
      permission,
      context: { tenantId: input.tenantId, projectId: input.projectId },
    })).length > 0;
  }

  private async assertProject(tenantId: string, projectId: string): Promise<void> {
    const result = await sql<{ found: boolean }>`SELECT EXISTS(SELECT 1 FROM projects WHERE id=${projectId}::uuid AND tenant_id=${tenantId}::uuid) AS found`.execute(this.db);
    if (!result.rows[0]?.found) throw new NotFoundException('Project not found.');
  }

  private toCsv(rows: ExportRow[]): string {
    if (rows.length === 0) return '\uFEFF';
    const headers = Object.keys(rows[0]!);
    const lines = [headers.map((value) => this.csvCell(value)).join(',')];
    for (const row of rows) lines.push(headers.map((header) => this.csvCell(row[header])).join(','));
    return `\uFEFF${lines.join('\r\n')}\r\n`;
  }

  private csvCell(value: unknown): string {
    if (value === null || value === undefined) return '';
    let text = value instanceof Date ? value.toISOString() : typeof value === 'object' ? JSON.stringify(value) : String(value);
    if (/^[=+\-@]/.test(text)) text = `'${text}`;
    return /[",\r\n]/.test(text) ? `"${text.replaceAll('"','""')}"` : text;
  }
}
