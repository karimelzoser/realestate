import { z } from 'zod';

const codeSchema = z.string().trim().min(1).max(80);
const nameSchema = z.string().trim().min(1).max(200);
const nullableUuidSchema = z.uuid().nullable().optional();

export const projectCatalogNodeStatusSchema = z.enum(['ACTIVE', 'HIDDEN', 'ARCHIVED']);
export type ProjectCatalogNodeStatus = z.infer<typeof projectCatalogNodeStatusSchema>;

export const createProjectPhaseSchema = z.object({
  code: codeSchema,
  name: nameSchema,
  sortOrder: z.number().int().min(-100000).max(100000).default(0),
});
export type CreateProjectPhaseInput = z.infer<typeof createProjectPhaseSchema>;

export const createProjectBuildingSchema = z.object({
  phaseId: nullableUuidSchema,
  code: codeSchema,
  name: nameSchema,
  clusterName: z.string().trim().min(1).max(200).nullable().optional(),
  masterPlanGeometry: z.record(z.string(), z.unknown()).nullable().optional(),
  sortOrder: z.number().int().min(-100000).max(100000).default(0),
});
export type CreateProjectBuildingInput = z.infer<typeof createProjectBuildingSchema>;

export const createProjectFloorSchema = z.object({
  buildingId: z.uuid(),
  code: codeSchema,
  name: nameSchema,
  levelNumber: z.number().int().min(-20).max(500).nullable().optional(),
  sortOrder: z.number().int().min(-100000).max(100000).default(0),
});
export type CreateProjectFloorInput = z.infer<typeof createProjectFloorSchema>;

export const createPhysicalUnitSchema = z.object({
  buildingId: z.uuid(),
  floorId: z.uuid(),
  unitTypeId: z.uuid(),
  internalReference: z.string().trim().min(1).max(160),
  displayReference: z.string().trim().min(1).max(160).nullable().optional(),
  orientation: z.string().trim().min(1).max(80).nullable().optional(),
  viewCode: z.string().trim().min(1).max(80).nullable().optional(),
  cornerPosition: z.string().trim().min(1).max(80).nullable().optional(),
  masterPlanGeometry: z.record(z.string(), z.unknown()).nullable().optional(),
  createInventorySlot: z.boolean().default(true),
});
export type CreatePhysicalUnitInput = z.infer<typeof createPhysicalUnitSchema>;

export const projectMasterPlanAssetTypeSchema = z.enum([
  'MASTER_PLAN_IMAGE',
  'MASTER_PLAN_3D',
  'BUILDING_MODEL',
  'FLOOR_PLAN',
  'UNIT_MODEL',
  'OTHER',
]);
export type ProjectMasterPlanAssetType = z.infer<typeof projectMasterPlanAssetTypeSchema>;

export const createProjectMasterPlanAssetSchema = z.object({
  phaseId: nullableUuidSchema,
  buildingId: nullableUuidSchema,
  assetType: projectMasterPlanAssetTypeSchema,
  label: nameSchema,
  storageObjectKey: z.string().trim().min(1).max(1000),
  mimeType: z.string().trim().min(1).max(200),
  sha256Hex: z.string().regex(/^[0-9a-fA-F]{64}$/),
  metadata: z.record(z.string(), z.unknown()).default({}),
});
export type CreateProjectMasterPlanAssetInput = z.infer<typeof createProjectMasterPlanAssetSchema>;

export const paymentPlanDefinitionSchema = z.object({
  downPaymentPercent: z.number().finite().min(0).max(100),
  installmentCount: z.number().int().min(0).max(240),
  installmentIntervalMonths: z.number().int().min(1).max(60).default(3),
  finalPaymentPercent: z.number().finite().min(0).max(100).default(0),
  maintenancePercent: z.number().finite().min(0).max(100).default(0),
  notes: z.string().trim().max(2000).nullable().optional(),
}).superRefine((value, context) => {
  if (value.downPaymentPercent + value.finalPaymentPercent > 100) {
    context.addIssue({ code: 'custom', message: 'Down payment and final payment cannot exceed 100%.' });
  }
});

export const createProjectPaymentPlanSchema = z.object({
  code: codeSchema,
  name: nameSchema,
  versionNumber: z.number().int().min(1).max(100000),
  effectiveAt: z.iso.datetime({ offset: true }),
  definition: paymentPlanDefinitionSchema,
});
export type CreateProjectPaymentPlanInput = z.infer<typeof createProjectPaymentPlanSchema>;

export const projectSalesChannelSchema = z.enum(['ONLINE', 'SALES_CENTER', 'BROKER']);
export type ProjectSalesChannel = z.infer<typeof projectSalesChannelSchema>;

export const createProjectSalesWindowSchema = z.object({
  phaseId: nullableUuidSchema,
  label: nameSchema,
  opensAt: z.iso.datetime({ offset: true }),
  closesAt: z.iso.datetime({ offset: true }).nullable().optional(),
  channels: z.array(projectSalesChannelSchema).min(1).max(3).default(['ONLINE', 'SALES_CENTER', 'BROKER']),
}).superRefine((value, context) => {
  if (value.closesAt && new Date(value.closesAt).getTime() <= new Date(value.opensAt).getTime()) {
    context.addIssue({ code: 'custom', message: 'Sales window close time must be after open time.' });
  }
});
export type CreateProjectSalesWindowInput = z.infer<typeof createProjectSalesWindowSchema>;

export interface ProjectPhaseSnapshot {
  id: string;
  code: string;
  name: string;
  status: ProjectCatalogNodeStatus;
  sortOrder: number;
}

