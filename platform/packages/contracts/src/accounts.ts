import { z } from 'zod';
import { roleCodeSchema, scopeTypeSchema, type RoleCode, type ScopeType } from './access.js';

export const accountProvisionSchema = z.object({
  tenantId: z.uuid(),
  displayName: z.string().trim().min(2).max(160),
  phone: z.string().trim().min(6).max(40),
  role: roleCodeSchema,
  scopeType: scopeTypeSchema,
  projectId: z.uuid().nullable().optional(),
  brokerCompanyId: z.uuid().nullable().optional(),
  verificationChannel: z.enum(['WHATSAPP', 'SMS']).default('WHATSAPP'),
}).superRefine((value, ctx) => {
  if (value.scopeType === 'PLATFORM') {
    ctx.addIssue({ code: 'custom', message: 'Platform-scoped accounts are not provisioned through tenant administration.' });
  }
  if (value.scopeType === 'PROJECT' && !value.projectId) {
    ctx.addIssue({ code: 'custom', message: 'projectId is required for project scope.' });
  }
  if (value.scopeType !== 'PROJECT' && value.projectId) {
    ctx.addIssue({ code: 'custom', message: 'projectId is valid only for project scope.' });
  }
  if (value.scopeType === 'BROKER_COMPANY' && !value.brokerCompanyId) {
    ctx.addIssue({ code: 'custom', message: 'brokerCompanyId is required for broker-company scope.' });
  }
  if (value.scopeType !== 'BROKER_COMPANY' && value.brokerCompanyId) {
    ctx.addIssue({ code: 'custom', message: 'brokerCompanyId is valid only for broker-company scope.' });
  }
});
export type AccountProvisionInput = z.infer<typeof accountProvisionSchema>;

export const grantAccountRoleSchema = z.object({
  tenantId: z.uuid(),
  userId: z.uuid(),
  role: roleCodeSchema,
  scopeType: scopeTypeSchema,
  projectId: z.uuid().nullable().optional(),
  brokerCompanyId: z.uuid().nullable().optional(),
});
export type GrantAccountRoleInput = z.infer<typeof grantAccountRoleSchema>;

export const accountStatusSchema = z.object({
  tenantId: z.uuid(),
  userId: z.uuid(),
  status: z.enum(['ACTIVE', 'DISABLED']),
});
export type AccountStatusInput = z.infer<typeof accountStatusSchema>;

export const verifyEnrollmentSchema = z.object({
  phone: z.string().trim().min(6).max(40),
  code: z.string().regex(/^\d{6}$/),
});
export type VerifyEnrollmentInput = z.infer<typeof verifyEnrollmentSchema>;

export interface AccountContactSnapshot {
  kind: 'PHONE' | 'EMAIL';
  displayHint: string | null;
  verifiedAt: string | null;
  primary: boolean;
}

export interface AccountRoleSnapshot {
  assignmentId: string;
  role: RoleCode;
  scopeType: ScopeType;
  tenantId: string | null;
  projectId: string | null;
  brokerCompanyId: string | null;
  status: 'ACTIVE' | 'SUSPENDED';
}

export interface AccountSnapshot {
  userId: string;
  displayName: string;
  status: 'ACTIVE' | 'DISABLED' | 'PENDING';
  membershipStatus: 'ACTIVE' | 'SUSPENDED' | 'INVITED';
  contacts: AccountContactSnapshot[];
  roles: AccountRoleSnapshot[];
}

export interface AccountAdminScopeSnapshot {
  tenantId: string;
  tenantName: string;
  canManageTenantUsers: boolean;
  projects: Array<{ projectId: string; code: string; name: string }>;
  brokerCompanies: Array<{ brokerCompanyId: string; code: string; name: string }>;
}

export interface ProvisionedAccountSnapshot {
  userId: string;
  status: 'PENDING';
  contactDisplayHint: string;
  verificationRequired: true;
  verificationChannel: 'WHATSAPP' | 'SMS';
}
