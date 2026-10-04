import { z } from 'zod';
import { decimalMoneySchema } from './catalog.js';

export const buyerSourceSchema = z.enum(['DIRECT', 'BROKER', 'INTERNAL']);
export type BuyerSource = z.infer<typeof buyerSourceSchema>;

export const createBuyerProfileSchema = z
  .object({
    tenantId: z.uuid(),
    projectId: z.uuid(),
    userId: z.uuid(),
    source: buyerSourceSchema.default('DIRECT'),
    brokerCompanyId: z.uuid().nullable().optional(),
    brokerAgentUserId: z.uuid().nullable().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.source === 'BROKER' && !value.brokerCompanyId) {
      ctx.addIssue({ code: 'custom', message: 'Broker source requires brokerCompanyId.' });
    }
  });
export type CreateBuyerProfileInput = z.infer<typeof createBuyerProfileSchema>;

export const createEoiRefundPolicySchema = z.object({
  tenantId: z.uuid(),
  projectId: z.uuid(),
  name: z.string().trim().min(1).max(160),
  eoiAmount: decimalMoneySchema,
  currency: z.string().regex(/^[A-Z]{3}$/).default('EGP'),
  beforeReservationRefundPercent: z.number().min(0).max(100).default(100),
  afterReservationBeforeContractRefundPercent: z.number().min(0).max(100).default(100),
  afterContractRefundPercent: z.number().min(0).max(100).default(0),
  processingFee: decimalMoneySchema.default('0'),
  effectiveAt: z.iso.datetime({ offset: true }),
});
export type CreateEoiRefundPolicyInput = z.infer<typeof createEoiRefundPolicySchema>;

export const createBuyerEoiSchema = z.object({
  tenantId: z.uuid(),
  projectId: z.uuid(),
  buyerProfileId: z.uuid(),
});
export type CreateBuyerEoiInput = z.infer<typeof createBuyerEoiSchema>;

export const markEoiPaidSchema = z.object({
  tenantId: z.uuid(),
  projectId: z.uuid(),
  eoiId: z.uuid(),
  paymentReference: z.string().trim().min(1).max(200),
});
export type MarkEoiPaidInput = z.infer<typeof markEoiPaidSchema>;

export const eoiRefundStageSchema = z.enum([
  'BEFORE_RESERVATION',
  'AFTER_RESERVATION_BEFORE_CONTRACT',
  'AFTER_CONTRACT',
]);
export type EoiRefundStage = z.infer<typeof eoiRefundStageSchema>;

export const requestEoiRefundSchema = z.object({
  tenantId: z.uuid(),
  projectId: z.uuid(),
  eoiId: z.uuid(),
});
export type RequestEoiRefundInput = z.infer<typeof requestEoiRefundSchema>;

export const reviewEoiRefundSchema = z.object({
  tenantId: z.uuid(),
  projectId: z.uuid(),
  refundRequestId: z.uuid(),
  decision: z.enum(['APPROVE', 'REJECT']),
  note: z.string().trim().max(2000).optional(),
});
export type ReviewEoiRefundInput = z.infer<typeof reviewEoiRefundSchema>;

export const queueChannelSchema = z.enum(['ONSITE', 'ONLINE', 'BROKER']);
export const queuePriorityGroupSchema = z.enum(['STANDARD', 'VIP', 'RECOVERY']);

export const checkInQueueSchema = z.object({
  tenantId: z.uuid(),
  projectId: z.uuid(),
  buyerProfileId: z.uuid(),
  eoiId: z.uuid(),
  channel: queueChannelSchema.default('ONSITE'),
  priorityGroup: queuePriorityGroupSchema.default('STANDARD'),
  priorityScore: z.number().int().min(-100000).max(100000).default(0),
});
export type CheckInQueueInput = z.infer<typeof checkInQueueSchema>;

export const convertLockToReservationSchema = z.object({
  tenantId: z.uuid(),
  projectId: z.uuid(),
  buyerProfileId: z.uuid(),
  queueEntryId: z.uuid(),
  lockId: z.uuid(),
});
export type ConvertLockToReservationInput = z.infer<typeof convertLockToReservationSchema>;

export const transactionMilestoneCodeSchema = z.enum([
  'BUYER_DOCUMENTS_COMPLETE',
  'DOWN_PAYMENT_RECEIVED',
  'CHEQUES_RECEIVED',
  'CONTRACT_GENERATED',
  'CONTRACT_SIGNED',
  'CONTRACT_STAMPED',
]);
export type TransactionMilestoneCode = z.infer<typeof transactionMilestoneCodeSchema>;

export const completeTransactionMilestoneSchema = z.object({
  tenantId: z.uuid(),
  projectId: z.uuid(),
  transactionId: z.uuid(),
  milestoneCode: transactionMilestoneCodeSchema,
  evidenceDocumentId: z.uuid().nullable().optional(),
});
export type CompleteTransactionMilestoneInput = z.infer<typeof completeTransactionMilestoneSchema>;

export interface QueueEntrySnapshot {
  queueEntryId: string;
  buyerProfileId: string;
  buyerUserId: string;
  channel: 'ONSITE' | 'ONLINE' | 'BROKER';
  priorityGroup: 'STANDARD' | 'VIP' | 'RECOVERY';
  priorityScore: number;
  status: 'WAITING' | 'CALLED' | 'LOCKED' | 'COMPLETED' | 'LEFT' | 'CANCELLED';
  checkedInAt: string;
  calledAt: string | null;
}

export interface EoiRefundQuote {
  eoiId: string;
  buyerProfileId: string;
  stage: EoiRefundStage;
  originalAmount: string;
  refundPercent: string;
  processingFee: string;
  refundableAmount: string;
  currency: string;
  policyId: string;
}

export interface ReservationResult {
  reservationId: string;
  transactionId: string;
  unitTypeId: string;
  quotedTotal: string | null;
  currency: string;
  reservedAt: string;
}

export interface TransactionProgressSnapshot {
  transactionId: string;
  reservationId: string;
  buyerProfileId: string;
  status: 'IN_PROGRESS' | 'READY_FOR_COMPLETION' | 'COMPLETED' | 'CANCELLED';
  completionPercent: string;
  commissionPrerequisitesComplete: boolean;
  milestones: Array<{
    code: TransactionMilestoneCode;
    label: string;
    weightPercent: string;
    status: 'PENDING' | 'COMPLETED' | 'WAIVED' | 'BLOCKED';
    completedAt: string | null;
  }>;
}
