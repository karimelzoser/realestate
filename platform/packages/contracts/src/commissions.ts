import { z } from 'zod';

export const createCommissionPlanSchema = z.object({
  tenantId: z.uuid(),
  projectId: z.uuid(),
  brokerCompanyId: z.uuid(),
  ratePercent: z.string().regex(/^\d{1,3}(?:\.\d{1,4})?$/),
  dueDaysAfterEligibility: z.number().int().min(0).max(3650).default(30),
  effectiveAt: z.iso.datetime({ offset: true }),
}).superRefine((value, ctx) => {
  if (Number(value.ratePercent) > 100) {
    ctx.addIssue({ code: 'custom', message: 'Commission rate cannot exceed 100%.' });
  }
});
export type CreateCommissionPlanInput = z.infer<typeof createCommissionPlanSchema>;

export const updateCommissionCaseStatusSchema = z.object({
  tenantId: z.uuid(),
  projectId: z.uuid(),
  brokerCompanyId: z.uuid(),
  commissionCaseId: z.uuid(),
  action: z.enum(['MARK_INVOICED', 'MARK_DISPUTED']),
});
export type UpdateCommissionCaseStatusInput = z.infer<typeof updateCommissionCaseStatusSchema>;

export interface BrokerCommissionContextSnapshot {
  brokerCompanyId: string;
  code: string;
  name: string;
}

export interface CommissionCaseSnapshot {
  commissionCaseId: string;
  transactionId: string;
  brokerCompanyId: string;
  brokerAgentUserId: string | null;
  buyerProfileId: string;
  status:
    | 'PENDING_PREREQUISITES'
    | 'ELIGIBLE'
    | 'INVOICED'
    | 'DUE'
    | 'PAID'
    | 'DISPUTED'
    | 'CANCELLED';
  completionPercent: string;
  prerequisitesComplete: boolean;
  eligibleAt: string | null;
  dueAt: string | null;
  dueInSeconds: number | null;
  overdueSeconds: number | null;
  invoicedAt: string | null;
  paidAt: string | null;
  settlementId: string | null;
  settlementStatus: 'PENDING_SUBMISSION' | 'SUBMITTED' | 'SETTLED' | 'FAILED' | 'REVERSED' | 'CANCELLED' | null;
  settlementProviderReference: string | null;
  basisAmount?: string;
  commissionAmount?: string;
  ratePercent?: string;
}
