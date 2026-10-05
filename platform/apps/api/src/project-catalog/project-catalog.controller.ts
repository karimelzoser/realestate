import { BadRequestException, Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import {
  createPhysicalUnitSchema,
  createProjectBuildingSchema,
  createProjectFloorSchema,
  createProjectImportJobSchema,
  createProjectMasterPlanAssetSchema,
  createProjectPaymentPlanSchema,
  createProjectPhaseSchema,
  createProjectSalesWindowSchema,
  stageProjectImportRowsSchema,
  updateProjectImportMappingSchema,
} from '@preneura/contracts/project-catalog';
import type { ResolvedSession } from '../auth/auth.repository.js';
import { CurrentSession, SessionAuthGuard } from '../auth/session-auth.guard.js';
import { ProjectCatalogService } from './project-catalog.service.js';

@UseGuards(SessionAuthGuard)
@Controller('tenants/:tenantId/projects/:projectId/project-catalog')
export class ProjectCatalogController {
  constructor(private readonly service: ProjectCatalogService) {}

  @Get()
  hierarchy(@Param('tenantId') tenantId: string, @Param('projectId') projectId: string, @CurrentSession() session: ResolvedSession) {
    this.ids(tenantId, projectId);
    return this.service.hierarchy({ actorUserId: session.userId, tenantId, projectId });
  }

  @Post('phases')
  createPhase(@Param('tenantId') tenantId: string, @Param('projectId') projectId: string, @Body() body: unknown, @CurrentSession() session: ResolvedSession) {
    return this.parseAndRun(createProjectPhaseSchema, body, (data) => this.service.createPhase({ actorUserId: session.userId, tenantId, projectId, data }), tenantId, projectId);
  }

  @Post('buildings')
  createBuilding(@Param('tenantId') tenantId: string, @Param('projectId') projectId: string, @Body() body: unknown, @CurrentSession() session: ResolvedSession) {
    return this.parseAndRun(createProjectBuildingSchema, body, (data) => this.service.createBuilding({ actorUserId: session.userId, tenantId, projectId, data }), tenantId, projectId);
  }

  @Post('floors')
  createFloor(@Param('tenantId') tenantId: string, @Param('projectId') projectId: string, @Body() body: unknown, @CurrentSession() session: ResolvedSession) {
    return this.parseAndRun(createProjectFloorSchema, body, (data) => this.service.createFloor({ actorUserId: session.userId, tenantId, projectId, data }), tenantId, projectId);
  }

  @Post('physical-units')
  createPhysicalUnit(@Param('tenantId') tenantId: string, @Param('projectId') projectId: string, @Body() body: unknown, @CurrentSession() session: ResolvedSession) {
    return this.parseAndRun(createPhysicalUnitSchema, body, (data) => this.service.createPhysicalUnit({ actorUserId: session.userId, tenantId, projectId, data }), tenantId, projectId);
  }

  @Post('assets')
  createAsset(@Param('tenantId') tenantId: string, @Param('projectId') projectId: string, @Body() body: unknown, @CurrentSession() session: ResolvedSession) {
    return this.parseAndRun(createProjectMasterPlanAssetSchema, body, (data) => this.service.createAsset({ actorUserId: session.userId, tenantId, projectId, data }), tenantId, projectId);
  }

  @Post('payment-plans')
  createPaymentPlan(@Param('tenantId') tenantId: string, @Param('projectId') projectId: string, @Body() body: unknown, @CurrentSession() session: ResolvedSession) {
    return this.parseAndRun(createProjectPaymentPlanSchema, body, (data) => this.service.createPaymentPlan({ actorUserId: session.userId, tenantId, projectId, data }), tenantId, projectId);
  }

  @Post('sales-windows')
  createSalesWindow(@Param('tenantId') tenantId: string, @Param('projectId') projectId: string, @Body() body: unknown, @CurrentSession() session: ResolvedSession) {
    return this.parseAndRun(createProjectSalesWindowSchema, body, (data) => this.service.createSalesWindow({ actorUserId: session.userId, tenantId, projectId, data }), tenantId, projectId);
  }

  @Get('imports')
  imports(@Param('tenantId') tenantId: string, @Param('projectId') projectId: string, @CurrentSession() session: ResolvedSession) {
    this.ids(tenantId, projectId);
    return this.service.listImports({ actorUserId: session.userId, tenantId, projectId });
  }

  @Post('imports')
  createImport(@Param('tenantId') tenantId: string, @Param('projectId') projectId: string, @Body() body: unknown, @CurrentSession() session: ResolvedSession) {
    return this.parseAndRun(createProjectImportJobSchema, body, (data) => this.service.createImport({ actorUserId: session.userId, tenantId, projectId, data }), tenantId, projectId);
  }

  @Post('imports/:jobId/rows')
  stageRows(@Param('tenantId') tenantId: string, @Param('projectId') projectId: string, @Param('jobId') jobId: string, @Body() body: unknown, @CurrentSession() session: ResolvedSession) {
    this.ids(tenantId, projectId, jobId);
    const parsed = stageProjectImportRowsSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Invalid staged import rows.');
    return this.service.stageImportRows({ actorUserId: session.userId, tenantId, projectId, jobId, data: parsed.data });
  }

  @Patch('imports/:jobId/mapping')
  mapping(@Param('tenantId') tenantId: string, @Param('projectId') projectId: string, @Param('jobId') jobId: string, @Body() body: unknown, @CurrentSession() session: ResolvedSession) {
    this.ids(tenantId, projectId, jobId);
    const parsed = updateProjectImportMappingSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Invalid import mapping.');
    return this.service.updateImportMapping({ actorUserId: session.userId, tenantId, projectId, jobId, data: parsed.data });
  }

  @Post('imports/:jobId/validate')
  validate(@Param('tenantId') tenantId: string, @Param('projectId') projectId: string, @Param('jobId') jobId: string, @CurrentSession() session: ResolvedSession) {
    this.ids(tenantId, projectId, jobId);
    return this.service.validateImport({ actorUserId: session.userId, tenantId, projectId, jobId });
  }

  @Get('imports/:jobId')
  preview(@Param('tenantId') tenantId: string, @Param('projectId') projectId: string, @Param('jobId') jobId: string, @CurrentSession() session: ResolvedSession) {
    this.ids(tenantId, projectId, jobId);
    return this.service.importPreview({ actorUserId: session.userId, tenantId, projectId, jobId });
  }

  @Post('imports/:jobId/publish')
  publish(@Param('tenantId') tenantId: string, @Param('projectId') projectId: string, @Param('jobId') jobId: string, @CurrentSession() session: ResolvedSession) {
    this.ids(tenantId, projectId, jobId);
    return this.service.publishImport({ actorUserId: session.userId, tenantId, projectId, jobId });
  }

  @Post('imports/:jobId/rollback')
  rollback(@Param('tenantId') tenantId: string, @Param('projectId') projectId: string, @Param('jobId') jobId: string, @CurrentSession() session: ResolvedSession) {
    this.ids(tenantId, projectId, jobId);
    return this.service.rollbackImport({ actorUserId: session.userId, tenantId, projectId, jobId });
  }

  private parseAndRun<T, R>(schema: { safeParse(value: unknown): { success: true; data: T } | { success: false } }, body: unknown, run: (data: T) => R, tenantId: string, projectId: string): R {
    this.ids(tenantId, projectId);
    const parsed = schema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Invalid project catalog payload.');
    return run(parsed.data);
  }

  private ids(...values: string[]): void {
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (values.some((value) => !uuid.test(value))) throw new BadRequestException('Invalid identifier.');
  }
}
