import { z } from 'zod';

export const aiProviderCodeSchema = z.enum(['DETERMINISTIC', 'EXTERNAL_HTTP']);
export type AiProviderCode = z.infer<typeof aiProviderCodeSchema>;

export const aiProjectSettingsInputSchema = z.object({
  buyerEnabled: z.boolean(),
  managerEnabled: z.boolean(),
  providerCode: aiProviderCodeSchema,
  model: z.string().trim().min(1).max(160).nullable().optional(),
});
export type AiProjectSettingsInput = z.infer<typeof aiProjectSettingsInputSchema>;

export interface AiProjectSettingsSnapshot {
  tenantId: string;
  projectId: string;
  buyerEnabled: boolean;
  managerEnabled: boolean;
  providerCode: AiProviderCode;
  model: string | null;
  externalProviderConfigured: boolean;
  updatedAt: string | null;
}

export const outdoorPreferenceSchema = z.enum(['NONE', 'PREFER', 'REQUIRED']);
export type OutdoorPreference = z.infer<typeof outdoorPreferenceSchema>;

export const buyerRecommendationRequestSchema = z.object({
  budgetMax: z.number().finite().positive().max(10_000_000_000).nullable().optional(),
  bedrooms: z.number().int().min(0).max(30).nullable().optional(),
  minIndoorAreaSqm: z.number().finite().min(0).max(100_000).nullable().optional(),
  gardenPreference: outdoorPreferenceSchema.default('NONE'),
  roofPreference: outdoorPreferenceSchema.default('NONE'),
  maxResults: z.number().int().min(1).max(10).default(5),
});
export type BuyerRecommendationRequest = z.infer<typeof buyerRecommendationRequestSchema>;

export interface BuyerRecommendationItem {
  unitTypeId: string;
  code: string;
  name: string;
  score: number;
  reasons: string[];
  bedroomCount: number | null;
  indoorAreaSqm: string;
  roofAreaSqm: string;
  gardenAreaSqm: string;
  availableQuantity: number;
  currency: string;
  currentTotalPrice: string | null;
  nextPriceEffectiveAt: string | null;
  nextTotalPrice: string | null;
  nextPriceChangePercent: string | null;
}

export interface BuyerRecommendationResponse {
  providerUsed: AiProviderCode;
  fallbackUsed: boolean;
  advisoryOnly: true;
  generatedAt: string;
  results: BuyerRecommendationItem[];
}

export const managerInsightRequestSchema = z.object({
  question: z.string().trim().min(3).max(500),
});
export type ManagerInsightRequest = z.infer<typeof managerInsightRequestSchema>;

export interface ManagerProjectMetricsSnapshot {
  availableInventory: number;
  reservedInventory: number;
  soldInventory: number;
  transactionsTotal: number;
  transactionsOpen: number;
  transactionsReady: number;
  transactionsCompleted: number;
  overduePaymentItems: number;
  overduePaymentAmount: string;
  dueCommissionCases: number;
  dueCommissionAmount: string;
  failedNotificationJobs: number;
  pendingDocumentRequirements: number;
}

export interface ManagerInsightResponse {
  providerUsed: AiProviderCode;
  fallbackUsed: boolean;
  advisoryOnly: true;
  generatedAt: string;
  answer: string;
  findings: string[];
  metrics: ManagerProjectMetricsSnapshot;
}

export const externalRecommendationResponseSchema = z.object({
  rankings: z.array(z.object({
    unitTypeId: z.string().uuid(),
    score: z.number().finite().min(0).max(100),
    reason: z.string().trim().min(1).max(400),
  })).max(20),
  requestId: z.string().trim().max(200).nullable().optional(),
});

export const externalManagerInsightResponseSchema = z.object({
  answer: z.string().trim().min(1).max(4000),
  findings: z.array(z.string().trim().min(1).max(500)).max(10),
  requestId: z.string().trim().max(200).nullable().optional(),
});
