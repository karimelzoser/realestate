import { Inject, Injectable } from '@nestjs/common';
import { sql, type Kysely, type Transaction } from 'kysely';
import type { Database } from '@preneura/database';
import type {
  BrokerageAgreementInput,
  BrokerageAgreementSnapshot,
  BrokerageAttributionTransferInput,
  BrokerageAttributionTransferSnapshot,
  BrokerageOnboardingSnapshot,
  BrokerageOrganizationInput,
  BrokerageOrganizationSnapshot,
  BrokerageProjectAccessInput,
} from '@preneura/contracts/brokerage-onboarding';
import { DATABASE } from '../database/database.module.js';

type Db = Kysely<Database> | Transaction<Database>;

@Injectable()
export class BrokerageOnboardingRepository {
  constructor(@Inject(DATABASE) private readonly db: Kysely<Database>) {}

  async workspace(tenantId: string, brokerCompanyIds: string[] | null): Promise<BrokerageOnboardingSnapshot> {
    const scope = brokerCompanyIds === null
      ? sql``
      : sql`AND link.broker_company_id = ANY(${brokerCompanyIds}::uuid[])`;

    const organizations = await sql<{
      organization_id: string; organization_code: string; display_name_en: string; display_name_ar: string;
      legal_name: string | null; organization_status: BrokerageOrganizationSnapshot['status'];
      broker_company_id: string; local_company_code: string; local_company_name: string;
      local_status: BrokerageOrganizationSnapshot['localStatus'];
    }>`
      SELECT org.id AS organization_id, org.code AS organization_code,
             org.display_name_en, org.display_name_ar, org.legal_name,
             org.status AS organization_status, link.broker_company_id,
             company.code AS local_company_code, company.name AS local_company_name,
             company.status AS local_status
      FROM brokerage_tenant_links link
      JOIN brokerage_organizations org ON org.id = link.organization_id
      JOIN broker_companies company ON company.id = link.broker_company_id
      WHERE link.tenant_id = ${tenantId}::uuid ${scope}
      ORDER BY org.display_name_en, org.id
    `.execute(this.db);

    const agreementScope = brokerCompanyIds === null
      ? sql``
      : sql`AND agreement.broker_company_id = ANY(${brokerCompanyIds}::uuid[])`;
    const agreements = await sql<{
      agreement_id: string; organization_id: string; broker_company_id: string; version_number: number;
      agreement_code: string; status: BrokerageAgreementSnapshot['status']; effective_from: Date; effective_to: Date | null;
      commercial_terms: Record<string, unknown>; approved_at: Date | null;
    }>`
      SELECT agreement.id AS agreement_id, agreement.organization_id, agreement.broker_company_id,
             agreement.version_number, agreement.agreement_code, agreement.status,
             agreement.effective_from, agreement.effective_to, agreement.commercial_terms, agreement.approved_at
      FROM brokerage_agreements agreement
      WHERE agreement.tenant_id = ${tenantId}::uuid ${agreementScope}
      ORDER BY agreement.created_at DESC, agreement.id DESC
    `.execute(this.db);

    const agreementIds = agreements.rows.map((row) => row.agreement_id);
    const projects = agreementIds.length === 0 ? [] : (await sql<{
      agreement_id: string; project_id: string; project_code: string; project_name: string;
      status: 'ACTIVE' | 'SUSPENDED' | 'EXPIRED'; effective_from: Date; effective_to: Date | null;
    }>`
      SELECT ap.agreement_id, ap.project_id, project.code AS project_code, project.name AS project_name,
             ap.status, ap.effective_from, ap.effective_to
      FROM brokerage_agreement_projects ap
      JOIN projects project ON project.id = ap.project_id
      WHERE ap.agreement_id = ANY(${agreementIds}::uuid[])
      ORDER BY project.name, ap.project_id
    `.execute(this.db)).rows;

    const transfers = await this.listTransfers(tenantId, brokerCompanyIds);

    return {
      tenantId,
      organizations: organizations.rows.map((row) => ({
        organizationId: row.organization_id,
        organizationCode: row.organization_code,
        displayNameEn: row.display_name_en,
        displayNameAr: row.display_name_ar,
        legalName: row.legal_name,
        status: row.organization_status,
        tenantId,
        brokerCompanyId: row.broker_company_id,
        localCompanyCode: row.local_company_code,
        localCompanyName: row.local_company_name,
        localStatus: row.local_status,
      })),
      agreements: agreements.rows.map((row) => ({
        agreementId: row.agreement_id,
        organizationId: row.organization_id,
        tenantId,
        brokerCompanyId: row.broker_company_id,
        versionNumber: row.version_number,
        agreementCode: row.agreement_code,
        status: row.status,
        effectiveFrom: row.effective_from.toISOString(),
        effectiveTo: row.effective_to?.toISOString() ?? null,
        commercialTerms: row.commercial_terms,
        approvedAt: row.approved_at?.toISOString() ?? null,
        projects: projects.filter((project) => project.agreement_id === row.agreement_id).map((project) => ({
          projectId: project.project_id,
          projectCode: project.project_code,
          projectName: project.project_name,
          status: project.status,
          effectiveFrom: project.effective_from.toISOString(),
          effectiveTo: project.effective_to?.toISOString() ?? null,
        })),
      })),
      transfers,
    };
  }

