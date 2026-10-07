import { z } from 'zod';

export const settlementTypeSchema = z.enum(['EOI_REFUND','BROKER_COMMISSION']);
export type SettlementType = z.infer<typeof settlementTypeSchema>;

export const settlementStatusSchema = z.enum([
  'PENDING_SUBMISSION','SUBMITTED','SETTLED','FAILED','REVERSED','CANCELLED',
]);
export type SettlementStatus = z.infer<typeof settlementStatusSchema>;

export const createSettlementSchema = z.object({
  idempotencyKey: z.string().trim().min(8).max(160),
});
export type CreateSettlementInput = z.infer<typeof createSettlementSchema>;

export const submitSettlementSchema = z.object({
  provider: z.string().trim().min(1).max(80),
  providerReference: z.string().trim().min(1).max(200),
});
export type SubmitSettlementInput = z.infer<typeof submitSettlementSchema>;

export const settlementProviderEventSchema = z.object({
  providerEventId: z.string().trim().min(1).max(200),
  settlementId: z.uuid(),
  eventType: z.enum(['SETTLED','FAILED','REVERSED']),
  providerReference: z.string().trim().min(1).max(200).nullable().default(null),
  occurredAt: z.iso.datetime({ offset: true }),
});
export type SettlementProviderEventInput = z.infer<typeof settlementProviderEventSchema>;

export interface SettlementEventSnapshot {
  settlementEventId: string;
  eventType: 'CREATED' | 'SUBMITTED' | 'SETTLED' | 'FAILED' | 'REVERSED' | 'CANCELLED';
  provider: string | null;
  providerEventId: string | null;
  providerReference: string | null;
  occurredAt: string;
}

export interface SettlementSnapshot {
  settlementId: string;
  settlementType: SettlementType;
  status: SettlementStatus;
  eoiRefundRequestId: string | null;
  commissionCaseId: string | null;
  buyerProfileId: string | null;
  brokerCompanyId: string | null;
  amount: string;
  currency: string;
  provider: string | null;
  providerReference: string | null;
  initiatedAt: string;
  submittedAt: string | null;
  settledAt: string | null;
  failedAt: string | null;
  reversedAt: string | null;
  events: SettlementEventSnapshot[];
}
