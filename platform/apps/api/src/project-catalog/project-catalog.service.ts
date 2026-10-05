import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  paymentPlanDefinitionSchema,
  type CreatePhysicalUnitInput,
  type CreateProjectBuildingInput,
  type CreateProjectFloorInput,
  type CreateProjectImportJobInput,
  type CreateProjectMasterPlanAssetInput,
  type CreateProjectPaymentPlanInput,
  type CreateProjectPhaseInput,
  type CreateProjectSalesWindowInput,
  type ProjectHierarchySnapshot,
  type ProjectImportJobSnapshot,
  type ProjectImportPreviewSnapshot,
  type StageProjectImportRowsInput,
  type UpdateProjectImportMappingInput,
} from '@preneura/contracts/project-catalog';
import { AccessService } from '../access/access.service.js';
import { ProjectCatalogRepository } from './project-catalog.repository.js';

@Injectable()
export class ProjectCatalogService {
  constructor(
    private readonly repository: ProjectCatalogRepository,
    private readonly access: AccessService,
  ) {}

  async hierarchy(input: { actorUserId: string; tenantId: string; projectId: string }): Promise<ProjectHierarchySnapshot> {
    await this.requireProject(input.tenantId, input.projectId);
    await this.access.assert({ userId: input.actorUserId, permission: 'project.read', context: this.context(input) });
    return this.repository.hierarchy(input.tenantId, input.projectId);
  }

  async createPhase(input: { actorUserId: string; tenantId: string; projectId: string; data: CreateProjectPhaseInput }) {
    await this.assertManage(input); return { id: await this.repository.createPhase(input) };
  }
  async createBuilding(input: { actorUserId: string; tenantId: string; projectId: string; data: CreateProjectBuildingInput }) {
    await this.assertManage(input); return { id: await this.repository.createBuilding(input) };
  }
  async createFloor(input: { actorUserId: string; tenantId: string; projectId: string; data: CreateProjectFloorInput }) {
    await this.assertManage(input); return { id: await this.repository.createFloor(input) };
  }
  async createPhysicalUnit(input: { actorUserId: string; tenantId: string; projectId: string; data: CreatePhysicalUnitInput }) {
    await this.assertManage(input); return this.repository.createPhysicalUnit(input);
  }
  async createAsset(input: { actorUserId: string; tenantId: string; projectId: string; data: CreateProjectMasterPlanAssetInput }) {
    await this.assertManage(input); return { id: await this.repository.createAsset(input) };
  }
  async createPaymentPlan(input: { actorUserId: string; tenantId: string; projectId: string; data: CreateProjectPaymentPlanInput }) {
    await this.assertManage(input); return { id: await this.repository.createPaymentPlan(input) };
  }
  async createSalesWindow(input: { actorUserId: string; tenantId: string; projectId: string; data: CreateProjectSalesWindowInput }) {
    await this.assertManage(input); return { id: await this.repository.createSalesWindow(input) };
  }

  async listImports(input: { actorUserId: string; tenantId: string; projectId: string }): Promise<ProjectImportJobSnapshot[]> {
    await this.assertImportManage(input);
    return this.repository.listImportJobs(input.tenantId, input.projectId);
  }

  async createImport(input: { actorUserId: string; tenantId: string; projectId: string; data: CreateProjectImportJobInput }): Promise<ProjectImportJobSnapshot> {
    await this.assertImportManage(input);
    return this.repository.createImportJob(input);
  }

  async stageImportRows(input: { actorUserId: string; tenantId: string; projectId: string; jobId: string; data: StageProjectImportRowsInput }): Promise<{ staged: number }> {
    await this.assertImportManage(input);
    await this.requireJob(input.tenantId, input.projectId, input.jobId);
    const unique = new Set(input.data.rows.map((row) => row.rowNumber));
    if (unique.size !== input.data.rows.length) throw new BadRequestException('Row numbers must be unique within a staging request.');
    try {
      await this.repository.stageRows({ tenantId: input.tenantId, projectId: input.projectId, jobId: input.jobId, rows: input.data.rows });
    } catch (error) {
      if (error instanceof Error && error.message === 'IMPORT_JOB_NOT_DRAFT') throw new ConflictException('Only draft imports can accept staged rows.');
      throw error;
    }
    return { staged: input.data.rows.length };
  }