  async upsertOrganization(input: {
    tenantId: string; actorUserId: string; data: BrokerageOrganizationInput;
  }): Promise<{ organizationId: string; brokerCompanyId: string }> {
    return this.db.transaction().execute(async (trx) => {
      const existing = await sql<{ id: string; display_name_en: string; display_name_ar: string }>`
        SELECT id, display_name_en, display_name_ar
        FROM brokerage_organizations WHERE code = ${input.data.organizationCode} FOR UPDATE
      `.execute(trx);
      let organizationId = existing.rows[0]?.id;
      if (existing.rows[0] && (
        existing.rows[0].display_name_en !== input.data.displayNameEn ||
        existing.rows[0].display_name_ar !== input.data.displayNameAr
      )) {
        throw new Error('BROKERAGE_CODE_NAME_MISMATCH');
      }
      if (!organizationId) {
        const created = await sql<{ id: string }>`
          INSERT INTO brokerage_organizations (
            code, display_name_en, display_name_ar, legal_name, created_by
          ) VALUES (
            ${input.data.organizationCode}, ${input.data.displayNameEn}, ${input.data.displayNameAr},
            ${input.data.legalName ?? null}, ${input.actorUserId}::uuid
          ) RETURNING id
        `.execute(trx);
        organizationId = created.rows[0]!.id;
      }

      const linked = await sql<{ broker_company_id: string }>`
        SELECT broker_company_id FROM brokerage_tenant_links
        WHERE organization_id = ${organizationId}::uuid AND tenant_id = ${input.tenantId}::uuid
        FOR UPDATE
      `.execute(trx);
      if (linked.rows[0]) return { organizationId, brokerCompanyId: linked.rows[0].broker_company_id };

      const company = await sql<{ id: string }>`
        INSERT INTO broker_companies (tenant_id, code, name, status)
        VALUES (${input.tenantId}::uuid, ${input.data.localCompanyCode}, ${input.data.displayNameEn}, 'ACTIVE')
        RETURNING id
      `.execute(trx);
      const brokerCompanyId = company.rows[0]!.id;
      await sql`
        INSERT INTO brokerage_tenant_links (
          organization_id, tenant_id, broker_company_id, status, linked_by
        ) VALUES (
          ${organizationId}::uuid, ${input.tenantId}::uuid, ${brokerCompanyId}::uuid, 'ACTIVE', ${input.actorUserId}::uuid
        )
      `.execute(trx);
      return { organizationId, brokerCompanyId };
    });
  }