export interface ProjectBuildingSnapshot {
  id: string;
  phaseId: string | null;
  code: string;
  name: string;
  clusterName: string | null;
  masterPlanGeometry: Record<string, unknown> | null;
  status: ProjectCatalogNodeStatus;
  sortOrder: number;
}

export interface ProjectFloorSnapshot {
  id: string;
  buildingId: string;
  code: string;
  name: string;
  levelNumber: number | null;
  status: ProjectCatalogNodeStatus;
  sortOrder: number;
}

export interface PhysicalUnitSnapshot {
  id: string;
  buildingId: string;
  floorId: string;
  unitTypeId: string;
  unitTypeCode: string;
  unitTypeName: string;
  internalReference: string;
  displayReference: string | null;
  orientation: string | null;
  viewCode: string | null;
  cornerPosition: string | null;
  masterPlanGeometry: Record<string, unknown> | null;
  status: 'ACTIVE' | 'WITHDRAWN' | 'ARCHIVED';
  inventorySlotId: string | null;
  inventoryState: 'AVAILABLE' | 'RESERVED' | 'SOLD' | 'WITHDRAWN' | null;
}

export interface ProjectMasterPlanAssetSnapshot {
  id: string;
  phaseId: string | null;
  buildingId: string | null;
  assetType: ProjectMasterPlanAssetType;
  label: string;
  storageObjectKey: string;
  mimeType: string;
  sha256Hex: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface ProjectPaymentPlanSnapshot {
  id: string;
  code: string;
  name: string;
  versionNumber: number;
  status: 'DRAFT' | 'ACTIVE' | 'RETIRED' | 'CANCELLED';
  definition: z.infer<typeof paymentPlanDefinitionSchema>;
  effectiveAt: string;
  activatedAt: string | null;
}

export interface ProjectSalesWindowSnapshot {
  id: string;
  phaseId: string | null;
  label: string;
  opensAt: string;
  closesAt: string | null;
  channels: ProjectSalesChannel[];
  status: 'SCHEDULED' | 'OPEN' | 'CLOSED' | 'CANCELLED';
}

export interface ProjectHierarchySnapshot {
  tenantId: string;
  projectId: string;
  phases: ProjectPhaseSnapshot[];
  buildings: ProjectBuildingSnapshot[];
  floors: ProjectFloorSnapshot[];
  physicalUnits: PhysicalUnitSnapshot[];
  assets: ProjectMasterPlanAssetSnapshot[];
  paymentPlans: ProjectPaymentPlanSnapshot[];
  salesWindows: ProjectSalesWindowSnapshot[];
}

export const projectImportTypeSchema = z.enum([
  'HIERARCHY',
  'UNIT_TYPES',
  'PHYSICAL_UNITS',
  'PRICING',
  'PAYMENT_PLANS',
]);
export type ProjectImportType = z.infer<typeof projectImportTypeSchema>;

export const projectImportSourceFormatSchema = z.enum(['CSV', 'XLSX', 'JSON']);
export type ProjectImportSourceFormat = z.infer<typeof projectImportSourceFormatSchema>;

export const createProjectImportJobSchema = z.object({
  importType: projectImportTypeSchema,
  sourceFormat: projectImportSourceFormatSchema,
  sourceFileName: z.string().trim().min(1).max(500),
  sourceSha256Hex: z.string().regex(/^[0-9a-fA-F]{64}$/).nullable().optional(),
  sourceObjectKey: z.string().trim().min(1).max(1000).nullable().optional(),
  mapping: z.record(z.string(), z.string().trim().min(1).max(200)).default({}),
});
export type CreateProjectImportJobInput = z.infer<typeof createProjectImportJobSchema>;

export const stageProjectImportRowsSchema = z.object({
  rows: z.array(z.object({
    rowNumber: z.number().int().min(1),
    data: z.record(z.string(), z.unknown()),
  })).min(1).max(2000),
});
export type StageProjectImportRowsInput = z.infer<typeof stageProjectImportRowsSchema>;

export const updateProjectImportMappingSchema = z.object({
  mapping: z.record(z.string(), z.string().trim().min(1).max(200)),
});
export type UpdateProjectImportMappingInput = z.infer<typeof updateProjectImportMappingSchema>;

export type ProjectImportJobStatus = 'DRAFT' | 'VALIDATING' | 'VALIDATED' | 'PUBLISHING' | 'PUBLISHED' | 'FAILED' | 'CANCELLED';
export type ProjectImportRowStatus = 'PENDING' | 'VALID' | 'INVALID' | 'PUBLISHED';

export interface ProjectImportRowSnapshot {
  rowNumber: number;
  rawData: Record<string, unknown>;
  normalizedData: Record<string, unknown> | null;
  status: ProjectImportRowStatus;
  errors: string[];
}

export interface ProjectImportJobSnapshot {
  id: string;
  tenantId: string;
  projectId: string;
  importType: ProjectImportType;
  sourceFormat: ProjectImportSourceFormat;
  sourceFileName: string;
  sourceSha256Hex: string | null;
  sourceObjectKey: string | null;
  mapping: Record<string, string>;
  status: ProjectImportJobStatus;
  totalRows: number;
  validRows: number;
  invalidRows: number;
  validatedAt: string | null;
  publishedAt: string | null;
  createdAt: string;
}

export interface ProjectImportPreviewSnapshot {
  job: ProjectImportJobSnapshot;
  rows: ProjectImportRowSnapshot[];
}
