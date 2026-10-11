import { Inject, Injectable } from '@nestjs/common';
import { sql, type Kysely, type Transaction } from 'kysely';
import type { Database } from '@preneura/database';
import type {
  DeveloperOnboardingProjectSnapshot,
  DeveloperOnboardingSnapshot,
  ProjectBrandingInput,
  ProjectBrandingSnapshot,
  TenantBrandingInput,
  TenantBrandingSnapshot,
} from '@preneura/contracts/onboarding';
import { DATABASE } from '../database/database.module.js';

type Db = Kysely<Database> | Transaction<Database>;

type TenantRow = {
  tenant_id: string;
  tenant_code: string;
  tenant_name: string;
  tenant_status: 'ACTIVE' | 'SUSPENDED' | 'ARCHIVED';
  onboarding_status: 'SETUP' | 'COMPLETED';
  completed_at: Date | null;
  completed_by: string | null;
};

type BrandingRow = {
  display_name_en: string;
  display_name_ar: string;
  legal_name: string | null;
  primary_color: string;
  secondary_color: string | null;
  website_url: string | null;
  updated_at: Date;
};

type ProjectRow = {
  project_id: string;
  project_code: string;
  project_name: string;
  project_status: 'DRAFT' | 'ACTIVE' | 'PAUSED' | 'CLOSED' | 'ARCHIVED';
  display_name_en: string | null;
  display_name_ar: string | null;
  short_description_en: string | null;
  short_description_ar: string | null;
  primary_color: string | null;
  secondary_color: string | null;
  branding_updated_at: Date | null;
};

type StaffRow = {
  operations_directors: string;
  pending_operations_directors: string;
  active_staff: string;
  invited_staff: string;
};

@Injectable()
export class OnboardingRepository {
  constructor(@Inject(DATABASE) private readonly db: Kysely<Database>) {}

  async snapshot(tenantId: string): Promise<DeveloperOnboardingSnapshot | null> {
    const tenantResult = await sql<TenantRow>`
      SELECT
        t.id AS tenant_id,
        t.code AS tenant_code,
        t.name AS tenant_name,
        t.status AS tenant_status,
        COALESCE(s.status, 'SETUP') AS onboarding_status,
        s.completed_at,
        s.completed_by
      FROM tenants t
      LEFT JOIN developer_onboarding_states s ON s.tenant_id = t.id
      WHERE t.id = ${tenantId}::uuid
    `.execute(this.db);
    const tenant = tenantResult.rows[0];
    if (!tenant) return null;

    const brandingResult = await sql<BrandingRow>`
      SELECT display_name_en, display_name_ar, legal_name, primary_color,
             secondary_color, website_url, updated_at
      FROM developer_tenant_branding
      WHERE tenant_id = ${tenantId}::uuid
    `.execute(this.db);
    const tenantBranding = brandingResult.rows[0];

    const projectResult = await sql<ProjectRow>`
      SELECT
        p.id AS project_id,
        p.code AS project_code,
        p.name AS project_name,
        p.status AS project_status,
        b.display_name_en,
        b.display_name_ar,
        b.short_description_en,
        b.short_description_ar,
        b.primary_color,
        b.secondary_color,
        b.updated_at AS branding_updated_at
      FROM projects p
      LEFT JOIN developer_project_branding b ON b.project_id = p.id
      WHERE p.tenant_id = ${tenantId}::uuid
      ORDER BY p.created_at ASC, p.name ASC
    `.execute(this.db);

    const staffResult = await sql<StaffRow>`
      SELECT
        count(DISTINCT a.user_id) FILTER (
          WHERE a.role_code = 'OPERATIONS_DIRECTOR'
            AND a.scope_type = 'TENANT'
            AND a.tenant_id = ${tenantId}::uuid
            AND a.status = 'ACTIVE'
            AND a.revoked_at IS NULL
        )::text AS operations_directors,
        count(DISTINCT a.user_id) FILTER (
          WHERE a.role_code = 'OPERATIONS_DIRECTOR'
            AND a.scope_type = 'TENANT'
            AND a.tenant_id = ${tenantId}::uuid
            AND a.status = 'ACTIVE'
            AND a.revoked_at IS NULL
            AND (u.status = 'PENDING' OR m.status = 'INVITED')
        )::text AS pending_operations_directors,
        count(DISTINCT m.user_id) FILTER (
          WHERE m.status = 'ACTIVE' AND u.status = 'ACTIVE'
        )::text AS active_staff,
        count(DISTINCT m.user_id) FILTER (
          WHERE m.status = 'INVITED' OR u.status = 'PENDING'
        )::text AS invited_staff
      FROM tenant_memberships m
      JOIN users u ON u.id = m.user_id
      LEFT JOIN access_role_assignments a
        ON a.user_id = m.user_id AND a.tenant_id = m.tenant_id
      WHERE m.tenant_id = ${tenantId}::uuid
    `.execute(this.db);
    const staffRow = staffResult.rows[0] ?? {
      operations_directors: '0',
      pending_operations_directors: '0',
      active_staff: '0',
      invited_staff: '0',
    };

    const projects = projectResult.rows.map((row): DeveloperOnboardingProjectSnapshot => ({
      projectId: row.project_id,
      projectCode: row.project_code,
      projectName: row.project_name,
      projectStatus: row.project_status,
      branding: row.display_name_en && row.display_name_ar && row.branding_updated_at
        ? {
            projectId: row.project_id,
            displayNameEn: row.display_name_en,
            displayNameAr: row.display_name_ar,
            shortDescriptionEn: row.short_description_en,
            shortDescriptionAr: row.short_description_ar,
            primaryColor: row.primary_color,
            secondaryColor: row.secondary_color,
            updatedAt: row.branding_updated_at.toISOString(),
          }
        : null,
    }));

    const currentProjects = projects.filter((project) => project.projectStatus !== 'ARCHIVED');
    const brandingConfigured = Boolean(tenantBranding);
    const operationsDirectorAssigned = Number(staffRow.operations_directors) > 0;
    const projectCreated = currentProjects.length > 0;
    const projectBrandingConfigured = projectCreated && currentProjects.every((project) => project.branding !== null);
    const ready =
      tenant.tenant_status === 'ACTIVE' &&
      brandingConfigured &&
      operationsDirectorAssigned &&
      projectCreated &&
      projectBrandingConfigured;

    return {
      tenantId: tenant.tenant_id,
      tenantCode: tenant.tenant_code,
      tenantName: tenant.tenant_name,
      tenantStatus: tenant.tenant_status,
      status: tenant.onboarding_status,
      completedAt: tenant.completed_at?.toISOString() ?? null,
      completedBy: tenant.completed_by,
      branding: tenantBranding ? this.mapTenantBranding(tenantBranding) : null,
      projects,
      staff: {
        operationsDirectors: Number(staffRow.operations_directors),
        pendingOperationsDirectors: Number(staffRow.pending_operations_directors),
        activeStaff: Number(staffRow.active_staff),
        invitedStaff: Number(staffRow.invited_staff),
      },
      readiness: {
        brandingConfigured,
        operationsDirectorAssigned,
        projectCreated,
        projectBrandingConfigured,
        ready,
      },
    };
  }

