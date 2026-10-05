import { z } from 'zod';

export const tenantStatusSchema = z.enum(['ACTIVE','SUSPENDED','ARCHIVED']);
export const projectStatusSchema = z.enum(['DRAFT','ACTIVE','PAUSED','CLOSED','ARCHIVED']);

export const createTenantSchema = z.object({
  code: z.string().trim().min(2).max(40).regex(/^[A-Z0-9][A-Z0-9_-]*$/i),
  name: z.string().trim().min(2).max(160),
  defaultCurrency: z.string().trim().length(3).transform((value) => value.toUpperCase()),
  defaultTimezone: z.string().trim().min(3).max(80),
});
export type CreateTenantInput = z.infer<typeof createTenantSchema>;

export const updateTenantStatusSchema = z.object({ status: tenantStatusSchema });

export const createProjectSchema = z.object({
  code: z.string().trim().min(2).max(50).regex(/^[A-Z0-9][A-Z0-9_-]*$/i),
  name: z.string().trim().min(2).max(180),
  currency: z.string().trim().length(3).transform((value) => value.toUpperCase()),
  timezone: z.string().trim().min(3).max(80),
});
export type CreateProjectInput = z.infer<typeof createProjectSchema>;

export const updateProjectStatusSchema = z.object({ status: projectStatusSchema });

export const startSupportAccessSchema = z.object({
  tenantId: z.string().uuid(),
  projectId: z.string().uuid().nullable().optional(),
  reason: z.string().trim().min(8).max(500),
  durationMinutes: z.number().int().min(5).max(240).default(30),
});
export type StartSupportAccessInput = z.infer<typeof startSupportAccessSchema>;

export interface PlatformMetricSnapshot {
  tenants: number;
  activeTenants: number;
  projects: number;
  activeProjects: number;
  users: number;
  transactions: number;
  openTransactions: number;
  failedNotifications: number;
  dueCommissions: number;
}

export interface PlatformTenantSnapshot {
  tenantId: string;
  code: string;
  name: string;
  status: z.infer<typeof tenantStatusSchema>;
  defaultCurrency: string;
  defaultTimezone: string;
  projectCount: number;
  activeProjectCount: number;
  userCount: number;
  transactionCount: number;
  openTransactionCount: number;
  failedNotificationCount: number;
}

export interface PlatformProjectSnapshot {
  projectId: string;
  tenantId: string;
  code: string;
  name: string;
  status: z.infer<typeof projectStatusSchema>;
  currency: string;
  timezone: string;
  transactionCount: number;
  openTransactionCount: number;
  buyerCount: number;
  brokerCompanyCount: number;
}

export interface SupportAccessSessionSnapshot {
  sessionId: string;
  operatorUserId: string;
  tenantId: string;
  projectId: string | null;
  tenantName: string;
  projectName: string | null;
  reason: string;
  status: 'ACTIVE' | 'ENDED' | 'EXPIRED';
  startedAt: string;
  expiresAt: string;
  endedAt: string | null;
}

export interface PlatformControlPlaneSnapshot {
  metrics: PlatformMetricSnapshot;
  tenants: PlatformTenantSnapshot[];
  activeSupportSessions: SupportAccessSessionSnapshot[];
}
