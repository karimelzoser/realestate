import { z } from 'zod';

const uuid = z.string().uuid();
const optionalUuid = uuid.nullable().optional();

export const brokerageOrganizationInputSchema = z.object({
  organizationCode: z.string().trim().regex(/^[A-Z0-9][A-Z0-9_-]{1,63}$/),
  displayNameEn: z.string().trim().min(2).max(180),
  displayNameAr: z.string().trim().min(2).max(180),
  legalName: z.string().trim().min(2).max(240).nullable().optional(),
  localCompanyCode: z.string().trim().min(2).max(64),
});
export type BrokerageOrganizationInput = z.infer<typeof brokerageOrganizationInputSchema>;

export const brokerageAgreementInputSchema = z.object({
  organizationId: uuid,
  agreementCode: z.string().trim().min(2).max(80),
  effectiveFrom: z.string().datetime(),
  effectiveTo: z.string().datetime().nullable().optional(),
  commercialTerms: z.record(z.string(), z.unknown()).default({}),
});
export type BrokerageAgreementInput = z.infer<typeof brokerageAgreementInputSchema>;

export const brokerageProjectAccessInputSchema = z.object({
  status: z.enum(['ACTIVE','SUSPENDED','EXPIRED']),
  effectiveFrom: z.string().datetime(),
  effectiveTo: z.string().datetime().nullable().optional(),
});
export type BrokerageProjectAccessInput = z.infer<typeof brokerageProjectAccessInputSchema>;

export const brokerageAttributionTransferInputSchema = z.object({
  projectId: uuid,
  buyerProfileId: uuid,
  toBrokerCompanyId: uuid,
  toBrokerAgentUserId: optionalUuid,
  reason: z.string().trim().min(3).max(1000),
});
export type BrokerageAttributionTransferInput = z.infer<typeof brokerageAttributionTransferInputSchema>;

export const brokerageAttributionReviewInputSchema = z.object({
  decision: z.enum(['APPROVED','REJECTED']),
  note: z.string().trim().max(1000).nullable().optional(),
});
export type BrokerageAttributionReviewInput = z.infer<typeof brokerageAttributionReviewInputSchema>;

export interface BrokerageOrganizationSnapshot {
  organizationId: string;
  organizationCode: string;
  displayNameEn: string;
  displayNameAr: string;
  legalName: string | null;
  status: 'ACTIVE' | 'SUSPENDED' | 'ARCHIVED';
  tenantId: string;
  brokerCompanyId: string;
  localCompanyCode: string;
  localCompanyName: string;
  localStatus: 'ACTIVE' | 'SUSPENDED' | 'ARCHIVED';
}

export interface BrokerageAgreementProjectSnapshot {
  projectId: string;
  projectCode: string;
  projectName: string;
  status: 'ACTIVE' | 'SUSPENDED' | 'EXPIRED';
  effectiveFrom: string;
  effectiveTo: string | null;
}

export interface BrokerageAgreementSnapshot {
  agreementId: string;
  organizationId: string;
  tenantId: string;
  brokerCompanyId: string;
  versionNumber: number;
  agreementCode: string;
  status: 'DRAFT' | 'ACTIVE' | 'SUSPENDED' | 'EXPIRED' | 'TERMINATED';
  effectiveFrom: string;
  effectiveTo: string | null;
  commercialTerms: Record<string, unknown>;
  approvedAt: string | null;
  projects: BrokerageAgreementProjectSnapshot[];
}

export interface BrokerageAttributionTransferSnapshot {
  transferId: string;
  tenantId: string;
  projectId: string;
  buyerProfileId: string;
  buyerUserId: string;
  buyerDisplayName: string;
  fromBrokerCompanyId: string | null;
  fromBrokerAgentUserId: string | null;
  toBrokerCompanyId: string;
  toBrokerAgentUserId: string | null;
  reason: string;
  status: 'REQUESTED' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
  requestedBy: string;
  requestedAt: string;
  reviewedBy: string | null;
  reviewedAt: string | null;
  reviewNote: string | null;
}

export interface BrokerageOnboardingSnapshot {
  tenantId: string;
  organizations: BrokerageOrganizationSnapshot[];
  agreements: BrokerageAgreementSnapshot[];
  transfers: BrokerageAttributionTransferSnapshot[];
}