  async createAgreement(input: {
    tenantId: string; actorUserId: string; data: BrokerageAgreementInput;
  }): Promise<string> {
    return this.db.transaction().execute(async (trx) => {
      const link = await sql<{ broker_company_id: string }>`
        SELECT broker_company_id FROM brokerage_tenant_links
        WHERE organization_id = ${input.data.organizationId}::uuid AND tenant_id = ${input.tenantId}::uuid
        FOR UPDATE
      `.execute(trx);
      if (!link.rows[0]) throw new Error('BROKERAGE_NOT_LINKED_TO_TENANT');
      const version = await sql<{ next_version: number }>`
        SELECT COALESCE(max(version_number), 0)::int + 1 AS next_version
        FROM brokerage_agreements
        WHERE organization_id = ${input.data.organizationId}::uuid AND tenant_id = ${input.tenantId}::uuid
      `.execute(trx);
      const result = await sql<{ id: string }>`
        INSERT INTO brokerage_agreements (
          organization_id, tenant_id, broker_company_id, version_number, agreement_code,
          status, effective_from, effective_to, commercial_terms, created_by
        ) VALUES (
          ${input.data.organizationId}::uuid, ${input.tenantId}::uuid, ${link.rows[0].broker_company_id}::uuid,
          ${version.rows[0]?.next_version ?? 1}, ${input.data.agreementCode}, 'DRAFT',
          ${input.data.effectiveFrom}::timestamptz, ${input.data.effectiveTo ?? null}::timestamptz,
          ${JSON.stringify(input.data.commercialTerms)}::jsonb, ${input.actorUserId}::uuid
        ) RETURNING id
      `.execute(trx);
      return result.rows[0]!.id;
    });
  }

  async activateAgreement(input: { tenantId: string; agreementId: string; actorUserId: string }): Promise<boolean> {
    return this.db.transaction().execute(async (trx) => {
      const agreement = await sql<{ organization_id: string }>`
        SELECT organization_id FROM brokerage_agreements
        WHERE id = ${input.agreementId}::uuid AND tenant_id = ${input.tenantId}::uuid
        FOR UPDATE
      `.execute(trx);
      if (!agreement.rows[0]) return false;
      await sql`
        UPDATE brokerage_agreements
        SET status = 'SUSPENDED', updated_at = now()
        WHERE tenant_id = ${input.tenantId}::uuid
          AND organization_id = ${agreement.rows[0].organization_id}::uuid
          AND id <> ${input.agreementId}::uuid
          AND status = 'ACTIVE'
      `.execute(trx);
      const updated = await sql<{ id: string }>`
        UPDATE brokerage_agreements
        SET status = 'ACTIVE', approved_by = ${input.actorUserId}::uuid,
            approved_at = COALESCE(approved_at, now()), updated_at = now()
        WHERE id = ${input.agreementId}::uuid AND tenant_id = ${input.tenantId}::uuid
          AND status IN ('DRAFT','SUSPENDED')
        RETURNING id
      `.execute(trx);
      return Boolean(updated.rows[0]);
    });
  }

  async setProjectAccess(input: {
    tenantId: string; agreementId: string; projectId: string; actorUserId: string; data: BrokerageProjectAccessInput;
  }): Promise<boolean> {
    return this.db.transaction().execute(async (trx) => {
      const agreement = await sql<{ broker_company_id: string }>`
        SELECT broker_company_id FROM brokerage_agreements
        WHERE id = ${input.agreementId}::uuid AND tenant_id = ${input.tenantId}::uuid AND status = 'ACTIVE'
        FOR UPDATE
      `.execute(trx);
      if (!agreement.rows[0]) return false;
      const project = await sql<{ id: string }>`
        SELECT id FROM projects WHERE id = ${input.projectId}::uuid AND tenant_id = ${input.tenantId}::uuid
      `.execute(trx);
      if (!project.rows[0]) return false;

      await sql`
        INSERT INTO brokerage_agreement_projects (
          agreement_id, tenant_id, project_id, status, effective_from, effective_to, granted_by
        ) VALUES (
          ${input.agreementId}::uuid, ${input.tenantId}::uuid, ${input.projectId}::uuid,
          ${input.data.status}, ${input.data.effectiveFrom}::timestamptz,
          ${input.data.effectiveTo ?? null}::timestamptz, ${input.actorUserId}::uuid
        )
        ON CONFLICT (agreement_id, project_id) DO UPDATE
        SET status = EXCLUDED.status, effective_from = EXCLUDED.effective_from,
            effective_to = EXCLUDED.effective_to, granted_by = EXCLUDED.granted_by, updated_at = now()
      `.execute(trx);

      await sql`
        INSERT INTO broker_project_access (
          broker_company_id, tenant_id, project_id, status, effective_from, effective_to
        ) VALUES (
          ${agreement.rows[0].broker_company_id}::uuid, ${input.tenantId}::uuid, ${input.projectId}::uuid,
          ${input.data.status}, ${input.data.effectiveFrom}::timestamptz, ${input.data.effectiveTo ?? null}::timestamptz
        )
        ON CONFLICT (broker_company_id, project_id) DO UPDATE
        SET status = EXCLUDED.status, effective_from = EXCLUDED.effective_from,
            effective_to = EXCLUDED.effective_to
      `.execute(trx);
      return true;
    });
  }