  async upsertTenantBranding(input: {
    tenantId: string;
    actorUserId: string;
    data: TenantBrandingInput;
  }): Promise<void> {
    await this.db.transaction().execute(async (trx) => {
      const result = await sql`
        INSERT INTO developer_tenant_branding (
          tenant_id, display_name_en, display_name_ar, legal_name, primary_color,
          secondary_color, website_url, updated_by
        ) VALUES (
          ${input.tenantId}::uuid, ${input.data.displayNameEn}, ${input.data.displayNameAr},
          ${input.data.legalName ?? null}, ${input.data.primaryColor},
          ${input.data.secondaryColor ?? null}, ${input.data.websiteUrl ?? null}, ${input.actorUserId}::uuid
        )
        ON CONFLICT (tenant_id) DO UPDATE
        SET display_name_en = EXCLUDED.display_name_en,
            display_name_ar = EXCLUDED.display_name_ar,
            legal_name = EXCLUDED.legal_name,
            primary_color = EXCLUDED.primary_color,
            secondary_color = EXCLUDED.secondary_color,
            website_url = EXCLUDED.website_url,
            updated_by = EXCLUDED.updated_by,
            updated_at = now()
      `.execute(trx);
      if (Number(result.numAffectedRows ?? 0) === 0) throw new Error('TENANT_BRANDING_NOT_UPDATED');
      await this.recordEvent(trx, {
        tenantId: input.tenantId,
        projectId: null,
        actorUserId: input.actorUserId,
        eventType: 'TENANT_BRANDING_UPDATED',
        metadata: { displayNameEn: input.data.displayNameEn, displayNameAr: input.data.displayNameAr },
      });
    });
  }

  async upsertProjectBranding(input: {
    tenantId: string;
    projectId: string;
    actorUserId: string;
    data: ProjectBrandingInput;
  }): Promise<boolean> {
    return this.db.transaction().execute(async (trx) => {
      const project = await sql<{ id: string }>`
        SELECT id FROM projects
        WHERE id = ${input.projectId}::uuid AND tenant_id = ${input.tenantId}::uuid
        FOR UPDATE
      `.execute(trx);
      if (!project.rows[0]) return false;

      await sql`
        INSERT INTO developer_project_branding (
          project_id, tenant_id, display_name_en, display_name_ar,
          short_description_en, short_description_ar, primary_color, secondary_color, updated_by
        ) VALUES (
          ${input.projectId}::uuid, ${input.tenantId}::uuid,
          ${input.data.displayNameEn}, ${input.data.displayNameAr},
          ${input.data.shortDescriptionEn ?? null}, ${input.data.shortDescriptionAr ?? null},
          ${input.data.primaryColor ?? null}, ${input.data.secondaryColor ?? null}, ${input.actorUserId}::uuid
        )
        ON CONFLICT (project_id) DO UPDATE
        SET display_name_en = EXCLUDED.display_name_en,
            display_name_ar = EXCLUDED.display_name_ar,
            short_description_en = EXCLUDED.short_description_en,
            short_description_ar = EXCLUDED.short_description_ar,
            primary_color = EXCLUDED.primary_color,
            secondary_color = EXCLUDED.secondary_color,
            updated_by = EXCLUDED.updated_by,
            updated_at = now()
      `.execute(trx);
      await this.recordEvent(trx, {
        tenantId: input.tenantId,
        projectId: input.projectId,
        actorUserId: input.actorUserId,
        eventType: 'PROJECT_BRANDING_UPDATED',
        metadata: { displayNameEn: input.data.displayNameEn, displayNameAr: input.data.displayNameAr },
      });
      return true;
    });
  }

