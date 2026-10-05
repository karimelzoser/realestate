import { Inject, Injectable } from '@nestjs/common';
import { sql, type Kysely, type Transaction } from 'kysely';
import type { Database } from '@preneura/database';
import type {
  CreatePhysicalUnitInput,
  CreateProjectBuildingInput,
  CreateProjectFloorInput,
  CreateProjectImportJobInput,
  CreateProjectMasterPlanAssetInput,
  CreateProjectPaymentPlanInput,
  CreateProjectPhaseInput,
  CreateProjectSalesWindowInput,
  ProjectHierarchySnapshot,
  ProjectImportJobSnapshot,
  ProjectImportPreviewSnapshot,
  ProjectImportRowSnapshot,
  ProjectImportType,
} from '@preneura/contracts/project-catalog';
import { DATABASE } from '../database/database.module.js';

type Db = Kysely<Database>;
type Trx = Transaction<Database>;

type JobRow = {
  id: string;
  tenant_id: string;
  project_id: string;
  import_type: ProjectImportType;
  source_format: 'CSV' | 'XLSX' | 'JSON';
  source_file_name: string;
  source_sha256_hex: string | null;
  source_object_key: string | null;
  mapping: Record<string, string>;
  status: ProjectImportJobSnapshot['status'];
  total_rows: number;
  valid_rows: number;
  invalid_rows: number;
  validated_at: Date | null;
  published_at: Date | null;
  created_at: Date;
  rollback_status: 'NONE' | 'ROLLED_BACK' | 'ROLLBACK_FAILED';
  rolled_back_at: Date | null;
};

type ImportRow = {
  id: string;
  row_number: number;
  raw_data: Record<string, unknown>;
  normalized_data: Record<string, unknown> | null;
  status: ProjectImportRowSnapshot['status'];
  errors: unknown;
};

export type ValidatedImportRow = {
  rowId: string;
  rowNumber: number;
  normalized: Record<string, unknown>;
};

@Injectable()
export class ProjectCatalogRepository {
  constructor(@Inject(DATABASE) private readonly db: Db) {}

  async projectExists(tenantId: string, projectId: string): Promise<boolean> {
    const result = await sql<{ exists: boolean }>`
      SELECT EXISTS(
        SELECT 1 FROM projects
        WHERE id = ${projectId}::uuid AND tenant_id = ${tenantId}::uuid
      ) AS exists
    `.execute(this.db);
    return result.rows[0]?.exists ?? false;
  }

  async hierarchy(tenantId: string, projectId: string): Promise<ProjectHierarchySnapshot> {
    const [phases, buildings, floors, units, assets, paymentPlans, salesWindows] = await Promise.all([
      sql<any>`SELECT id, code, name, status, sort_order FROM project_phases WHERE tenant_id=${tenantId}::uuid AND project_id=${projectId}::uuid ORDER BY sort_order, name`.execute(this.db),
      sql<any>`SELECT id, phase_id, code, name, cluster_name, master_plan_geometry, status, sort_order FROM project_buildings WHERE tenant_id=${tenantId}::uuid AND project_id=${projectId}::uuid ORDER BY sort_order, name`.execute(this.db),
      sql<any>`SELECT id, building_id, code, name, level_number, status, sort_order FROM project_floors WHERE tenant_id=${tenantId}::uuid AND project_id=${projectId}::uuid ORDER BY building_id, sort_order, level_number NULLS LAST, name`.execute(this.db),
      sql<any>`
        SELECT u.id, u.building_id, u.floor_id, u.unit_type_id, t.code AS unit_type_code, t.name AS unit_type_name,
               u.internal_reference, u.display_reference, u.orientation, u.view_code, u.corner_position,
               u.master_plan_geometry, u.status, s.id AS inventory_slot_id, s.state AS inventory_state
        FROM physical_units u
        JOIN catalog_unit_types t ON t.id=u.unit_type_id AND t.tenant_id=u.tenant_id AND t.project_id=u.project_id
        LEFT JOIN inventory_slots s ON s.physical_unit_id=u.id
        WHERE u.tenant_id=${tenantId}::uuid AND u.project_id=${projectId}::uuid
        ORDER BY u.internal_reference
      `.execute(this.db),
      sql<any>`SELECT id, phase_id, building_id, asset_type, label, storage_object_key, mime_type, sha256_hex, metadata, created_at FROM project_master_plan_assets WHERE tenant_id=${tenantId}::uuid AND project_id=${projectId}::uuid AND status='ACTIVE' ORDER BY created_at DESC`.execute(this.db),
      sql<any>`SELECT id, code, name, version_number, status, definition, effective_at, activated_at FROM project_payment_plan_definitions WHERE tenant_id=${tenantId}::uuid AND project_id=${projectId}::uuid ORDER BY code, version_number DESC`.execute(this.db),
      sql<any>`SELECT id, phase_id, label, opens_at, closes_at, channels, status FROM project_sales_windows WHERE tenant_id=${tenantId}::uuid AND project_id=${projectId}::uuid ORDER BY opens_at DESC`.execute(this.db),
    ]);

    return {
      tenantId,
      projectId,
      phases: phases.rows.map((row) => ({ id: row.id, code: row.code, name: row.name, status: row.status, sortOrder: row.sort_order })),
      buildings: buildings.rows.map((row) => ({ id: row.id, phaseId: row.phase_id, code: row.code, name: row.name, clusterName: row.cluster_name, masterPlanGeometry: row.master_plan_geometry, status: row.status, sortOrder: row.sort_order })),
      floors: floors.rows.map((row) => ({ id: row.id, buildingId: row.building_id, code: row.code, name: row.name, levelNumber: row.level_number, status: row.status, sortOrder: row.sort_order })),
      physicalUnits: units.rows.map((row) => ({
        id: row.id, buildingId: row.building_id, floorId: row.floor_id, unitTypeId: row.unit_type_id,
        unitTypeCode: row.unit_type_code, unitTypeName: row.unit_type_name,
        internalReference: row.internal_reference, displayReference: row.display_reference, orientation: row.orientation,
        viewCode: row.view_code, cornerPosition: row.corner_position, masterPlanGeometry: row.master_plan_geometry,
        status: row.status, inventorySlotId: row.inventory_slot_id, inventoryState: row.inventory_state,
      })),
      assets: assets.rows.map((row) => ({
        id: row.id, phaseId: row.phase_id, buildingId: row.building_id, assetType: row.asset_type,
        label: row.label, storageObjectKey: row.storage_object_key, mimeType: row.mime_type, sha256Hex: row.sha256_hex,
        metadata: row.metadata, createdAt: row.created_at.toISOString(),
      })),
      paymentPlans: paymentPlans.rows.map((row) => ({
        id: row.id, code: row.code, name: row.name, versionNumber: row.version_number, status: row.status,
        definition: row.definition, effectiveAt: row.effective_at.toISOString(), activatedAt: row.activated_at?.toISOString() ?? null,
      })),
      salesWindows: salesWindows.rows.map((row) => ({
        id: row.id, phaseId: row.phase_id, label: row.label, opensAt: row.opens_at.toISOString(),
        closesAt: row.closes_at?.toISOString() ?? null, channels: row.channels, status: row.status,
      })),
    };
  }

