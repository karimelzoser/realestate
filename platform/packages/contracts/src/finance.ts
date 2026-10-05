import { z } from 'zod';
import { decimalMoneySchema } from './catalog.js';

const positiveMoneySchema = decimalMoneySchema.refine(
  (value) => Number.isFinite(Number(value)) && Number(value) > 0,
  'Amount must be greater than zero.',
);

export const paymentItemTypeSchema = z.enum(['DOWN_PAYMENT', 'INSTALLMENT', 'FEE']);
export type PaymentItemType = z.infer<typeof paymentItemTypeSchema>;

export const createPaymentScheduleSchema = z.object({
  tenantId: z.uuid(),
  projectId: z.uuid(),
  transactionId: z.uuid(),
  currency: z.string().regex(/^[A-Z]{3}$/),
  totalContractAmount: decimalMoneySchema,
  items: z.array(z.object({
    sequenceNumber: z.number().int().min(1).max(1000),
    itemType: paymentItemTypeSchema,
    amount: decimalMoneySchema,
    dueAt: z.iso.datetime({ offset: true }),
  })).min(1).max(1000),
});
export type CreatePaymentScheduleInput = z.infer<typeof createPaymentScheduleSchema>;

export const markPaymentItemPaidSchema = z.object({
  tenantId: z.uuid(),
  projectId: z.uuid(),
  transactionId: z.uuid(),
  paymentItemId: z.uuid(),
  paymentReference: z.string().trim().min(1).max(200),
});
export type MarkPaymentItemPaidInput = z.infer<typeof markPaymentItemPaidSchema>;

export const paymentAllocationInputSchema = z.object({
  paymentItemId: z.uuid(),
  amount: positiveMoneySchema,
});
export type PaymentAllocationInput = z.infer<typeof paymentAllocationInputSchema>;

export const postManualPaymentSchema = z.object({
  tenantId: z.uuid(),
  projectId: z.uuid(),
  transactionId: z.uuid(),
  amount: positiveMoneySchema,
  paymentReference: z.string().trim().min(1).max(200),
  occurredAt: z.iso.datetime({ offset: true }).optional(),
  allocations: z.array(paymentAllocationInputSchema).max(1000).default([]),
});
export type PostManualPaymentInput = z.infer<typeof postManualPaymentSchema>;

export const compensatePaymentSchema = z.object({
  tenantId: z.uuid(),
  projectId: z.uuid(),
  transactionId: z.uuid(),
  paymentEventId: z.uuid(),
  kind: z.enum(['REVERSAL', 'REFUND']),
  amount: positiveMoneySchema,
  reference: z.string().trim().min(1).max(200),
  occurredAt: z.iso.datetime({ offset: true }).optional(),
});
export type CompensatePaymentInput = z.infer<typeof compensatePaymentSchema>;

export const providerFinanceEventSchema = z.object({
  tenantId: z.uuid(),
  projectId: z.uuid(),
  transactionId: z.uuid(),
  eventId: z.string().trim().min(1).max(240),
  eventType: z.enum(['PAYMENT_RECEIVED', 'PAYMENT_REVERSED', 'REFUND_ISSUED']),
  amount: positiveMoneySchema,
  currency: z.string().regex(/^[A-Z]{3}$/),
  externalReference: z.string().trim().min(1).max(240),
  relatedEventId: z.string().trim().min(1).max(240).optional(),
  occurredAt: z.iso.datetime({ offset: true }),
}).superRefine((value, ctx) => {
  if (value.eventType !== 'PAYMENT_RECEIVED' && !value.relatedEventId) {
    ctx.addIssue({ code: 'custom', path: ['relatedEventId'], message: 'Compensating provider event requires relatedEventId.' });
  }
});
export type ProviderFinanceEventInput = z.infer<typeof providerFinanceEventSchema>;