  async updateImportMapping(input: { actorUserId: string; tenantId: string; projectId: string; jobId: string; data: UpdateProjectImportMappingInput }): Promise<{ updated: true }> {
    await this.assertImportManage(input);
    await this.requireJob(input.tenantId, input.projectId, input.jobId);
    try {
      await this.repository.updateMapping({ tenantId: input.tenantId, projectId: input.projectId, jobId: input.jobId, mapping: input.data.mapping });
    } catch (error) {
      if (error instanceof Error && error.message === 'IMPORT_JOB_NOT_DRAFT') throw new ConflictException('Only draft imports can change mapping.');
      throw error;
    }
    return { updated: true };
  }

  async validateImport(input: { actorUserId: string; tenantId: string; projectId: string; jobId: string }): Promise<ProjectImportPreviewSnapshot> {
    await this.assertImportManage(input);
    const job = await this.requireJob(input.tenantId, input.projectId, input.jobId);
    if (job.status !== 'DRAFT') throw new ConflictException('Only a draft import can be validated.');
    const rows = await this.repository.rawImportRows(input.jobId);
    if (rows.length === 0) throw new ConflictException('Stage at least one row before validation.');
    const state = await this.repository.referenceState(input.tenantId, input.projectId);
    const validationContext = new ImportValidationContext(state);
    const validated = rows.map((row) => {
      const result = validateRow(job.import_type, row.raw_data, job.mapping, validationContext);
      return { rowId: row.id, normalized: result.normalized, errors: result.errors };
    });
    await this.repository.saveValidation({ jobId: input.jobId, rows: validated });
    const preview = await this.repository.preview(input.tenantId, input.projectId, input.jobId);
    if (!preview) throw new NotFoundException('Import job not found after validation.');
    return preview;
  }

  async importPreview(input: { actorUserId: string; tenantId: string; projectId: string; jobId: string }): Promise<ProjectImportPreviewSnapshot> {
    await this.assertImportManage(input);
    const preview = await this.repository.preview(input.tenantId, input.projectId, input.jobId);
    if (!preview) throw new NotFoundException('Import job not found.');
    return preview;
  }

  async publishImport(input: { actorUserId: string; tenantId: string; projectId: string; jobId: string }): Promise<{ published: true }> {
    await this.assertImportManage(input);
    try {
      await this.repository.publishImport(input);
    } catch (error) {
      if (error instanceof Error && error.message === 'IMPORT_JOB_NOT_PUBLISHABLE') {
        throw new ConflictException('Import must be validated with at least one valid row and zero invalid rows before publication.');
      }
      if (error instanceof Error && error.message === 'IMPORT_REFERENCE_CHANGED') {
        throw new ConflictException('A referenced project record changed after validation. Recreate and validate the import against current project data.');
      }
      throw error;
    }
    return { published: true };
  }

  async rollbackImport(input: { actorUserId: string; tenantId: string; projectId: string; jobId: string }): Promise<{ rolledBack: true }> {
    await this.assertImportManage(input);
    try {
      await this.repository.rollbackImport(input);
    } catch (error) {
      if (error instanceof Error && error.message === 'IMPORT_JOB_NOT_ROLLBACKABLE') throw new ConflictException('Only a published import that has not already been rolled back can be rolled back.');
      if (error instanceof Error && error.message.startsWith('IMPORT_ROLLBACK_BLOCKED_')) {
        throw new ConflictException('Rollback is blocked because at least one imported record is now in use or no longer in a reversible draft/available state.');
      }
      throw error;
    }
    return { rolledBack: true };
  }

  private async assertManage(input: { actorUserId: string; tenantId: string; projectId: string }): Promise<void> {
    await this.requireProject(input.tenantId, input.projectId);
    await this.access.assert({ userId: input.actorUserId, permission: 'project.manage', context: this.context(input) });
  }
  private async assertImportManage(input: { actorUserId: string; tenantId: string; projectId: string }): Promise<void> {
    await this.requireProject(input.tenantId, input.projectId);
    await this.access.assert({ userId: input.actorUserId, permission: 'project.import.manage', context: this.context(input) });
  }
  private async requireProject(tenantId: string, projectId: string): Promise<void> {
    if (!(await this.repository.projectExists(tenantId, projectId))) throw new NotFoundException('Project not found.');
  }
  private async requireJob(tenantId: string, projectId: string, jobId: string) {
    const job = await this.repository.importJob(tenantId, projectId, jobId);
    if (!job) throw new NotFoundException('Import job not found.');
    return job;
  }
  private context(input: { tenantId: string; projectId: string }) { return { tenantId: input.tenantId, projectId: input.projectId }; }
}