  async createPhase(input: { actorUserId: string; tenantId: string; projectId: string; data: CreateProjectPhaseInput }): Promise<string> {
    return this.withOutbox(input, 'PROJECT_PHASE', 'project.phase_created', async (trx) => {
      const result = await sql<{ id: string }>`INSERT INTO project_phases (tenant_id, project_id, code, name, sort_order) VALUES (${input.tenantId}::uuid,${input.projectId}::uuid,${input.data.code},${input.data.name},${input.data.sortOrder}) RETURNING id`.execute(trx);
      return result.rows[0]!.id;
    });
  }

  async createBuilding(input: { actorUserId: string; tenantId: string; projectId: string; data: CreateProjectBuildingInput }): Promise<string> {
    return this.withOutbox(input, 'PROJECT_BUILDING', 'project.building_created', async (trx) => {
      const result = await sql<{ id: string }>`INSERT INTO project_buildings (tenant_id, project_id, phase_id, code, name, cluster_name, master_plan_geometry, sort_order) VALUES (${input.tenantId}::uuid,${input.projectId}::uuid,${input.data.phaseId ?? null}::uuid,${input.data.code},${input.data.name},${input.data.clusterName ?? null},${JSON.stringify(input.data.masterPlanGeometry ?? null)}::jsonb,${input.data.sortOrder}) RETURNING id`.execute(trx);
      return result.rows[0]!.id;
    });
  }

  async createFloor(input: { actorUserId: string; tenantId: string; projectId: string; data: CreateProjectFloorInput }): Promise<string> {
    return this.withOutbox(input, 'PROJECT_FLOOR', 'project.floor_created', async (trx) => {
      const result = await sql<{ id: string }>`INSERT INTO project_floors (tenant_id, project_id, building_id, code, name, level_number, sort_order) VALUES (${input.tenantId}::uuid,${input.projectId}::uuid,${input.data.buildingId}::uuid,${input.data.code},${input.data.name},${input.data.levelNumber ?? null},${input.data.sortOrder}) RETURNING id`.execute(trx);
      return result.rows[0]!.id;
    });
  }

