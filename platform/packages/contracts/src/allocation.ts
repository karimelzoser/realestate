import { z } from 'zod';

export const allocationQueueChannelSchema = z.enum(['ONSITE', 'ONLINE', 'BROKER']);
export const allocationPriorityGroupSchema = z.enum(['STANDARD', 'VIP', 'RECOVERY']);

export const receptionCheckInSchema = z.object({
  tenantId: z.uuid(),
  projectId: z.uuid(),
  eoiId: z.uuid(),
  channel: allocationQueueChannelSchema.default('ONSITE'),
  priorityGroup: allocationPriorityGroupSchema.default('STANDARD'),
  priorityScore: z.number().int().min(-100000).max(100000).default(0),
});
export type ReceptionCheckInInput = z.infer<typeof receptionCheckInSchema>;

export const allocationLockQueueSchema = z.object({
  tenantId: z.uuid(),
  projectId: z.uuid(),
  queueEntryId: z.uuid(),
  unitTypeId: z.uuid(),
  ttlSeconds: z.number().int().min(30).max(900).default(180),
});
export type AllocationLockQueueInput = z.infer<typeof allocationLockQueueSchema>;

export const releaseAllocationLockSchema = z.object({
  tenantId: z.uuid(),
  projectId: z.uuid(),
  queueEntryId: z.uuid(),
  lockId: z.uuid(),
  reason: z.string().trim().min(1).max(500).default('Released by allocator'),
});
export type ReleaseAllocationLockInput = z.infer<typeof releaseAllocationLockSchema>;

export interface AllocationActiveLockSnapshot {
  lockId: string;
  unitTypeId: string;
  unitTypeCode: string;
  unitTypeName: string;
  expiresAt: string;
  remainingSeconds: number;
}

export interface AllocationQueueEntrySnapshot {
  queueEntryId: string;
  buyerProfileId: string;
  buyerUserId: string;
  buyerDisplayName: string;
  eoiId: string;
  channel: 'ONSITE' | 'ONLINE' | 'BROKER';
  priorityGroup: 'STANDARD' | 'VIP' | 'RECOVERY';
  priorityScore: number;
  status: 'WAITING' | 'CALLED' | 'LOCKED';
  checkedInAt: string;
  calledAt: string | null;
  activeLock: AllocationActiveLockSnapshot | null;
}

export interface ReceptionCheckInResult {
  queueEntryId: string;
  buyerProfileId: string;
  buyerUserId: string;
  buyerDisplayName: string;
}

export interface AllocationLockResult extends AllocationActiveLockSnapshot {
  queueEntryId: string;
  buyerProfileId: string;
  buyerUserId: string;
}
