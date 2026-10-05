import { Inject, Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import type { Database } from '@preneura/database';
import type {
  CreateProjectInput,
  CreateTenantInput,
  PlatformControlPlaneSnapshot,
  PlatformProjectSnapshot,
  PlatformTenantSnapshot,
  SupportAccessSessionSnapshot,
} from '@preneura/contracts/platform-admin';
import { DATABASE } from '../database/database.module.js';

type MetricRow = {
  tenants: string;
  active_tenants: string;
  projects: string;
  active_projects: string;
  users: string;
  transactions: string;
  open_transactions: string;
  failed_notifications: string;
  due_commissions: string;
};

type TenantRow = {
  tenant_id: string;
  code: string;
  name: string;
  status: 'ACTIVE' | 'SUSPENDED' | 'ARCHIVED';
  default_currency: string;
  default_timezone: string;
  project_count: string;
  active_project_count: string;
  user_count: string;
  transaction_count: string;
  open_transaction_count: string;
  failed_notification_count: string;
};

type SupportRow = {
  session_id: string;
  operator_user_id: string;
  tenant_id: string;
  project_id: string | null;
  tenant_name: string;
  project_name: string | null;
  reason: string;
  status: 'ACTIVE' | 'ENDED' | 'EXPIRED';
  started_at: Date;
  expires_at: Date;
  ended_at: Date | null;
};

@Injectable()
export class PlatformAdminRepository {
  constructor(@Inject(DATABASE) private readonly db: Kysely<Database>) {}

  async snapshot(): Promise<PlatformControlPlaneSnapshot> {
    const metricResult = await sql<MetricRow>`
      SELECT
        (SELECT count(*) FROM tenants) AS tenants,
        (SELECT count(*) FROM tenants WHERE status = 'ACTIVE') AS active_tenants,
        (SELECT count(*) FROM projects) AS projects,
        (SELECT count(*) FROM projects WHERE status = 'ACTIVE') AS active_projects,
        (SELECT count(*) FROM users) AS users,
        (SELECT count(*) FROM transactions) AS transactions,
        (SELECT count(*) FROM transactions WHERE status IN ('IN_PROGRESS','READY_FOR_COMPLETION')) AS open_transactions,
        (SELECT count(*) FROM notification_jobs WHERE status = 'FAILED') AS failed_notifications,
        (SELECT count(*) FROM broker_commission_cases WHERE status = 'DUE') AS due_commissions
    `.execute(this.db);
    const metric = metricResult.rows[0]!;

    const tenantResult = await sql<TenantRow>`
      SELECT
        tenant.id AS tenant_id,
        tenant.code,
        tenant.name,
        tenant.status,
        tenant.default_currency,
        tenant.default_timezone,
        count(DISTINCT project.id)::text AS project_count,
        count(DISTINCT project.id) FILTER (WHERE project.status = 'ACTIVE')::text AS active_project_count,
        count(DISTINCT membership.user_id)::text AS user_count,
        count(DISTINCT transaction.id)::text AS transaction_count,
        count(DISTINCT transaction.id) FILTER (
          WHERE transaction.status IN ('IN_PROGRESS','READY_FOR_COMPLETION')
        )::text AS open_transaction_count,
        count(DISTINCT failed_job.id)::text AS failed_notification_count
      FROM tenants tenant
      LEFT JOIN projects project ON project.tenant_id = tenant.id
      LEFT JOIN tenant_memberships membership ON membership.tenant_id = tenant.id
      LEFT JOIN transactions transaction ON transaction.tenant_id = tenant.id
      LEFT JOIN notification_jobs failed_job
        ON failed_job.tenant_id = tenant.id AND failed_job.status = 'FAILED'
      GROUP BY tenant.id
      ORDER BY tenant.name ASC
    `.execute(this.db);

    return {
      metrics: {
        tenants: Number(metric.tenants),
        activeTenants: Number(metric.active_tenants),
        projects: Number(metric.projects),
        activeProjects: Number(metric.active_projects),
        users: Number(metric.users),
        transactions: Number(metric.transactions),
        openTransactions: Number(metric.open_transactions),
        failedNotifications: Number(metric.failed_notifications),
        dueCommissions: Number(metric.due_commissions),
      },
      tenants: tenantResult.rows.map((row): PlatformTenantSnapshot => ({
        tenantId: row.tenant_id,
        code: row.code,
        name: row.name,
        status: row.status,
        defaultCurrency: row.default_currency,
        defaultTimezone: row.default_timezone,
        projectCount: Number(row.project_count),
        activeProjectCount: Number(row.active_project_count),
        userCount: Number(row.user_count),
        transactionCount: Number(row.transaction_count),
        openTransactionCount: Number(row.open_transaction_count),
        failedNotificationCount: Number(row.failed_notification_count),
      })),
      activeSupportSessions: await this.listSupportSessions(true),
    };
  }

  async listProjects(tenantId: string): Promise<PlatformProjectSnapshot[]> {
    const result = await sql<{
      project_id: string; tenant_id: string; code: string; name: string;
      status: 'DRAFT' | 'ACTIVE' | 'PAUSED' | 'CLOSED' | 'ARCHIVED';
      currency: string; timezone: string; transaction_count: string;
      open_transaction_count: string; buyer_count: string; broker_company_count: string;
    }>`
      SELECT
        project.id AS project_id,
        project.tenant_id,
        project.code,
        project.name,
        project.status,
        project.currency,
        project.timezone,
        count(DISTINCT transaction.id)::text AS transaction_count,
        count(DISTINCT transaction.id) FILTER (
          WHERE transaction.status IN ('IN_PROGRESS','READY_FOR_COMPLETION')
        )::text AS open_transaction_count,
        count(DISTINCT buyer.id)::text AS buyer_count,
        count(DISTINCT broker_access.broker_company_id)::text AS broker_company_count
      FROM projects project
      LEFT JOIN transactions transaction ON transaction.project_id = project.id
      LEFT JOIN buyer_profiles buyer ON buyer.tenant_id = project.tenant_id
      LEFT JOIN broker_project_access broker_access
        ON broker_access.project_id = project.id AND broker_access.status = 'ACTIVE'
      WHERE project.tenant_id = ${tenantId}::uuid
      GROUP BY project.id
      ORDER BY project.name ASC
    `.execute(this.db);

    return result.rows.map((row) => ({
      projectId: row.project_id,
      tenantId: row.tenant_id,
      code: row.code,
      name: row.name,
      status: row.status,
      currency: row.currency,
      timezone: row.timezone,
      transactionCount: Number(row.transaction_count),
      openTransactionCount: Number(row.open_transaction_count),
      buyerCount: Number(row.buyer_count),
      brokerCompanyCount: Number(row.broker_company_count),
    }));
  }

  async createTenant(input: CreateTenantInput, actorUserId: string): Promise<{ tenantId: string }> {
    return this.db.transaction().execute(async (trx) => {
      const tenant = await trx.insertInto('tenants').values({
        code: input.code.toUpperCase(),
        name: input.name,
        status: 'ACTIVE',
        default_currency: input.defaultCurrency,
        default_timezone: input.defaultTimezone,
      }).returning('id').executeTakeFirstOrThrow();
      await trx.insertInto('domain_outbox_events').values({
        tenant_id: tenant.id,
        project_id: null,
        aggregate_type: 'TENANT',
        aggregate_id: tenant.id,
        event_type: 'tenant.created',
        payload: { actorUserId, code: input.code.toUpperCase(), name: input.name },
        attempts: 0,
      }).execute();
      return { tenantId: tenant.id };
    });
  }

  async createProject(tenantId: string, input: CreateProjectInput, actorUserId: string): Promise<{ projectId: string }> {
    return this.db.transaction().execute(async (trx) => {
      const project = await trx.insertInto('projects').values({
        tenant_id: tenantId,
        code: input.code.toUpperCase(),
        name: input.name,
        status: 'DRAFT',
        currency: input.currency,
        timezone: input.timezone,
      }).returning('id').executeTakeFirstOrThrow();
      await trx.insertInto('domain_outbox_events').values({
        tenant_id: tenantId,
        project_id: project.id,
        aggregate_type: 'PROJECT',
        aggregate_id: project.id,
        event_type: 'project.created',
        payload: { actorUserId, code: input.code.toUpperCase(), name: input.name },
        attempts: 0,
      }).execute();
      return { projectId: project.id };
    });
  }

  async setTenantStatus(tenantId: string, status: 'ACTIVE' | 'SUSPENDED' | 'ARCHIVED', actorUserId: string): Promise<boolean> {
    return this.db.transaction().execute(async (trx) => {
      const updated = await trx.updateTable('tenants').set({ status }).where('id', '=', tenantId).executeTakeFirst();
      if (Number(updated.numUpdatedRows) === 0) return false;
      await trx.insertInto('domain_outbox_events').values({
        tenant_id: tenantId, project_id: null, aggregate_type: 'TENANT', aggregate_id: tenantId,
        event_type: 'tenant.status_changed', payload: { actorUserId, status }, attempts: 0,
      }).execute();
      return true;
    });
  }

  async setProjectStatus(tenantId: string, projectId: string, status: 'DRAFT' | 'ACTIVE' | 'PAUSED' | 'CLOSED' | 'ARCHIVED', actorUserId: string): Promise<boolean> {
    return this.db.transaction().execute(async (trx) => {
      const updated = await trx.updateTable('projects').set({ status })
        .where('id', '=', projectId).where('tenant_id', '=', tenantId).executeTakeFirst();
      if (Number(updated.numUpdatedRows) === 0) return false;
      await trx.insertInto('domain_outbox_events').values({
        tenant_id: tenantId, project_id: projectId, aggregate_type: 'PROJECT', aggregate_id: projectId,
        event_type: 'project.status_changed', payload: { actorUserId, status }, attempts: 0,
      }).execute();
      return true;
    });
  }

  async startSupportSession(input: {
    operatorUserId: string; tenantId: string; projectId: string | null;
    reason: string; durationMinutes: number;
  }): Promise<SupportAccessSessionSnapshot> {
    return this.db.transaction().execute(async (trx) => {
      await sql`
        UPDATE platform_support_access_sessions
        SET status = 'EXPIRED'
        WHERE operator_user_id = ${input.operatorUserId}::uuid
          AND status = 'ACTIVE' AND expires_at <= now()
      `.execute(trx);
      const result = await sql<SupportRow>`
        INSERT INTO platform_support_access_sessions (
          operator_user_id, tenant_id, project_id, reason, expires_at
        ) VALUES (
          ${input.operatorUserId}::uuid, ${input.tenantId}::uuid, ${input.projectId}::uuid,
          ${input.reason}, now() + (${input.durationMinutes}::text || ' minutes')::interval
        )
        RETURNING
          id AS session_id, operator_user_id, tenant_id, project_id, reason, status,
          started_at, expires_at, ended_at,
          (SELECT name FROM tenants WHERE id = tenant_id) AS tenant_name,
          (SELECT name FROM projects WHERE id = project_id) AS project_name
      `.execute(trx);
      return this.mapSupport(result.rows[0]!);
    });
  }

  async endSupportSession(operatorUserId: string, sessionId: string): Promise<boolean> {
    const result = await sql`
      UPDATE platform_support_access_sessions
      SET status = 'ENDED', ended_at = now()
      WHERE id = ${sessionId}::uuid
        AND operator_user_id = ${operatorUserId}::uuid
        AND status = 'ACTIVE'
    `.execute(this.db);
    return Number(result.numAffectedRows ?? 0) > 0;
  }

  async listSupportSessions(activeOnly = false): Promise<SupportAccessSessionSnapshot[]> {
    await sql`
      UPDATE platform_support_access_sessions
      SET status = 'EXPIRED'
      WHERE status = 'ACTIVE' AND expires_at <= now()
    `.execute(this.db);
    const result = activeOnly
      ? await sql<SupportRow>`
          SELECT s.id AS session_id, s.operator_user_id, s.tenant_id, s.project_id,
                 t.name AS tenant_name, p.name AS project_name, s.reason, s.status,
                 s.started_at, s.expires_at, s.ended_at
          FROM platform_support_access_sessions s
          JOIN tenants t ON t.id = s.tenant_id
          LEFT JOIN projects p ON p.id = s.project_id
          WHERE s.status = 'ACTIVE'
          ORDER BY s.expires_at ASC
        `.execute(this.db)
      : await sql<SupportRow>`
          SELECT s.id AS session_id, s.operator_user_id, s.tenant_id, s.project_id,
                 t.name AS tenant_name, p.name AS project_name, s.reason, s.status,
                 s.started_at, s.expires_at, s.ended_at
          FROM platform_support_access_sessions s
          JOIN tenants t ON t.id = s.tenant_id
          LEFT JOIN projects p ON p.id = s.project_id
          ORDER BY s.started_at DESC LIMIT 200
        `.execute(this.db);
    return result.rows.map((row) => this.mapSupport(row));
  }

  private mapSupport(row: SupportRow): SupportAccessSessionSnapshot {
    return {
      sessionId: row.session_id,
      operatorUserId: row.operator_user_id,
      tenantId: row.tenant_id,
      projectId: row.project_id,
      tenantName: row.tenant_name,
      projectName: row.project_name,
      reason: row.reason,
      status: row.status,
      startedAt: row.started_at.toISOString(),
      expiresAt: row.expires_at.toISOString(),
      endedAt: row.ended_at?.toISOString() ?? null,
    };
  }
}