  async createPhysicalUnit(input: { actorUserId: string; tenantId: string; projectId: string; data: CreatePhysicalUnitInput }): Promise<{ physicalUnitId: string; inventorySlotId: string | null }> {
    return this.db.transaction().execute(async (trx) => {
      const unit = await sql<{ id: string }>`
        INSERT INTO physical_units (tenant_id, project_id, building_id, floor_id, unit_type_id, internal_reference, display_reference, orientation, view_code, corner_position, master_plan_geometry)
        VALUES (${input.tenantId}::uuid,${input.projectId}::uuid,${input.data.buildingId}::uuid,${input.data.floorId}::uuid,${input.data.unitTypeId}::uuid,${input.data.internalReference},${input.data.displayReference ?? null},${input.data.orientation ?? null},${input.data.viewCode ?? null},${input.data.cornerPosition ?? null},${JSON.stringify(input.data.masterPlanGeometry ?? null)}::jsonb)
        RETURNING id
      `.execute(trx);
      const physicalUnitId = unit.rows[0]!.id;
      let inventorySlotId: string | null = null;
      if (input.data.createInventorySlot) {
        const slot = await sql<{ id: string }>`
          INSERT INTO inventory_slots (tenant_id, project_id, unit_type_id, physical_unit_id, internal_reference)
          VALUES (${input.tenantId}::uuid,${input.projectId}::uuid,${input.data.unitTypeId}::uuid,${physicalUnitId}::uuid,${input.data.internalReference})
          RETURNING id
        `.execute(trx);
        inventorySlotId = slot.rows[0]!.id;
      }
      await this.outbox(trx, input.tenantId, input.projectId, 'PHYSICAL_UNIT', physicalUnitId, 'project.physical_unit_created', { actorUserId: input.actorUserId, inventorySlotId });
      return { physicalUnitId, inventorySlotId };
    });
  }

  async createAsset(input: { actorUserId: string; tenantId: string; projectId: string; data: CreateProjectMasterPlanAssetInput }): Promise<string> {
    return this.withOutbox(input, 'PROJECT_ASSET', 'project.master_plan_asset_created', async (trx) => {
      const result = await sql<{ id: string }>`
        INSERT INTO project_master_plan_assets (tenant_id, project_id, phase_id, building_id, asset_type, label, storage_object_key, mime_type, sha256_hex, metadata, created_by)
        VALUES (${input.tenantId}::uuid,${input.projectId}::uuid,${input.data.phaseId ?? null}::uuid,${input.data.buildingId ?? null}::uuid,${input.data.assetType},${input.data.label},${input.data.storageObjectKey},${input.data.mimeType},${input.data.sha256Hex},${JSON.stringify(input.data.metadata)}::jsonb,${input.actorUserId}::uuid)
        RETURNING id
      `.execute(trx);
      return result.rows[0]!.id;
    });
  }

  async createPaymentPlan(input: { actorUserId: string; tenantId: string; projectId: string; data: CreateProjectPaymentPlanInput }): Promise<string> {
    return this.withOutbox(input, 'PAYMENT_PLAN_DEFINITION', 'project.payment_plan_created', async (trx) => {
      const result = await sql<{ id: string }>`
        INSERT INTO project_payment_plan_definitions (tenant_id, project_id, code, name, version_number, definition, effective_at, created_by)
        VALUES (${input.tenantId}::uuid,${input.projectId}::uuid,${input.data.code},${input.data.name},${input.data.versionNumber},${JSON.stringify(input.data.definition)}::jsonb,${input.data.effectiveAt}::timestamptz,${input.actorUserId}::uuid)
        RETURNING id
      `.execute(trx);
      return result.rows[0]!.id;
    });
  }

  async createSalesWindow(input: { actorUserId: string; tenantId: string; projectId: string; data: CreateProjectSalesWindowInput }): Promise<string> {
    return this.withOutbox(input, 'SALES_WINDOW', 'project.sales_window_created', async (trx) => {
      const result = await sql<{ id: string }>`
        INSERT INTO project_sales_windows (tenant_id, project_id, phase_id, label, opens_at, closes_at, channels, created_by)
        VALUES (${input.tenantId}::uuid,${input.projectId}::uuid,${input.data.phaseId ?? null}::uuid,${input.data.label},${input.data.opensAt}::timestamptz,${input.data.closesAt ?? null}::timestamptz,${JSON.stringify(input.data.channels)}::jsonb,${input.actorUserId}::uuid)
        RETURNING id
      `.execute(trx);
      return result.rows[0]!.id;
    });
  }

  async listImportJobs(tenantId: string, projectId: string): Promise<ProjectImportJobSnapshot[]> {
    const result = await sql<JobRow>`
      SELECT id, tenant_id, project_id, import_type, source_format, source_file_name, source_sha256_hex,
             source_object_key, mapping, status, total_rows, valid_rows, invalid_rows, validated_at,
             published_at, created_at, rollback_status, rolled_back_at
      FROM project_import_jobs
      WHERE tenant_id=${tenantId}::uuid AND project_id=${projectId}::uuid
      ORDER BY created_at DESC
    `.execute(this.db);
    return result.rows.map((row) => this.jobSnapshot(row));
  }