type ReferenceState = Awaited<ReturnType<ProjectCatalogRepository['referenceState']>>;
type ValidationResult = { normalized: Record<string, unknown> | null; errors: string[] };

class ImportValidationContext {
  readonly hierarchyDefinitions = new Map<string, string>();
  readonly unitTypeCodes = new Set<string>();
  readonly physicalReferences = new Set<string>();
  readonly pricingKeys = new Set<string>();
  readonly paymentPlanKeys = new Set<string>();
  pricingLabel: string | null = null;
  pricingEffectiveAt: string | null = null;
  constructor(readonly state: ReferenceState) {}
}

function validateRow(type: ProjectImportJobSnapshot['importType'], raw: Record<string, unknown>, mapping: Record<string, string>, context: ImportValidationContext): ValidationResult {
  if (type === 'HIERARCHY') return validateHierarchy(raw, mapping, context);
  if (type === 'UNIT_TYPES') return validateUnitType(raw, mapping, context);
  if (type === 'PHYSICAL_UNITS') return validatePhysicalUnit(raw, mapping, context);
  if (type === 'PRICING') return validatePricing(raw, mapping, context);
  return validatePaymentPlan(raw, mapping, context);
}

function validateHierarchy(raw: Record<string, unknown>, mapping: Record<string, string>, context: ImportValidationContext): ValidationResult {
  const phaseCode = optionalText(value(raw, mapping, 'phaseCode'));
  const phaseName = optionalText(value(raw, mapping, 'phaseName'));
  const buildingCode = optionalText(value(raw, mapping, 'buildingCode'));
  const buildingName = optionalText(value(raw, mapping, 'buildingName'));
  const clusterName = optionalText(value(raw, mapping, 'clusterName'));
  const floorCode = optionalText(value(raw, mapping, 'floorCode'));
  const floorName = optionalText(value(raw, mapping, 'floorName'));
  const errors: string[] = [];
  if (!phaseCode && !buildingCode && !floorCode) errors.push('At least one phase, building, or floor code is required.');
  if (phaseCode && !phaseName && !context.state.phases.has(phaseCode)) errors.push('phaseName is required for a new phase.');
  if (buildingCode && !buildingName && !context.state.buildings.has(buildingCode)) errors.push('buildingName is required for a new building.');
  if (floorCode && !buildingCode) errors.push('buildingCode is required when floorCode is provided.');
  if (floorCode && !floorName && !(buildingCode && context.state.floors.has(`${buildingCode}:${floorCode}`))) errors.push('floorName is required for a new floor.');
  const existingBuilding = buildingCode ? context.state.buildings.get(buildingCode) : undefined;
  if (existingBuilding && phaseCode && existingBuilding.phaseCode !== phaseCode) errors.push('Existing building belongs to a different phase.');
  if (buildingCode && floorCode) {
    const existingFloor = context.state.floors.get(`${buildingCode}:${floorCode}`);
    if (existingFloor && existingFloor.buildingCode !== buildingCode) errors.push('Existing floor belongs to a different building.');
  }
  const normalized = {
    phaseCode, phaseName, phaseSortOrder: integer(value(raw, mapping, 'phaseSortOrder'), 0),
    buildingCode, buildingName, clusterName, buildingSortOrder: integer(value(raw, mapping, 'buildingSortOrder'), 0),
    floorCode, floorName, levelNumber: nullableInteger(value(raw, mapping, 'levelNumber')),
    floorSortOrder: integer(value(raw, mapping, 'floorSortOrder'), 0),
  };
  for (const [key, signature] of [
    phaseCode ? [`phase:${phaseCode}`, JSON.stringify([phaseName])] : null,
    buildingCode ? [`building:${buildingCode}`, JSON.stringify([phaseCode, buildingName, clusterName])] : null,
    buildingCode && floorCode ? [`floor:${buildingCode}:${floorCode}`, JSON.stringify([floorName, normalized.levelNumber])] : null,
  ].filter(Boolean) as Array<[string, string]>) {
    const prior = context.hierarchyDefinitions.get(key);
    if (prior && prior !== signature) errors.push(`Conflicting repeated definition for ${key}.`);
    else context.hierarchyDefinitions.set(key, signature);
  }
  return { normalized, errors };
}

