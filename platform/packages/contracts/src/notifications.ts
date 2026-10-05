import { z } from 'zod';
import { transactionMilestoneCodeSchema } from './sales.js';

export const notificationAudienceSchema = z.enum([
  'BUYER',
  'BROKER_AGENT',
  'BROKER_MANAGER',
  'BROKER_FINANCE',
  'SALES',
  'TRANSACTION_OPERATOR',
  'MANAGER',
]);
export type NotificationAudience = z.infer<typeof notificationAudienceSchema>;

export const notificationChannelSchema = z.enum(['WHATSAPP', 'SMS', 'EMAIL', 'IN_APP']);
export type NotificationChannel = z.infer<typeof notificationChannelSchema>;

export const notificationJobStatusSchema = z.enum([
  'PENDING',
  'PROCESSING',
  'SENT',
  'FAILED',
  'CANCELLED',
]);
export type NotificationJobStatus = z.infer<typeof notificationJobStatusSchema>;

// Legacy single-policy SLA contract. Kept for backward compatibility while
// new clients use the multi-audience milestone reminder policy API below.
export const upsertMilestoneSlaSchema = z.object({
  tenantId: z.uuid(),
  projectId: z.uuid(),
  milestoneCode: transactionMilestoneCodeSchema,
  targetHoursAfterOpen: z.number().int().min(1).max(87600),
  reminderHoursBefore: z.number().int().min(0).max(87600).default(24),
  audience: notificationAudienceSchema.default('TRANSACTION_OPERATOR'),
  channel: notificationChannelSchema.default('IN_APP'),
  templateCode: z.string().trim().min(1).max(160).default('transaction.milestone.sla'),
  enabled: z.boolean().default(true),
});
export type UpsertMilestoneSlaInput = z.infer<typeof upsertMilestoneSlaSchema>;

export interface MilestoneSlaSnapshot {
  milestoneCode: z.infer<typeof transactionMilestoneCodeSchema>;
  targetHoursAfterOpen: number;
  reminderHoursBefore: number;
  audience: NotificationAudience;
  channel: NotificationChannel;
  templateCode: string;
  enabled: boolean;
}

export const upsertMilestoneReminderPolicySchema = z.object({
  tenantId: z.uuid(),
  projectId: z.uuid(),
  milestoneCode: transactionMilestoneCodeSchema,
  targetHoursAfterOpen: z.number().int().min(1).max(87600),
  reminderHoursBefore: z.number().int().min(0).max(87600).default(24),
  audience: notificationAudienceSchema.default('TRANSACTION_OPERATOR'),
  channel: notificationChannelSchema.default('IN_APP'),
  templateCode: z.string().trim().min(1).max(160).default('transaction.milestone.sla'),
  locale: z.string().trim().min(2).max(32).default('ar-EG'),
  enabled: z.boolean().default(true),
});
export type UpsertMilestoneReminderPolicyInput = z.infer<typeof upsertMilestoneReminderPolicySchema>;

export interface MilestoneReminderPolicySnapshot {
  policyId: string;
  milestoneCode: z.infer<typeof transactionMilestoneCodeSchema>;
  targetHoursAfterOpen: number;
  reminderHoursBefore: number;
  audience: NotificationAudience;
  channel: NotificationChannel;
  templateCode: string;
  locale: string;
  enabled: boolean;
  updatedAt: string;
}

export const installmentReminderItemTypeSchema = z.enum(['DOWN_PAYMENT', 'INSTALLMENT', 'FEE']);
export type InstallmentReminderItemType = z.infer<typeof installmentReminderItemTypeSchema>;

export const upsertInstallmentReminderPolicySchema = z.object({
  tenantId: z.uuid(),
  projectId: z.uuid(),
  itemType: installmentReminderItemTypeSchema.default('INSTALLMENT'),
  audience: notificationAudienceSchema.default('BUYER'),
  channel: notificationChannelSchema.default('WHATSAPP'),
  reminderHoursBefore: z.number().int().min(0).max(87600).default(24),
  templateCode: z.string().trim().min(1).max(160).default('payment.installment.due'),
  locale: z.string().trim().min(2).max(32).default('ar-EG'),
  enabled: z.boolean().default(true),
});
export type UpsertInstallmentReminderPolicyInput = z.infer<typeof upsertInstallmentReminderPolicySchema>;

export interface InstallmentReminderPolicySnapshot {
  policyId: string;
  itemType: InstallmentReminderItemType;
  audience: NotificationAudience;
  channel: NotificationChannel;
  reminderHoursBefore: number;
  templateCode: string;
  locale: string;
  enabled: boolean;
  updatedAt: string;
}

export interface NotificationJobSnapshot {
  notificationJobId: string;
  recipientUserId: string;
  audience: NotificationAudience;
  channel: NotificationChannel;
  templateCode: string;
  scheduledFor: string;
  status: NotificationJobStatus;
  attempts: number;
  sentAt: string | null;
}

export interface UserNotificationSnapshot {
  notificationId: string;
  sequence: string;
  tenantId: string;
  projectId: string | null;
  templateCode: string;
  locale: string;
  payload: Record<string, unknown>;
  createdAt: string;
  readAt: string | null;
}
