import { z } from 'zod';

export const decimalMoneySchema = z.string().regex(/^\d+(?:\.\d{1,2})?$/);
export const decimalAreaSchema = z.string().regex(/^\d+(?:\.\d{1,2})?$/);

export const pricingComponentSchema = z.enum(['INDOOR', 'ROOF', 'GARDEN']);
export type PricingComponent = z.infer<typeof pricingComponentSchema>;

export const unitTypeStatusSchema = z.enum(['ACTIVE', 'HIDDEN', 'ARCHIVED']);
export type UnitTypeStatus = z.infer<typeof unitTypeStatusSchema>;

export const createUnitTypeSchema = z.object({
  tenantId: z.uuid(),
  projectId: z.uuid(),
  code: z.string().trim().min(1).max(64),
  name: z.string().trim().min(1).max(160),
  description: z.string().trim().max(2000).optional(),
  bedroomCount: z.number().int().min(0).max(30).nullable().optional(),
  indoorAreaSqm: decimalAreaSchema,
  roofAreaSqm: decimalAreaSchema.default('0'),
  gardenAreaSqm: decimalAreaSchema.default('0'),
  sortOrder: z.number().int().min(-100000).max(100000).default(0),
});
export type CreateUnitTypeInput = z.infer<typeof createUnitTypeSchema>;

export const addInventoryCapacitySchema = z.object({
  tenantId: z.uuid(),
  projectId: z.uuid(),
  unitTypeId: z.uuid(),
  quantity: z.number().int().min(1).max(10000),
});
export type AddInventoryCapacityInput = z.infer<typeof addInventoryCapacitySchema>;

export const pricingRateInputSchema = z.object({
  unitTypeId: z.uuid(),
  component: pricingComponentSchema,
  ratePerSqm: decimalMoneySchema,
});

export const createPricingVersionSchema = z.object({
  tenantId: z.uuid(),
  projectId: z.uuid(),
  label: z.string().trim().min(1).max(160),
  effectiveAt: z.iso.datetime({ offset: true }),
  rates: z.array(pricingRateInputSchema).min(1).max(5000),
});
export type CreatePricingVersionInput = z.infer<typeof createPricingVersionSchema>;

export const createInventoryLockSchema = z.object({
  tenantId: z.uuid(),
  projectId: z.uuid(),
  unitTypeId: z.uuid(),
  buyerUserId: z.uuid().nullable().optional(),
  ttlSeconds: z.number().int().min(30).max(900).default(180),
});
export type CreateInventoryLockInput = z.infer<typeof createInventoryLockSchema>;

export const releaseInventoryLockSchema = z.object({
  tenantId: z.uuid(),
  projectId: z.uuid(),
  lockId: z.uuid(),
  reason: z.string().trim().min(1).max(500).default('Released by operator'),
});
export type ReleaseInventoryLockInput = z.infer<typeof releaseInventoryLockSchema>;

export interface UnitTypeCommercialSnapshot {
  unitTypeId: string;
  code: string;
  name: string;
  bedroomCount: number | null;
  indoorAreaSqm: string;
  roofAreaSqm: string;
  gardenAreaSqm: string;
  currency: string;
  availableQuantity: number;
  lockedQuantity: number;
  reservedQuantity: number;
  soldQuantity: number;
  currentTotalPrice: string | null;
  currentPriceEffectiveAt: string | null;
  currentPricePublishedAt: string | null;
  nextPriceEffectiveAt: string | null;
  nextTotalPrice: string | null;
  nextPriceChangePercent: string | null;
  inventoryUpdatedAt: string;
}

export interface InventoryLockResult {
  lockId: string;
  unitTypeId: string;
  buyerUserId: string | null;
  expiresAt: string;
  remainingSeconds: number;
}
