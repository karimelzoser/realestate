import { z } from 'zod';

export const claimAllocatorSessionSchema = z.object({
  tenantId: z.uuid(),
  projectId: z.uuid(),
});
export type ClaimAllocatorSessionInput = z.infer<typeof claimAllocatorSessionSchema>;

export const createAssignedAllocationLockSchema = z.object({
  tenantId: z.uuid(),
  projectId: z.uuid(),
  quoteId: z.uuid(),
  idempotencyKey: z.uuid(),
  ttlSeconds: z.number().int().min(60).max(900).default(900),
});
export type CreateAssignedAllocationLockInput = z.infer<typeof createAssignedAllocationLockSchema>;

export const createExactApartmentQuoteSchema = z.object({
  tenantId: z.uuid(), projectId: z.uuid(), queueEntryId: z.uuid(), physicalUnitId: z.uuid(),
});
export type CreateExactApartmentQuoteInput = z.infer<typeof createExactApartmentQuoteSchema>;
export const eligibleApartmentFilterSchema = z.object({
  buildingId: z.uuid().optional(), floorId: z.uuid().optional(), after: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});
export type EligibleApartmentFilter = z.infer<typeof eligibleApartmentFilterSchema>;

export interface PhysicalApartmentSnapshot {
  physicalUnitId: string;
  apartmentReference: string;
  buildingId: string;
  buildingCode: string;
  buildingName: string;
  floorId: string;
  floorCode: string;
  floorName: string;
  floorLevel: number | null;
  orientation: string | null;
  viewCode: string | null;
  unitTypeId: string;
  unitTypeCode: string;
  unitTypeName: string;
}

export interface EligibleApartmentSnapshot extends PhysicalApartmentSnapshot {
  indoorAreaSqm: string;
  roofAreaSqm: string;
  gardenAreaSqm: string;
  currentTotalPrice: string | null;
  currency: string;
}
export interface EligibleApartmentPage {
  items: EligibleApartmentSnapshot[];
  nextCursor: string | null;
}
export interface EligibleApartmentStructure {
  buildings: Array<{ buildingId: string; buildingName: string; buildingCode: string;
    floors: Array<{ floorId: string; floorName: string; floorCode: string; floorLevel: number | null; availableApartments: number }> }>;
}

export interface ExactApartmentQuoteSnapshot {
  quoteId: string;
  queueEntryId: string;
  apartment: PhysicalApartmentSnapshot;
  pricingVersionId: string;
  quotedTotal: string;
  currency: string;
  createdAt: string;
  validUntil: string;
  components: Array<{ component: 'INDOOR' | 'ROOF' | 'GARDEN'; areaSqm: string; ratePerSqm: string; amount: string }>;
}

export interface AllocationSessionSnapshot {
  serverTime: string;
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
  eoiUnitTypeId: string | null;
  eoiUnitTypeName: string | null;
  lockPhysicalUnitId: string | null;
  lockQuoteId: string | null;
  lockQuotedTotal: string | null;
}

export interface AssignedAllocationLockSnapshot {
  lockId: string;
  queueEntryId: string;
  buyerUserId: string;
  inventorySlotId: string;
  unitTypeId: string;
  physicalUnitId: string;
  quoteId: string;
  quotedTotal: string;
  currency: string;
  status: 'ACTIVE' | 'RELEASED' | 'EXPIRED' | 'CONVERTED';
  expiresAt: string;
}
