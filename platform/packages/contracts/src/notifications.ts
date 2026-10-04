import { z } from 'zod';

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