  async buyerAttribution(tenantId: string, buyerProfileId: string): Promise<{
    brokerCompanyId: string | null; brokerAgentUserId: string | null;
  } | null> {
    const result = await sql<{ broker_company_id: string | null; broker_agent_user_id: string | null }>`
      SELECT broker_company_id, broker_agent_user_id
      FROM buyer_profiles
      WHERE id = ${buyerProfileId}::uuid AND tenant_id = ${tenantId}::uuid
    `.execute(this.db);
    const row = result.rows[0];
    return row ? { brokerCompanyId: row.broker_company_id, brokerAgentUserId: row.broker_agent_user_id } : null;
  }

  async targetEligible(input: {
    tenantId: string; projectId: string; brokerCompanyId: string; brokerAgentUserId: string | null;
  }): Promise<boolean> {
    const result = await sql<{ ok: boolean }>`
      SELECT EXISTS (
        SELECT 1
        FROM broker_project_access access
        JOIN brokerage_agreements agreement
          ON agreement.tenant_id = access.tenant_id
         AND agreement.broker_company_id = access.broker_company_id
         AND agreement.status = 'ACTIVE'
         AND agreement.effective_from <= now()
         AND (agreement.effective_to IS NULL OR agreement.effective_to > now())
        JOIN brokerage_agreement_projects ap
          ON ap.agreement_id = agreement.id AND ap.project_id = access.project_id
         AND ap.status = 'ACTIVE' AND ap.effective_from <= now()
         AND (ap.effective_to IS NULL OR ap.effective_to > now())
        WHERE access.tenant_id = ${input.tenantId}::uuid
          AND access.project_id = ${input.projectId}::uuid
          AND access.broker_company_id = ${input.brokerCompanyId}::uuid
          AND access.status = 'ACTIVE'
          AND access.effective_from <= now()
          AND (access.effective_to IS NULL OR access.effective_to > now())
      ) AS ok
    `.execute(this.db);
    if (!result.rows[0]?.ok) return false;
    if (!input.brokerAgentUserId) return true;
    const agent = await sql<{ ok: boolean }>`
      SELECT EXISTS (
        SELECT 1 FROM access_role_assignments assignment
        WHERE assignment.user_id = ${input.brokerAgentUserId}::uuid
          AND assignment.role_code = 'BROKER_AGENT'
          AND assignment.scope_type = 'BROKER_COMPANY'
          AND assignment.tenant_id = ${input.tenantId}::uuid
          AND assignment.broker_company_id = ${input.brokerCompanyId}::uuid
          AND assignment.status = 'ACTIVE' AND assignment.revoked_at IS NULL
      ) AS ok
    `.execute(this.db);
    return Boolean(agent.rows[0]?.ok);
  }

  async createTransfer(input: {
    tenantId: string; actorUserId: string; data: BrokerageAttributionTransferInput;
    fromBrokerCompanyId: string | null; fromBrokerAgentUserId: string | null;
  }): Promise<string> {
    const result = await sql<{ id: string }>`
      INSERT INTO brokerage_attribution_transfers (
        tenant_id, project_id, buyer_profile_id,
        from_broker_company_id, from_broker_agent_user_id,
        to_broker_company_id, to_broker_agent_user_id,
        reason, requested_by
      ) VALUES (
        ${input.tenantId}::uuid, ${input.data.projectId}::uuid, ${input.data.buyerProfileId}::uuid,
        ${input.fromBrokerCompanyId}::uuid, ${input.fromBrokerAgentUserId}::uuid,
        ${input.data.toBrokerCompanyId}::uuid, ${input.data.toBrokerAgentUserId ?? null}::uuid,
        ${input.data.reason}, ${input.actorUserId}::uuid
      ) RETURNING id
    `.execute(this.db);
    return result.rows[0]!.id;
  }