function validateUnitType(raw: Record<string, unknown>, mapping: Record<string, string>, context: ImportValidationContext): ValidationResult {
  const errors: string[] = [];
  const code = requiredText(value(raw, mapping, 'code'), 'code', errors);
  const name = requiredText(value(raw, mapping, 'name'), 'name', errors);
  const indoorAreaSqm = positiveDecimal(value(raw, mapping, 'indoorAreaSqm'), 'indoorAreaSqm', errors);
  const roofAreaSqm = nonNegativeDecimal(value(raw, mapping, 'roofAreaSqm'), 'roofAreaSqm', errors, '0.00');
  const gardenAreaSqm = nonNegativeDecimal(value(raw, mapping, 'gardenAreaSqm'), 'gardenAreaSqm', errors, '0.00');
  if (code && (context.state.unitTypes.has(code) || context.unitTypeCodes.has(code))) errors.push('Unit type code already exists in the project or this import.');
  if (code) context.unitTypeCodes.add(code);
  const bedrooms = nullableInteger(value(raw, mapping, 'bedroomCount'));
  if (bedrooms != null && bedrooms < 0) errors.push('bedroomCount cannot be negative.');
  return { normalized: { code, name, description: optionalText(value(raw, mapping, 'description')), bedroomCount: bedrooms, indoorAreaSqm, roofAreaSqm, gardenAreaSqm, sortOrder: integer(value(raw, mapping, 'sortOrder'), 0) }, errors };
}

function validatePhysicalUnit(raw: Record<string, unknown>, mapping: Record<string, string>, context: ImportValidationContext): ValidationResult {
  const errors: string[] = [];
  const internalReference = requiredText(value(raw, mapping, 'internalReference'), 'internalReference', errors);
  const buildingCode = requiredText(value(raw, mapping, 'buildingCode'), 'buildingCode', errors);
  const floorCode = requiredText(value(raw, mapping, 'floorCode'), 'floorCode', errors);
  const unitTypeCode = requiredText(value(raw, mapping, 'unitTypeCode'), 'unitTypeCode', errors);
  if (buildingCode && !context.state.buildings.has(buildingCode)) errors.push('buildingCode does not exist in the project.');
  if (buildingCode && floorCode && !context.state.floors.has(`${buildingCode}:${floorCode}`)) errors.push('floorCode does not exist under the selected building.');
  if (unitTypeCode && !context.state.unitTypes.has(unitTypeCode)) errors.push('unitTypeCode does not exist in the project.');
  if (internalReference && (context.state.physicalUnits.has(internalReference) || context.state.inventoryReferences.has(internalReference) || context.physicalReferences.has(internalReference))) errors.push('internalReference already exists in the project or this import.');
  if (internalReference) context.physicalReferences.add(internalReference);
  return { normalized: {
    internalReference, displayReference: optionalText(value(raw, mapping, 'displayReference')),
    buildingCode, floorCode, unitTypeCode, orientation: optionalText(value(raw, mapping, 'orientation')),
    viewCode: optionalText(value(raw, mapping, 'viewCode')), cornerPosition: optionalText(value(raw, mapping, 'cornerPosition')),
  }, errors };
}

function validatePricing(raw: Record<string, unknown>, mapping: Record<string, string>, context: ImportValidationContext): ValidationResult {
  const errors: string[] = [];
  const pricingLabel = requiredText(value(raw, mapping, 'pricingLabel'), 'pricingLabel', errors);
  const effectiveAt = isoDate(value(raw, mapping, 'effectiveAt'), 'effectiveAt', errors);
  const unitTypeCode = requiredText(value(raw, mapping, 'unitTypeCode'), 'unitTypeCode', errors);
  const component = requiredText(value(raw, mapping, 'component'), 'component', errors)?.toUpperCase() ?? '';
  const ratePerSqm = nonNegativeDecimal(value(raw, mapping, 'ratePerSqm'), 'ratePerSqm', errors);
  if (pricingLabel && context.state.pricingVersions.has(pricingLabel)) errors.push('pricingLabel already exists in the project.');
  if (unitTypeCode && !context.state.unitTypes.has(unitTypeCode)) errors.push('unitTypeCode does not exist in the project.');
  if (!['INDOOR','ROOF','GARDEN'].includes(component)) errors.push('component must be INDOOR, ROOF, or GARDEN.');
  if (context.pricingLabel == null) context.pricingLabel = pricingLabel;
  else if (pricingLabel && context.pricingLabel !== pricingLabel) errors.push('All pricing rows in one import must use the same pricingLabel.');
  if (context.pricingEffectiveAt == null) context.pricingEffectiveAt = effectiveAt;
  else if (effectiveAt && context.pricingEffectiveAt !== effectiveAt) errors.push('All pricing rows in one import must use the same effectiveAt.');
  const key = `${unitTypeCode}:${component}`;
  if (context.pricingKeys.has(key)) errors.push('Duplicate unit type/component pricing row.');
  context.pricingKeys.add(key);
  return { normalized: { pricingLabel, effectiveAt, unitTypeCode, component, ratePerSqm }, errors };
}

