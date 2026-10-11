import { z } from 'zod';

export const exactAllocationLockSchema = z.object({
  tenantId: z.uuid(),
  projectId: z.uuid(),
  queueEntryId: z.uuid(),
  physicalUnitId: z.uuid(),
  ttlSeconds: z.number().int().min(30).max(900).default(180),
});
export type ExactAllocationLockInput = z.infer<typeof exactAllocationLockSchema>;

export interface ExactAllocationUnitSnapshot {
  physicalUnitId: string;
  inventorySlotId: string;
  unitTypeId: string;
  unitTypeCode: string;
  unitTypeName: string;
  internalReference: string;
  displayReference: string | null;
  buildingId: string;
  buildingCode: string;
  buildingName: string;
  floorId: string;
  floorCode: string;
  floorName: string;
  levelNumber: number | null;
  orientation: string | null;
  viewCode: string | null;
  cornerPosition: string | null;
  currency: string;
  currentTotalPrice: string;
  pricingVersionId: string;
  priceEffectiveAt: string;
  inventoryUpdatedAt: string;
}

export interface ExactAllocationLockResult {
  lockId: string;
  buyerUserId: string;
  unitTypeId: string;
  physicalUnitId: string;
  inventorySlotId: string;
  expiresAt: string;
  remainingSeconds: number;
  displayReference: string | null;
  internalReference: string;
  buildingId: string;
  buildingCode: string;
  buildingName: string;
  floorId: string;
  floorCode: string;
  floorName: string;
}

export interface ExactAllocationContextSnapshot {
  queueEntryId: string;
  buyerProfileId: string;
  buyerUserId: string;
  eoiId: string;
  eoiUnitTypeId: string;
  eoiUnitTypeCode: string;
  eoiUnitTypeName: string;
  queueStatus: 'CALLED' | 'LOCKED';
  activeLock: ExactAllocationLockResult | null;
  units: ExactAllocationUnitSnapshot[];
}