  async complete(tenantId: string, actorUserId: string): Promise<boolean> {
    return this.db.transaction().execute(async (trx) => {
      await sql`
        INSERT INTO developer_onboarding_states (tenant_id, status)
        VALUES (${tenantId}::uuid, 'SETUP')
        ON CONFLICT (tenant_id) DO NOTHING
      `.execute(trx);

      const result = await sql<{ tenant_id: string }>`
        UPDATE developer_onboarding_states state
        SET status = 'COMPLETED', completed_at = now(), completed_by = ${actorUserId}::uuid, updated_at = now()
        WHERE state.tenant_id = ${tenantId}::uuid
          AND state.status = 'SETUP'
          AND EXISTS (
            SELECT 1 FROM tenants t
            WHERE t.id = state.tenant_id AND t.status = 'ACTIVE'
          )
          AND EXISTS (
            SELECT 1 FROM developer_tenant_branding b
            WHERE b.tenant_id = state.tenant_id
          )
          AND EXISTS (
            SELECT 1
            FROM access_role_assignments a
            JOIN tenant_memberships m ON m.tenant_id = a.tenant_id AND m.user_id = a.user_id
            JOIN users u ON u.id = a.user_id
            WHERE a.tenant_id = state.tenant_id
              AND a.role_code = 'OPERATIONS_DIRECTOR'
              AND a.scope_type = 'TENANT'
              AND a.status = 'ACTIVE'
              AND a.revoked_at IS NULL
              AND m.status IN ('ACTIVE','INVITED')
              AND u.status IN ('ACTIVE','PENDING')
          )
          AND EXISTS (
            SELECT 1 FROM projects p
            WHERE p.tenant_id = state.tenant_id AND p.status <> 'ARCHIVED'
          )
          AND NOT EXISTS (
            SELECT 1
            FROM projects p
            LEFT JOIN developer_project_branding b ON b.project_id = p.id
            WHERE p.tenant_id = state.tenant_id
              AND p.status <> 'ARCHIVED'
              AND b.project_id IS NULL
          )
        RETURNING state.tenant_id
      `.execute(trx);

      if (!result.rows[0]) {
        const existing = await sql<{ status: string }>`
          SELECT status FROM developer_onboarding_states WHERE tenant_id = ${tenantId}::uuid
        `.execute(trx);
        return existing.rows[0]?.status === 'COMPLETED';
      }

      await this.recordEvent(trx, {
        tenantId,
        projectId: null,
        actorUserId,
        eventType: 'ONBOARDING_COMPLETED',
        metadata: {},
      });
      return true;
    });
  }

  async recordOperationsDirectorInvited(input: {
    tenantId: string;
    actorUserId: string;
    userId: string;
  }): Promise<void> {
    await this.recordEvent(this.db, {
      tenantId: input.tenantId,
      projectId: null,
      actorUserId: input.actorUserId,
      eventType: 'OPERATIONS_DIRECTOR_INVITED',
      metadata: { userId: input.userId },
    });
  }

  private mapTenantBranding(row: BrandingRow): TenantBrandingSnapshot {
    return {
      displayNameEn: row.display_name_en,
      displayNameAr: row.display_name_ar,
      legalName: row.legal_name,
      primaryColor: row.primary_color,
      secondaryColor: row.secondary_color,
      websiteUrl: row.website_url,
      updatedAt: row.updated_at.toISOString(),
    };
  }

  private async recordEvent(
    db: Db,
    input: {
      tenantId: string;
      projectId: string | null;
      actorUserId: string;
      eventType:
        | 'TENANT_BRANDING_UPDATED'
        | 'PROJECT_BRANDING_UPDATED'
        | 'OPERATIONS_DIRECTOR_INVITED'
        | 'ONBOARDING_COMPLETED';
      metadata: Record<string, unknown>;
    },
  ): Promise<void> {
    await sql`
      INSERT INTO developer_onboarding_events (
        tenant_id, project_id, actor_user_id, event_type, metadata
      ) VALUES (
        ${input.tenantId}::uuid, ${input.projectId}::uuid, ${input.actorUserId}::uuid,
        ${input.eventType}, ${JSON.stringify(input.metadata)}::jsonb
      )
    `.execute(db);
  }
}