export const createChequeScheduleSchema = z.object({
  tenantId: z.uuid(),
  projectId: z.uuid(),
  transactionId: z.uuid(),
  cheques: z.array(z.object({
    sequenceNumber: z.number().int().min(1).max(1000),
    amount: decimalMoneySchema,
    dueAt: z.iso.datetime({ offset: true }),
  })).min(1).max(1000),
});
export type CreateChequeScheduleInput = z.infer<typeof createChequeScheduleSchema>;

export const updateChequeStatusSchema = z.object({
  tenantId: z.uuid(),
  projectId: z.uuid(),
  transactionId: z.uuid(),
  chequeId: z.uuid(),
  status: z.enum(['RECEIVED', 'DEPOSITED', 'CLEARED', 'RETURNED', 'CANCELLED']),
  chequeNumber: z.string().trim().min(1).max(120).optional(),
  bankName: z.string().trim().min(1).max(180).optional(),
});
export type UpdateChequeStatusInput = z.infer<typeof updateChequeStatusSchema>;

export const replaceChequeSchema = z.object({
  tenantId: z.uuid(),
  projectId: z.uuid(),
  transactionId: z.uuid(),
  chequeId: z.uuid(),
  amount: positiveMoneySchema,
  dueAt: z.iso.datetime({ offset: true }),
  chequeNumber: z.string().trim().min(1).max(120).optional(),
  bankName: z.string().trim().min(1).max(180).optional(),
  occurredAt: z.iso.datetime({ offset: true }).optional(),
});
export type ReplaceChequeInput = z.infer<typeof replaceChequeSchema>;

export interface PaymentScheduleSnapshot {
  scheduleId: string;
  transactionId: string;
  currency: string;
  totalContractAmount: string;
  status: 'DRAFT' | 'ACTIVE' | 'COMPLETED' | 'CANCELLED';
  items: Array<{
    paymentItemId: string;
    sequenceNumber: number;
    itemType: PaymentItemType;
    amount: string;
    paidAmount: string;
    remainingAmount: string;
    dueAt: string;
    status: 'UPCOMING' | 'DUE' | 'PARTIALLY_PAID' | 'PAID' | 'OVERDUE' | 'WAIVED' | 'CANCELLED';
    paidAt: string | null;
  }>;
}

export interface FinancePaymentAllocationSnapshot {
  allocationId: string;
  paymentItemId: string;
  amount: string;
  originalAllocationId: string | null;
}

export interface FinancePaymentEventSnapshot {
  paymentEventId: string;
  eventType: 'PAYMENT_RECEIVED' | 'PAYMENT_REVERSED' | 'REFUND_ISSUED';
  amount: string;
  currency: string;
  source: 'MANUAL' | 'PROVIDER';
  externalReference: string;
  provider: string | null;
  providerEventId: string | null;
  relatedEventId: string | null;
  occurredAt: string;
  createdAt: string;
  allocations: FinancePaymentAllocationSnapshot[];
}

export interface FinanceLedgerSnapshot {
  transactionId: string;
  currency: string;
  netCashReceived: string;
  netAllocated: string;
  unallocatedCash: string;
  events: FinancePaymentEventSnapshot[];
}

export interface ChequeSnapshot {
  chequeId: string;
  rootChequeId: string;
  replacesChequeId: string | null;
  generation: number;
  sequenceNumber: number;
  amount: string;
  dueAt: string;
  status: 'EXPECTED' | 'RECEIVED' | 'DEPOSITED' | 'CLEARED' | 'RETURNED' | 'CANCELLED';
  chequeNumber: string | null;
  bankName: string | null;
  receivedAt: string | null;
}

export interface ChequeEventSnapshot {
  eventId: string;
  chequeId: string;
  eventType: 'EXPECTED' | 'RECEIVED' | 'DEPOSITED' | 'CLEARED' | 'RETURNED' | 'CANCELLED' | 'REPLACED';
  chequeNumber: string | null;
  bankName: string | null;
  replacementChequeId: string | null;
  actorUserId: string | null;
  occurredAt: string;
}

export interface ChequeHistorySnapshot {
  rootChequeId: string;
  cheques: ChequeSnapshot[];
  events: ChequeEventSnapshot[];
}