  async createImportJob(input: { actorUserId: string; tenantId: string; projectId: string; data: CreateProjectImportJobInput }): Promise<ProjectImportJobSnapshot> {
    const result = await sql<JobRow>`
      INSERT INTO project_import_jobs (tenant_id, project_id, import_type, source_format, source_file_name, source_sha256_hex, source_object_key, mapping, created_by)
      VALUES (${input.tenantId}::uuid,${input.projectId}::uuid,${input.data.importType},${input.data.sourceFormat},${input.data.sourceFileName},${input.data.sourceSha256Hex ?? null},${input.data.sourceObjectKey ?? null},${JSON.stringify(input.data.mapping)}::jsonb,${input.actorUserId}::uuid)
      RETURNING id, tenant_id, project_id, import_type, source_format, source_file_name, source_sha256_hex, source_object_key, mapping, status, total_rows, valid_rows, invalid_rows, validated_at, published_at, created_at, rollback_status, rolled_back_at
    `.execute(this.db);
    return this.jobSnapshot(result.rows[0]!);
  }

  async importJob(tenantId: string, projectId: string, jobId: string): Promise<JobRow | null> {
    const result = await sql<JobRow>`
      SELECT id, tenant_id, project_id, import_type, source_format, source_file_name, source_sha256_hex,
             source_object_key, mapping, status, total_rows, valid_rows, invalid_rows, validated_at,
             published_at, created_at, rollback_status, rolled_back_at
      FROM project_import_jobs
      WHERE id=${jobId}::uuid AND tenant_id=${tenantId}::uuid AND project_id=${projectId}::uuid
    `.execute(this.db);
    return result.rows[0] ?? null;
  }

  async stageRows(input: { tenantId: string; projectId: string; jobId: string; rows: Array<{ rowNumber: number; data: Record<string, unknown> }> }): Promise<void> {
    await this.db.transaction().execute(async (trx) => {
      const locked = await sql<{ status: string }>`SELECT status FROM project_import_jobs WHERE id=${input.jobId}::uuid AND tenant_id=${input.tenantId}::uuid AND project_id=${input.projectId}::uuid FOR UPDATE`.execute(trx);
      if (locked.rows[0]?.status !== 'DRAFT') throw new Error('IMPORT_JOB_NOT_DRAFT');
      for (const row of input.rows) {
        await sql`
          INSERT INTO project_import_rows (import_job_id, row_number, raw_data)
          VALUES (${input.jobId}::uuid,${row.rowNumber},${JSON.stringify(row.data)}::jsonb)
          ON CONFLICT (import_job_id, row_number) DO UPDATE SET raw_data=EXCLUDED.raw_data, normalized_data=NULL, status='PENDING', errors='[]'::jsonb, updated_at=now()
        `.execute(trx);
      }
      await sql`
        UPDATE project_import_jobs j SET
          total_rows=(SELECT count(*) FROM project_import_rows r WHERE r.import_job_id=j.id),
          valid_rows=0, invalid_rows=0, validated_at=NULL, updated_at=now()
        WHERE j.id=${input.jobId}::uuid
      `.execute(trx);
    });
  }

  async updateMapping(input: { tenantId: string; projectId: string; jobId: string; mapping: Record<string, string> }): Promise<void> {
    const result = await sql`
      UPDATE project_import_jobs SET mapping=${JSON.stringify(input.mapping)}::jsonb, valid_rows=0, invalid_rows=0, validated_at=NULL, updated_at=now()
      WHERE id=${input.jobId}::uuid AND tenant_id=${input.tenantId}::uuid AND project_id=${input.projectId}::uuid AND status='DRAFT'
    `.execute(this.db);
    if (Number(result.numAffectedRows) !== 1) throw new Error('IMPORT_JOB_NOT_DRAFT');
    await sql`UPDATE project_import_rows SET normalized_data=NULL, status='PENDING', errors='[]'::jsonb, updated_at=now() WHERE import_job_id=${input.jobId}::uuid`.execute(this.db);
  }

  async rawImportRows(jobId: string): Promise<ImportRow[]> {
    const result = await sql<ImportRow>`SELECT id, row_number, raw_data, normalized_data, status, errors FROM project_import_rows WHERE import_job_id=${jobId}::uuid ORDER BY row_number`.execute(this.db);
    return result.rows;
  }

  async saveValidation(input: { jobId: string; rows: Array<{ rowId: string; normalized: Record<string, unknown> | null; errors: string[] }> }): Promise<void> {
    await this.db.transaction().execute(async (trx) => {
      await sql`UPDATE project_import_jobs SET status='VALIDATING', updated_at=now() WHERE id=${input.jobId}::uuid`.execute(trx);
      let valid = 0;
      let invalid = 0;
      for (const row of input.rows) {
        const status = row.errors.length === 0 ? 'VALID' : 'INVALID';
        if (status === 'VALID') valid += 1; else invalid += 1;
        await sql`UPDATE project_import_rows SET normalized_data=${JSON.stringify(row.normalized)}::jsonb, status=${status}, errors=${JSON.stringify(row.errors)}::jsonb, updated_at=now() WHERE id=${row.rowId}::uuid AND import_job_id=${input.jobId}::uuid`.execute(trx);
      }
      await sql`UPDATE project_import_jobs SET status='VALIDATED', valid_rows=${valid}, invalid_rows=${invalid}, validated_at=now(), updated_at=now() WHERE id=${input.jobId}::uuid`.execute(trx);
    });
  }

