import { z } from 'zod';

export const claimAllocatorSessionSchema = z.object({
  tenantId: z.uuid(),
  projectId: z.uuid(),
});
export type ClaimAllocatorSessionInput = z.infer<typeof claimAllocatorSessionSchema>;

export const createAssignedAllocationLockSchema = z.object({
  tenantId: z.uuid(),
  projectId: z.uuid(),
  unitTypeId: z.uuid(),
  ttlSeconds: z.number().int().min(60).max(3600).default(900),
});
export type CreateAssignedAllocationLockInput = z.infer<typeof createAssignedAllocationLockSchema>;

export interface AllocationSessionSnapshot {
  queueEntryId: string;
  buyerProfileId: string;
  buyerUserId: string;
  buyerDisplayName: string;
  channel: 'ONSITE' | 'ONLINE' | 'BROKER';
  priorityGroup: 'STANDARD' | 'VIP' | 'RECOVERY';
  priorityScore: number;
  status: 'CALLED' | 'LOCKED';
  calledAt: string | null;
  allocatorUserId: string;
  allocatorAssignedAt: string;
  allocationLockId: string | null;
  lockUnitTypeId: string | null;
  lockExpiresAt: string | null;
}

export interface AssignedAllocationLockSnapshot {
  lockId: string;
  queueEntryId: string;
  buyerUserId: string;
  inventorySlotId: string;
  unitTypeId: string;
  expiresAt: string;
}
