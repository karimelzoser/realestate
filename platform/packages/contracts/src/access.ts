import { z } from 'zod';

export const roleCodeSchema = z.enum([
  'PRENEURA_SUPER_ADMIN','OPERATIONS_DIRECTOR','MANAGER','SALES','QUEUE_RECEPTIONIST','ALLOCATOR','TRANSACTION_OPERATOR','BROKER_MANAGER','BROKER_FINANCE','BROKER_AGENT','BUYER',
]);
export type RoleCode = z.infer<typeof roleCodeSchema>;

export const scopeTypeSchema = z.enum(['PLATFORM','TENANT','PROJECT','BROKER_COMPANY']);
export type ScopeType = z.infer<typeof scopeTypeSchema>;

export const permissionCodeSchema = z.enum([
  'platform.tenants.read','platform.tenants.manage','platform.support.access','tenant.read','tenant.users.manage','tenant.projects.manage','project.read','project.manage','project.import.manage',
  'pricing.read','pricing.publish','buyers.read','buyers.manage','buyers.read.self','buyers.manage.self','eoi.read','eoi.manage','eoi.read.self','eoi.manage.self','queue.read','queue.checkin','queue.manage',
  'inventory.read','allocation.assist','unit.lock','transaction.read','transaction.read.self','transaction.manage','payment.read','payment.verify','payment.schedule.manage',
  'documents.read','documents.read.self','documents.upload','documents.upload.self','documents.verify','documents.templates.manage',
  'contract.read','contract.read.self','contract.generate','contract.execute','contract.sign.self','contract.sign.company','property.read.self','installment.read.self',
  'broker.buyers.read','broker.buyers.manage','broker.users.manage','broker.performance.read',
  'commission.status.read','commission.amount.read','commission.rate.read','commission.payment.manage','commission.plan.manage','refund.read','refund.request','refund.approve','refund.payment.manage','notifications.read','notifications.manage','audit.read','ai.buyer.use','ai.manager.use','ai.settings.manage',
]);
export type PermissionCode = z.infer<typeof permissionCodeSchema>;

export interface WorkspaceRoleAssignmentSnapshot {
  assignmentId: string;
  role: RoleCode;
  scopeType: ScopeType;
  tenantId: string | null;
  projectId: string | null;
  brokerCompanyId: string | null;
}

export interface WorkspaceProjectSnapshot {
  tenantId: string;
  tenantCode: string;
  tenantName: string;
  projectId: string;
  projectCode: string;
  projectName: string;
  projectStatus: 'DRAFT' | 'ACTIVE' | 'PAUSED' | 'CLOSED';
  currency: string;
  timezone: string;
  roles: RoleCode[];
  brokerCompanyIds: string[];
}

export interface WorkspaceContextSnapshot {
  userId: string;
  displayName: string;
  assignments: WorkspaceRoleAssignmentSnapshot[];
  projects: WorkspaceProjectSnapshot[];
}

export const roleCapabilityMap: Readonly<Record<RoleCode, readonly PermissionCode[]>> = {
  PRENEURA_SUPER_ADMIN: ['platform.tenants.read','platform.tenants.manage','platform.support.access'],
  OPERATIONS_DIRECTOR: [
    'tenant.read','tenant.users.manage','tenant.projects.manage','project.read','project.manage','project.import.manage','pricing.read','pricing.publish','buyers.read','buyers.manage','eoi.read','eoi.manage',
    'queue.read','queue.manage','inventory.read','allocation.assist','unit.lock','transaction.read','transaction.manage','payment.read','payment.verify','payment.schedule.manage','documents.read','documents.upload','documents.verify','documents.templates.manage',
    'contract.read','contract.generate','contract.execute','contract.sign.company','broker.buyers.read','broker.buyers.manage','broker.users.manage','broker.performance.read','commission.status.read','commission.amount.read','commission.rate.read',
    'commission.payment.manage','commission.plan.manage','refund.read','refund.request','refund.approve','refund.payment.manage','notifications.read','notifications.manage','audit.read','ai.manager.use','ai.settings.manage',
  ],
  MANAGER: [
    'project.read','project.manage','project.import.manage','pricing.read','pricing.publish','buyers.read','buyers.manage','eoi.read','eoi.manage','queue.read','queue.manage','inventory.read','transaction.read','transaction.manage','payment.read','payment.verify','payment.schedule.manage',
    'documents.read','documents.upload','documents.verify','documents.templates.manage','contract.read','contract.generate','contract.execute','contract.sign.company','broker.buyers.read','broker.performance.read','commission.status.read','commission.amount.read','commission.rate.read','commission.plan.manage',
    'refund.read','refund.approve','notifications.read','notifications.manage','audit.read','ai.manager.use','ai.settings.manage',
  ],
  SALES: ['project.read','pricing.read','buyers.read','buyers.manage','eoi.read','eoi.manage','queue.read','inventory.read','transaction.read','documents.read','notifications.read'],
  QUEUE_RECEPTIONIST: ['project.read','buyers.read','buyers.manage','eoi.read','queue.read','queue.checkin','queue.manage','inventory.read'],
  ALLOCATOR: ['project.read','buyers.read','eoi.read','queue.read','inventory.read','allocation.assist','unit.lock','transaction.read'],
  TRANSACTION_OPERATOR: [
    'project.read','buyers.read','eoi.read','inventory.read','transaction.read','transaction.manage','payment.read','payment.verify','payment.schedule.manage','documents.read','documents.upload','documents.verify','contract.read','contract.generate','contract.execute',
    'commission.status.read','refund.read','refund.request','refund.payment.manage','notifications.read',
  ],
  BROKER_MANAGER: ['project.read','pricing.read','buyers.read','eoi.read','inventory.read','transaction.read','broker.buyers.read','broker.buyers.manage','broker.users.manage','broker.performance.read','commission.status.read','commission.amount.read','commission.rate.read','notifications.read'],
  BROKER_FINANCE: ['project.read','transaction.read','payment.read','broker.buyers.read','broker.performance.read','commission.status.read','commission.amount.read','commission.rate.read','commission.payment.manage','notifications.read'],
  BROKER_AGENT: ['project.read','pricing.read','buyers.read','eoi.read','inventory.read','transaction.read','broker.buyers.read','broker.buyers.manage','commission.status.read','notifications.read'],
  BUYER: ['project.read','pricing.read','buyers.read.self','buyers.manage.self','eoi.read.self','eoi.manage.self','inventory.read','transaction.read.self','documents.read.self','documents.upload.self','contract.read.self','contract.sign.self','property.read.self','installment.read.self','refund.request','notifications.read','ai.buyer.use'],
};

export function roleHasPermission(role: RoleCode, permission: PermissionCode): boolean {
  return roleCapabilityMap[role].includes(permission);
}