  async preview(tenantId: string, projectId: string, jobId: string): Promise<ProjectImportPreviewSnapshot | null> {
    const job = await this.importJob(tenantId, projectId, jobId);
    if (!job) return null;
    const rows = await this.rawImportRows(jobId);
    return {
      job: this.jobSnapshot(job),
      rows: rows.map((row) => ({
        rowNumber: row.row_number,
        rawData: row.raw_data,
        normalizedData: row.normalized_data,
        status: row.status,
        errors: Array.isArray(row.errors) ? row.errors.map(String) : [],
      })),
    };
  }

  async referenceState(tenantId: string, projectId: string): Promise<{
    phases: Set<string>; buildings: Map<string, { id: string; phaseCode: string | null }>;
    floors: Map<string, { id: string; buildingCode: string }>;
    unitTypes: Map<string, string>; physicalUnits: Set<string>; inventoryReferences: Set<string>;
    pricingVersions: Set<string>; paymentPlans: Set<string>;
  }> {
    const [phases, buildings, floors, unitTypes, physicalUnits, inventoryReferences, pricingVersions, paymentPlans] = await Promise.all([
      sql<any>`SELECT code FROM project_phases WHERE tenant_id=${tenantId}::uuid AND project_id=${projectId}::uuid`.execute(this.db),
      sql<any>`SELECT b.id,b.code,p.code AS phase_code FROM project_buildings b LEFT JOIN project_phases p ON p.id=b.phase_id WHERE b.tenant_id=${tenantId}::uuid AND b.project_id=${projectId}::uuid`.execute(this.db),
      sql<any>`SELECT f.id,f.code,b.code AS building_code FROM project_floors f JOIN project_buildings b ON b.id=f.building_id WHERE f.tenant_id=${tenantId}::uuid AND f.project_id=${projectId}::uuid`.execute(this.db),
      sql<any>`SELECT id,code FROM catalog_unit_types WHERE tenant_id=${tenantId}::uuid AND project_id=${projectId}::uuid`.execute(this.db),
      sql<any>`SELECT internal_reference FROM physical_units WHERE tenant_id=${tenantId}::uuid AND project_id=${projectId}::uuid`.execute(this.db),
      sql<any>`SELECT internal_reference FROM inventory_slots WHERE tenant_id=${tenantId}::uuid AND project_id=${projectId}::uuid AND internal_reference IS NOT NULL`.execute(this.db),
      sql<any>`SELECT label FROM pricing_versions WHERE tenant_id=${tenantId}::uuid AND project_id=${projectId}::uuid`.execute(this.db),
      sql<any>`SELECT code || ':' || version_number::text AS key FROM project_payment_plan_definitions WHERE tenant_id=${tenantId}::uuid AND project_id=${projectId}::uuid`.execute(this.db),
    ]);
    return {
      phases: new Set(phases.rows.map((r) => r.code)),
      buildings: new Map(buildings.rows.map((r) => [r.code, { id: r.id, phaseCode: r.phase_code }])),
      floors: new Map(floors.rows.map((r) => [`${r.building_code}:${r.code}`, { id: r.id, buildingCode: r.building_code }])),
      unitTypes: new Map(unitTypes.rows.map((r) => [r.code, r.id])),
      physicalUnits: new Set(physicalUnits.rows.map((r) => r.internal_reference)),
      inventoryReferences: new Set(inventoryReferences.rows.map((r) => r.internal_reference)),
      pricingVersions: new Set(pricingVersions.rows.map((r) => r.label)),
      paymentPlans: new Set(paymentPlans.rows.map((r) => r.key)),
    };
  }

