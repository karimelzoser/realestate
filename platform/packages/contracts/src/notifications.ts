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
