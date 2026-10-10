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

export const inviteProjectBuyerSchema = z.object({
  tenantId: z.uuid(),
  projectId: z.uuid(),
  displayName: z.string().trim().min(2).max(160),
  phone: z.string().trim().min(6).max(32),
  verificationChannel: z.enum(['WHATSAPP', 'SMS']).default('WHATSAPP'),
  source: z.enum(['DIRECT', 'INTERNAL']).default('INTERNAL'),
});
export type InviteProjectBuyerInput = z.infer<typeof inviteProjectBuyerSchema>;

export interface ProjectBuyerEoiSummary {
  eoiId: string;
  status: 'PAYMENT_PENDING' | 'PAID' | 'APPLIED' | 'REFUND_REQUESTED' | 'REFUNDED' | 'CANCELLED' | 'EXPIRED';
  amount: string;
  currency: string;
  paidAt: string | null;
  createdAt: string;
}

export interface ProjectBuyerSnapshot {
  buyerProfileId: string;
  userId: string;
  displayName: string;
  accountStatus: 'ACTIVE' | 'DISABLED' | 'PENDING';
  membershipStatus: 'ACTIVE' | 'SUSPENDED' | 'INVITED';
  source: BuyerSource;
  contactDisplayHint: string | null;
  contactVerified: boolean;
  latestEoi: ProjectBuyerEoiSummary | null;
  createdAt: string;
}

export interface InvitedProjectBuyerSnapshot {
  userId: string;
  buyerProfileId: string;
  accountStatus: 'PENDING';
  contactDisplayHint: string;
  verificationRequired: true;
  verificationChannel: 'WHATSAPP' | 'SMS';
  verificationDispatched: boolean;
}

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

export const eoiRefundRequestStatusSchema = z.enum([
  'REQUESTED',
  'APPROVED',
  'REJECTED',
  'PAID',
  'CANCELLED',
]);
export type EoiRefundRequestStatus = z.infer<typeof eoiRefundRequestStatusSchema>;

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

export interface EoiListItemSnapshot {
  eoiId: string;
  buyerProfileId: string;
  buyerUserId: string;
  buyerDisplayName: string;
  buyerSource: BuyerSource;
  brokerCompanyId: string | null;
  brokerAgentUserId: string | null;
  amount: string;
  currency: string;
  status: 'PAYMENT_PENDING' | 'PAID' | 'APPLIED' | 'REFUND_REQUESTED' | 'REFUNDED' | 'CANCELLED' | 'EXPIRED';
  paymentReference: string | null;
  paidAt: string | null;
  appliedAt: string | null;
  refundRequestedAt: string | null;
  refundedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
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

export interface EoiRefundRequestSnapshot {
  refundRequestId: string;
  eoiId: string;
  buyerProfileId: string;
  buyerUserId: string;
  buyerDisplayName: string;
  stage: EoiRefundStage;
  originalAmount: string;
  refundPercent: string;
  processingFee: string;
  requestedAmount: string;
  currency: string;
  status: EoiRefundRequestStatus;
  requestedAt: string;
  reviewedAt: string | null;
  paidAt: string | null;
  decisionNote: string | null;
  payoutReference: string | null;
  financeEventId: string | null;
  retainedAmount: string | null;
}

export interface ReservationResult {
  reservationId: string;
  transactionId: string;
  unitTypeId: string;
  quotedTotal: string | null;
  currency: string;
  reservedAt: string;
}

export interface TransactionListItemSnapshot {
  transactionId: string;
  reservationId: string;
  buyerProfileId: string;
  buyerUserId: string;
  buyerDisplayName: string;
  buyerSource: BuyerSource;
  brokerCompanyId: string | null;
  brokerCompanyName: string | null;
  brokerAgentUserId: string | null;
  brokerAgentDisplayName: string | null;
  unitTypeId: string;
  unitTypeCode: string;
  unitTypeName: string;
  status: 'IN_PROGRESS' | 'READY_FOR_COMPLETION' | 'COMPLETED' | 'CANCELLED';
  quotedTotal: string | null;
  currency: string;
  openedAt: string;
  completionPercent: string;
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

export interface TransactionTimelineEventSnapshot {
  eventId: string;
  eventType: string;
  actorUserId: string | null;
  actorDisplayName: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}