  async publishImport(input: { actorUserId: string; tenantId: string; projectId: string; jobId: string }): Promise<void> {
    await this.db.transaction().execute(async (trx) => {
      const jobResult = await sql<JobRow>`
        SELECT id, tenant_id, project_id, import_type, source_format, source_file_name, source_sha256_hex,
               source_object_key, mapping, status, total_rows, valid_rows, invalid_rows, validated_at,
               published_at, created_at, rollback_status, rolled_back_at
        FROM project_import_jobs
        WHERE id=${input.jobId}::uuid AND tenant_id=${input.tenantId}::uuid AND project_id=${input.projectId}::uuid
        FOR UPDATE
      `.execute(trx);
      const job = jobResult.rows[0];
      if (!job || job.status !== 'VALIDATED' || job.invalid_rows !== 0 || job.valid_rows === 0) throw new Error('IMPORT_JOB_NOT_PUBLISHABLE');
      await sql`UPDATE project_import_jobs SET status='PUBLISHING', updated_at=now() WHERE id=${job.id}::uuid`.execute(trx);
      const rowResult = await sql<{ id: string; row_number: number; normalized_data: Record<string, unknown> }>`SELECT id,row_number,normalized_data FROM project_import_rows WHERE import_job_id=${job.id}::uuid AND status='VALID' ORDER BY row_number FOR UPDATE`.execute(trx);
      let order = 0;
      const record = async (entityType: string, entityId: string): Promise<void> => {
        order += 1;
        await sql`INSERT INTO project_import_published_entities (import_job_id,publication_order,entity_type,entity_id) VALUES (${job.id}::uuid,${order},${entityType},${entityId}::uuid) ON CONFLICT (import_job_id,entity_type,entity_id) DO NOTHING`.execute(trx);
      };

      if (job.import_type === 'HIERARCHY') {
        for (const row of rowResult.rows) await this.publishHierarchyRow(trx, job, row.normalized_data, record);
      } else if (job.import_type === 'UNIT_TYPES') {
        for (const row of rowResult.rows) {
          const data = row.normalized_data as any;
          const created = await sql<{ id: string }>`INSERT INTO catalog_unit_types (tenant_id,project_id,code,name,description,bedroom_count,indoor_area_sqm,roof_area_sqm,garden_area_sqm,sort_order) VALUES (${job.tenant_id}::uuid,${job.project_id}::uuid,${data.code},${data.name},${data.description ?? null},${data.bedroomCount ?? null},${data.indoorAreaSqm},${data.roofAreaSqm},${data.gardenAreaSqm},${data.sortOrder ?? 0}) RETURNING id`.execute(trx);
          await record('UNIT_TYPE', created.rows[0]!.id);
        }
      } else if (job.import_type === 'PHYSICAL_UNITS') {
        for (const row of rowResult.rows) await this.publishPhysicalUnitRow(trx, job, row.normalized_data, record);
      } else if (job.import_type === 'PRICING') {
        await this.publishPricingRows(trx, job, rowResult.rows.map((r) => r.normalized_data), input.actorUserId, record);
      } else if (job.import_type === 'PAYMENT_PLANS') {
        for (const row of rowResult.rows) {
          const data = row.normalized_data as any;
          const created = await sql<{ id: string }>`INSERT INTO project_payment_plan_definitions (tenant_id,project_id,code,name,version_number,definition,effective_at,created_by) VALUES (${job.tenant_id}::uuid,${job.project_id}::uuid,${data.code},${data.name},${data.versionNumber},${JSON.stringify(data.definition)}::jsonb,${data.effectiveAt}::timestamptz,${input.actorUserId}::uuid) RETURNING id`.execute(trx);
          await record('PAYMENT_PLAN', created.rows[0]!.id);
        }
      }

      await sql`UPDATE project_import_rows SET status='PUBLISHED', updated_at=now() WHERE import_job_id=${job.id}::uuid AND status='VALID'`.execute(trx);
      await sql`UPDATE project_import_jobs SET status='PUBLISHED', published_at=now(), updated_at=now() WHERE id=${job.id}::uuid`.execute(trx);
      await this.outbox(trx, input.tenantId, input.projectId, 'PROJECT_IMPORT', job.id, 'project.import_published', { actorUserId: input.actorUserId, importType: job.import_type, publishedEntities: order });
    });
  }

  async rollbackImport(input: { actorUserId: string; tenantId: string; projectId: string; jobId: string }): Promise<void> {
    await this.db.transaction().execute(async (trx) => {
      const job = await sql<JobRow>`SELECT id, tenant_id, project_id, import_type, source_format, source_file_name, source_sha256_hex, source_object_key, mapping, status, total_rows, valid_rows, invalid_rows, validated_at, published_at, created_at, rollback_status, rolled_back_at FROM project_import_jobs WHERE id=${input.jobId}::uuid AND tenant_id=${input.tenantId}::uuid AND project_id=${input.projectId}::uuid FOR UPDATE`.execute(trx);
      const current = job.rows[0];
      if (!current || current.status !== 'PUBLISHED' || current.rollback_status !== 'NONE') throw new Error('IMPORT_JOB_NOT_ROLLBACKABLE');
      const entities = await sql<{ entity_type: string; entity_id: string }>`SELECT entity_type,entity_id FROM project_import_published_entities WHERE import_job_id=${input.jobId}::uuid ORDER BY publication_order DESC FOR UPDATE`.execute(trx);
      for (const entity of entities.rows) await this.deletePublishedEntity(trx, entity.entity_type, entity.entity_id);
      await sql`UPDATE project_import_jobs SET rollback_status='ROLLED_BACK', rolled_back_at=now(), rolled_back_by=${input.actorUserId}::uuid, updated_at=now() WHERE id=${input.jobId}::uuid`.execute(trx);
      await this.outbox(trx, input.tenantId, input.projectId, 'PROJECT_IMPORT', input.jobId, 'project.import_rolled_back', { actorUserId: input.actorUserId, importType: current.import_type });
    });
  }

