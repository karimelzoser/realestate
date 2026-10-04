import { z } from 'zod';
import { decimalMoneySchema } from './catalog.js';

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
    dueAt: string;
    status: 'UPCOMING' | 'DUE' | 'PAID' | 'OVERDUE' | 'WAIVED' | 'CANCELLED';
    paidAt: string | null;
  }>;
}

export interface ChequeSnapshot {
  chequeId: string;
  sequenceNumber: number;
  amount: string;
  dueAt: string;
  status: 'EXPECTED' | 'RECEIVED' | 'DEPOSITED' | 'CLEARED' | 'RETURNED' | 'CANCELLED';
  chequeNumber: string | null;
  bankName: string | null;
  receivedAt: string | null;
}