  async transfer(tenantId: string, transferId: string): Promise<{ projectId: string } | null> {
    const result = await sql<{ project_id: string }>`
      SELECT project_id FROM brokerage_attribution_transfers
      WHERE id = ${transferId}::uuid AND tenant_id = ${tenantId}::uuid
    `.execute(this.db);
    return result.rows[0] ? { projectId: result.rows[0].project_id } : null;
  }

  async reviewTransfer(input: {
    tenantId: string; transferId: string; actorUserId: string;
    decision: 'APPROVED' | 'REJECTED'; note: string | null;
  }): Promise<boolean> {
    if (input.decision === 'APPROVED') {
      const result = await sql<{ id: string }>`
        SELECT preneura_approve_brokerage_attribution_transfer(
          ${input.transferId}::uuid, ${input.actorUserId}::uuid, ${input.note}
        ) AS id
      `.execute(this.db);
      return Boolean(result.rows[0]?.id);
    }
    const result = await sql<{ id: string }>`
      UPDATE brokerage_attribution_transfers
      SET status = 'REJECTED', reviewed_by = ${input.actorUserId}::uuid,
          reviewed_at = now(), review_note = ${input.note}
      WHERE id = ${input.transferId}::uuid AND tenant_id = ${input.tenantId}::uuid AND status = 'REQUESTED'
      RETURNING id
    `.execute(this.db);
    return Boolean(result.rows[0]);
  }

  private async listTransfers(tenantId: string, brokerCompanyIds: string[] | null): Promise<BrokerageAttributionTransferSnapshot[]> {
    const scope = brokerCompanyIds === null
      ? sql``
      : sql`AND (transfer.from_broker_company_id = ANY(${brokerCompanyIds}::uuid[])
                  OR transfer.to_broker_company_id = ANY(${brokerCompanyIds}::uuid[]))`;
    const result = await sql<{
      transfer_id: string; project_id: string; buyer_profile_id: string; buyer_user_id: string; buyer_display_name: string;
      from_broker_company_id: string | null; from_broker_agent_user_id: string | null;
      to_broker_company_id: string; to_broker_agent_user_id: string | null;
      reason: string; status: BrokerageAttributionTransferSnapshot['status']; requested_by: string; requested_at: Date;
      reviewed_by: string | null; reviewed_at: Date | null; review_note: string | null;
    }>`
      SELECT transfer.id AS transfer_id, transfer.project_id, transfer.buyer_profile_id,
             buyer.user_id AS buyer_user_id, users.display_name AS buyer_display_name,
             transfer.from_broker_company_id, transfer.from_broker_agent_user_id,
             transfer.to_broker_company_id, transfer.to_broker_agent_user_id,
             transfer.reason, transfer.status, transfer.requested_by, transfer.requested_at,
             transfer.reviewed_by, transfer.reviewed_at, transfer.review_note
      FROM brokerage_attribution_transfers transfer
      JOIN buyer_profiles buyer ON buyer.id = transfer.buyer_profile_id
      JOIN users ON users.id = buyer.user_id
      WHERE transfer.tenant_id = ${tenantId}::uuid ${scope}
      ORDER BY transfer.requested_at DESC, transfer.id DESC
      LIMIT 250
    `.execute(this.db);
    return result.rows.map((row) => ({
      transferId: row.transfer_id,
      tenantId,
      projectId: row.project_id,
      buyerProfileId: row.buyer_profile_id,
      buyerUserId: row.buyer_user_id,
      buyerDisplayName: row.buyer_display_name,
      fromBrokerCompanyId: row.from_broker_company_id,
      fromBrokerAgentUserId: row.from_broker_agent_user_id,
      toBrokerCompanyId: row.to_broker_company_id,
      toBrokerAgentUserId: row.to_broker_agent_user_id,
      reason: row.reason,
      status: row.status,
      requestedBy: row.requested_by,
      requestedAt: row.requested_at.toISOString(),
      reviewedBy: row.reviewed_by,
      reviewedAt: row.reviewed_at?.toISOString() ?? null,
      reviewNote: row.review_note,
    }));
  }
}