  private async publishHierarchyRow(trx: Trx, job: JobRow, data: Record<string, unknown>, record: (type: string, id: string) => Promise<void>): Promise<void> {
    const d = data as any;
    let phaseId: string | null = null;
    if (d.phaseCode) {
      const existing = await sql<{ id: string }>`SELECT id FROM project_phases WHERE project_id=${job.project_id}::uuid AND code=${d.phaseCode}`.execute(trx);
      if (existing.rows[0]) phaseId = existing.rows[0].id;
      else {
        const inserted = await sql<{ id: string }>`INSERT INTO project_phases (tenant_id,project_id,code,name,sort_order) VALUES (${job.tenant_id}::uuid,${job.project_id}::uuid,${d.phaseCode},${d.phaseName},${d.phaseSortOrder ?? 0}) RETURNING id`.execute(trx);
        phaseId = inserted.rows[0]!.id; await record('PHASE', phaseId);
      }
    }
    let buildingId: string | null = null;
    if (d.buildingCode) {
      const existing = await sql<{ id: string }>`SELECT id FROM project_buildings WHERE project_id=${job.project_id}::uuid AND code=${d.buildingCode}`.execute(trx);
      if (existing.rows[0]) buildingId = existing.rows[0].id;
      else {
        const inserted = await sql<{ id: string }>`INSERT INTO project_buildings (tenant_id,project_id,phase_id,code,name,cluster_name,sort_order) VALUES (${job.tenant_id}::uuid,${job.project_id}::uuid,${phaseId}::uuid,${d.buildingCode},${d.buildingName},${d.clusterName ?? null},${d.buildingSortOrder ?? 0}) RETURNING id`.execute(trx);
        buildingId = inserted.rows[0]!.id; await record('BUILDING', buildingId);
      }
    }
    if (d.floorCode && buildingId) {
      const existing = await sql<{ id: string }>`SELECT id FROM project_floors WHERE building_id=${buildingId}::uuid AND code=${d.floorCode}`.execute(trx);
      if (!existing.rows[0]) {
        const inserted = await sql<{ id: string }>`INSERT INTO project_floors (tenant_id,project_id,building_id,code,name,level_number,sort_order) VALUES (${job.tenant_id}::uuid,${job.project_id}::uuid,${buildingId}::uuid,${d.floorCode},${d.floorName},${d.levelNumber ?? null},${d.floorSortOrder ?? 0}) RETURNING id`.execute(trx);
        await record('FLOOR', inserted.rows[0]!.id);
      }
    }
  }

  private async publishPhysicalUnitRow(trx: Trx, job: JobRow, data: Record<string, unknown>, record: (type: string, id: string) => Promise<void>): Promise<void> {
    const d = data as any;
    const refs = await sql<{ building_id: string; floor_id: string; unit_type_id: string }>`
      SELECT b.id AS building_id,f.id AS floor_id,t.id AS unit_type_id
      FROM project_buildings b
      JOIN project_floors f ON f.building_id=b.id AND f.code=${d.floorCode}
      JOIN catalog_unit_types t ON t.project_id=b.project_id AND t.code=${d.unitTypeCode}
      WHERE b.tenant_id=${job.tenant_id}::uuid AND b.project_id=${job.project_id}::uuid AND b.code=${d.buildingCode}
    `.execute(trx);
    const ref = refs.rows[0]; if (!ref) throw new Error('IMPORT_REFERENCE_CHANGED');
    const unit = await sql<{ id: string }>`INSERT INTO physical_units (tenant_id,project_id,building_id,floor_id,unit_type_id,internal_reference,display_reference,orientation,view_code,corner_position) VALUES (${job.tenant_id}::uuid,${job.project_id}::uuid,${ref.building_id}::uuid,${ref.floor_id}::uuid,${ref.unit_type_id}::uuid,${d.internalReference},${d.displayReference ?? null},${d.orientation ?? null},${d.viewCode ?? null},${d.cornerPosition ?? null}) RETURNING id`.execute(trx);
    await record('PHYSICAL_UNIT', unit.rows[0]!.id);
    const slot = await sql<{ id: string }>`INSERT INTO inventory_slots (tenant_id,project_id,unit_type_id,physical_unit_id,internal_reference) VALUES (${job.tenant_id}::uuid,${job.project_id}::uuid,${ref.unit_type_id}::uuid,${unit.rows[0]!.id}::uuid,${d.internalReference}) RETURNING id`.execute(trx);
    await record('INVENTORY_SLOT', slot.rows[0]!.id);
  }

