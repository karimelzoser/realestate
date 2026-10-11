import { z } from 'zod';

const hexColorSchema = z.string().regex(/^#[0-9A-Fa-f]{6}$/);

export const tenantBrandingInputSchema = z.object({
  displayNameEn: z.string().trim().min(2).max(160),
  displayNameAr: z.string().trim().min(2).max(160),
  legalName: z.string().trim().min(2).max(220).nullable().optional(),
  primaryColor: hexColorSchema.default('#111827'),
  secondaryColor: hexColorSchema.nullable().optional(),
  websiteUrl: z.url().refine((value) => value.startsWith('https://'), 'websiteUrl must use https').nullable().optional(),
});
export type TenantBrandingInput = z.infer<typeof tenantBrandingInputSchema>;

export const projectBrandingInputSchema = z.object({
  displayNameEn: z.string().trim().min(2).max(180),
  displayNameAr: z.string().trim().min(2).max(180),
  shortDescriptionEn: z.string().trim().max(1000).nullable().optional(),
  shortDescriptionAr: z.string().trim().max(1000).nullable().optional(),
  primaryColor: hexColorSchema.nullable().optional(),
  secondaryColor: hexColorSchema.nullable().optional(),
});
export type ProjectBrandingInput = z.infer<typeof projectBrandingInputSchema>;

export interface TenantBrandingSnapshot {
  displayNameEn: string;
  displayNameAr: string;
  legalName: string | null;
  primaryColor: string;
  secondaryColor: string | null;
  websiteUrl: string | null;
  updatedAt: string;
}

export interface ProjectBrandingSnapshot {
  projectId: string;
  projectCode: string;
  projectStatus: 'DRAFT' | 'ACTIVE' | 'PAUSED' | 'CLOSED' | 'ARCHIVED';
  displayNameEn: string;
  displayNameAr: string;
  shortDescriptionEn: string | null;
  shortDescriptionAr: string | null;
  primaryColor: string | null;
  secondaryColor: string | null;
  updatedAt: string;
}

export interface DeveloperOnboardingReadiness {
  brandingConfigured: boolean;
  operationsDirectorAssigned: boolean;
  projectCreated: boolean;
  projectBrandingConfigured: boolean;
  ready: boolean;
}

export interface DeveloperOnboardingStaffSnapshot {
  operationsDirectors: number;
  pendingOperationsDirectors: number;
  activeStaff: number;
  invitedStaff: number;
}

export interface DeveloperOnboardingSnapshot {
  tenantId: string;
  tenantCode: string;
  tenantName: string;
  tenantStatus: 'ACTIVE' | 'SUSPENDED' | 'ARCHIVED';
  status: 'SETUP' | 'COMPLETED';
  completedAt: string | null;
  completedBy: string | null;
  branding: TenantBrandingSnapshot | null;
  projects: ProjectBrandingSnapshot[];
  staff: DeveloperOnboardingStaffSnapshot;
  readiness: DeveloperOnboardingReadiness;
}
