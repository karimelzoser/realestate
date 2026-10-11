export interface ActiveAllocationLockSnapshot {
  lockId: string;
  unitTypeId: string;
  expiresAt: string;
  remainingSeconds: number;
}

export interface AllocationQueueEntrySnapshot {
  queueEntryId: string;
  buyerProfileId: string;
  buyerUserId: string;
  buyerDisplayName: string;
  channel: 'ONSITE' | 'ONLINE' | 'BROKER';
  priorityGroup: 'STANDARD' | 'VIP' | 'RECOVERY';
  priorityScore: number;
  status: 'WAITING' | 'CALLED' | 'LOCKED';
  checkedInAt: string;
  calledAt: string | null;
  activeLock: ActiveAllocationLockSnapshot | null;
}