  private async publishPricingRows(trx: Trx, job: JobRow, rows: Record<string, unknown>[], actorUserId: string, record: (type: string, id: string) => Promise<void>): Promise<void> {
    const first = rows[0] as any;
    const version = await sql<{ id: string }>`
      INSERT INTO pricing_versions (tenant_id,project_id,version_number,label,effective_at,created_by)
      VALUES (${job.tenant_id}::uuid,${job.project_id}::uuid,(SELECT COALESCE(max(version_number),0)+1 FROM pricing_versions WHERE project_id=${job.project_id}::uuid),${first.pricingLabel},${first.effectiveAt}::timestamptz,${actorUserId}::uuid)
      RETURNING id
    `.execute(trx);
    await record('PRICING_VERSION', version.rows[0]!.id);
    for (const raw of rows) {
      const d = raw as any;
      const type = await sql<{ id: string }>`SELECT id FROM catalog_unit_types WHERE project_id=${job.project_id}::uuid AND code=${d.unitTypeCode}`.execute(trx);
      if (!type.rows[0]) throw new Error('IMPORT_REFERENCE_CHANGED');
      const rate = await sql<{ id: string }>`INSERT INTO pricing_rates (tenant_id,project_id,pricing_version_id,unit_type_id,component,rate_per_sqm) VALUES (${job.tenant_id}::uuid,${job.project_id}::uuid,${version.rows[0]!.id}::uuid,${type.rows[0].id}::uuid,${d.component},${d.ratePerSqm}) RETURNING id`.execute(trx);
      await record('PRICING_RATE', rate.rows[0]!.id);
    }
  }

  private async deletePublishedEntity(trx: Trx, type: string, id: string): Promise<void> {
    let result: { numAffectedRows?: bigint };
    if (type === 'INVENTORY_SLOT') result = await sql`DELETE FROM inventory_slots WHERE id=${id}::uuid AND state='AVAILABLE'`.execute(trx);
    else if (type === 'PHYSICAL_UNIT') result = await sql`DELETE FROM physical_units WHERE id=${id}::uuid`.execute(trx);
    else if (type === 'FLOOR') result = await sql`DELETE FROM project_floors WHERE id=${id}::uuid`.execute(trx);
    else if (type === 'BUILDING') result = await sql`DELETE FROM project_buildings WHERE id=${id}::uuid`.execute(trx);
    else if (type === 'PHASE') result = await sql`DELETE FROM project_phases WHERE id=${id}::uuid`.execute(trx);
    else if (type === 'UNIT_TYPE') result = await sql`DELETE FROM catalog_unit_types WHERE id=${id}::uuid`.execute(trx);
    else if (type === 'PRICING_RATE') result = await sql`DELETE FROM pricing_rates WHERE id=${id}::uuid`.execute(trx);
    else if (type === 'PRICING_VERSION') result = await sql`DELETE FROM pricing_versions WHERE id=${id}::uuid AND status='DRAFT'`.execute(trx);
    else if (type === 'PAYMENT_PLAN') result = await sql`DELETE FROM project_payment_plan_definitions WHERE id=${id}::uuid AND status='DRAFT'`.execute(trx);
    else throw new Error('IMPORT_ROLLBACK_ENTITY_UNKNOWN');
    if (Number(result.numAffectedRows ?? 0n) !== 1) throw new Error(`IMPORT_ROLLBACK_BLOCKED_${type}`);
  }

  private jobSnapshot(row: JobRow): ProjectImportJobSnapshot {
    return {
      id: row.id, tenantId: row.tenant_id, projectId: row.project_id, importType: row.import_type,
      sourceFormat: row.source_format, sourceFileName: row.source_file_name, sourceSha256Hex: row.source_sha256_hex,
      sourceObjectKey: row.source_object_key, mapping: row.mapping, status: row.status,
      totalRows: Number(row.total_rows), validRows: Number(row.valid_rows), invalidRows: Number(row.invalid_rows),
      validatedAt: row.validated_at?.toISOString() ?? null, publishedAt: row.published_at?.toISOString() ?? null,
      createdAt: row.created_at.toISOString(),
    };
  }

  private async withOutbox<T>(input: { actorUserId: string; tenantId: string; projectId: string }, aggregateType: string, eventType: string, action: (trx: Trx) => Promise<T>): Promise<T> {
    return this.db.transaction().execute(async (trx) => {
      const result = await action(trx);
      const aggregateId = typeof result === 'string' ? result : input.projectId;
      await this.outbox(trx, input.tenantId, input.projectId, aggregateType, aggregateId, eventType, { actorUserId: input.actorUserId });
      return result;
    });
  }

  private async outbox(trx: Trx, tenantId: string, projectId: string, aggregateType: string, aggregateId: string, eventType: string, payload: Record<string, unknown>): Promise<void> {
    await trx.insertInto('domain_outbox_events').values({ tenant_id: tenantId, project_id: projectId, aggregate_type: aggregateType, aggregate_id: aggregateId, event_type: eventType, payload, attempts: 0 }).execute();
  }
}