function validatePaymentPlan(raw: Record<string, unknown>, mapping: Record<string, string>, context: ImportValidationContext): ValidationResult {
  const errors: string[] = [];
  const code = requiredText(value(raw, mapping, 'code'), 'code', errors);
  const name = requiredText(value(raw, mapping, 'name'), 'name', errors);
  const versionNumber = positiveInteger(value(raw, mapping, 'versionNumber'), 'versionNumber', errors);
  const effectiveAt = isoDate(value(raw, mapping, 'effectiveAt'), 'effectiveAt', errors);
  const definitionCandidate = {
    downPaymentPercent: finiteNumber(value(raw, mapping, 'downPaymentPercent')),
    installmentCount: integer(value(raw, mapping, 'installmentCount'), Number.NaN),
    installmentIntervalMonths: integer(value(raw, mapping, 'installmentIntervalMonths'), 3),
    finalPaymentPercent: finiteNumber(value(raw, mapping, 'finalPaymentPercent'), 0),
    maintenancePercent: finiteNumber(value(raw, mapping, 'maintenancePercent'), 0),
    notes: optionalText(value(raw, mapping, 'notes')),
  };
  const parsed = paymentPlanDefinitionSchema.safeParse(definitionCandidate);
  if (!parsed.success) errors.push(...parsed.error.issues.map((issue) => `definition: ${issue.message}`));
  const key = `${code}:${versionNumber}`;
  if (code && Number.isFinite(versionNumber) && (context.state.paymentPlans.has(key) || context.paymentPlanKeys.has(key))) errors.push('Payment-plan code/version already exists in the project or this import.');
  context.paymentPlanKeys.add(key);
  return { normalized: { code, name, versionNumber, effectiveAt, definition: parsed.success ? parsed.data : definitionCandidate }, errors };
}

function value(raw: Record<string, unknown>, mapping: Record<string, string>, target: string): unknown {
  return raw[mapping[target] ?? target];
}
function optionalText(input: unknown): string | null {
  if (input == null) return null;
  const value = String(input).trim();
  return value ? value : null;
}
function requiredText(input: unknown, field: string, errors: string[]): string {
  const result = optionalText(input);
  if (!result) errors.push(`${field} is required.`);
  return result ?? '';
}
function finiteNumber(input: unknown, fallback = Number.NaN): number {
  if (input == null || String(input).trim() === '') return fallback;
  const parsed = Number(input); return Number.isFinite(parsed) ? parsed : fallback;
}
function integer(input: unknown, fallback: number): number {
  const parsed = finiteNumber(input, fallback); return Number.isInteger(parsed) ? parsed : fallback;
}
function nullableInteger(input: unknown): number | null {
  if (input == null || String(input).trim() === '') return null;
  const parsed = Number(input); return Number.isInteger(parsed) ? parsed : null;
}
function positiveInteger(input: unknown, field: string, errors: string[]): number {
  const parsed = Number(input); if (!Number.isInteger(parsed) || parsed <= 0) errors.push(`${field} must be a positive integer.`); return parsed;
}
function positiveDecimal(input: unknown, field: string, errors: string[]): string {
  const parsed = Number(input); if (!Number.isFinite(parsed) || parsed <= 0) { errors.push(`${field} must be greater than zero.`); return '0.00'; } return parsed.toFixed(2);
}
function nonNegativeDecimal(input: unknown, field: string, errors: string[], fallback?: string): string {
  if ((input == null || String(input).trim() === '') && fallback != null) return fallback;
  const parsed = Number(input); if (!Number.isFinite(parsed) || parsed < 0) { errors.push(`${field} must be zero or greater.`); return '0.00'; } return parsed.toFixed(2);
}
function isoDate(input: unknown, field: string, errors: string[]): string {
  const raw = optionalText(input); if (!raw) { errors.push(`${field} is required.`); return ''; }
  const date = new Date(raw); if (Number.isNaN(date.getTime())) { errors.push(`${field} must be a valid date/time.`); return ''; } return date.toISOString();
}
