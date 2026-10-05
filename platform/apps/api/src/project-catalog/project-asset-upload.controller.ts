import { BadRequestException, Body, Controller, Param, Post, UseGuards } from '@nestjs/common';
import { projectMasterPlanAssetTypeSchema } from '@preneura/contracts/project-catalog';
import type { ResolvedSession } from '../auth/auth.repository.js';
import { CurrentSession, SessionAuthGuard } from '../auth/session-auth.guard.js';
import {
  ProjectAssetUploadService,
  type ProjectAssetFinalizeRequest,
  type ProjectAssetUploadRequest,
} from './project-asset-upload.service.js';

@UseGuards(SessionAuthGuard)
@Controller('tenants/:tenantId/projects/:projectId/project-catalog/assets')
export class ProjectAssetUploadController {
  constructor(private readonly uploads: ProjectAssetUploadService) {}

  @Post('upload-intent')
  createIntent(
    @Param('tenantId') tenantId: string,
    @Param('projectId') projectId: string,
    @Body() body: unknown,
    @CurrentSession() session: ResolvedSession,
  ) {
    this.ids(tenantId, projectId);
    return this.uploads.createIntent({
      actorUserId: session.userId,
      tenantId,
      projectId,
      data: this.parse(body, false),
    });
  }

  @Post('finalize')
  finalize(
    @Param('tenantId') tenantId: string,
    @Param('projectId') projectId: string,
    @Body() body: unknown,
    @CurrentSession() session: ResolvedSession,
  ) {
    this.ids(tenantId, projectId);
    return this.uploads.finalize({
      actorUserId: session.userId,
      tenantId,
      projectId,
      data: this.parse(body, true) as ProjectAssetFinalizeRequest,
    });
  }

  private parse(body: unknown, requireObjectKey: boolean): ProjectAssetUploadRequest | ProjectAssetFinalizeRequest {
    if (body == null || typeof body !== 'object' || Array.isArray(body)) throw new BadRequestException('Invalid asset upload payload.');
    const value = body as Record<string, unknown>;
    const type = projectMasterPlanAssetTypeSchema.safeParse(value.assetType);
    if (!type.success) throw new BadRequestException('Invalid master-plan asset type.');
    const label = typeof value.label === 'string' ? value.label.trim() : '';
    const contentType = typeof value.contentType === 'string' ? value.contentType.trim() : '';
    const sha256Base64 = typeof value.sha256Base64 === 'string' ? value.sha256Base64.trim() : '';
    const byteSize = typeof value.byteSize === 'number' ? value.byteSize : Number(value.byteSize);
    const phaseId = value.phaseId == null || value.phaseId === '' ? null : String(value.phaseId);
    const buildingId = value.buildingId == null || value.buildingId === '' ? null : String(value.buildingId);
    if (phaseId) this.ids(phaseId);
    if (buildingId) this.ids(buildingId);
    const metadata = value.metadata && typeof value.metadata === 'object' && !Array.isArray(value.metadata)
      ? value.metadata as Record<string, unknown>
      : {};
    const base: ProjectAssetUploadRequest = {
      assetType: type.data,
      label,
      phaseId,
      buildingId,
      contentType,
      byteSize,
      sha256Base64,
      metadata,
    };
    if (!requireObjectKey) return base;
    const objectKey = typeof value.objectKey === 'string' ? value.objectKey.trim() : '';
    if (!objectKey) throw new BadRequestException('objectKey is required to finalize an upload.');
    return { ...base, objectKey };
  }

  private ids(...values: string[]): void {
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (values.some((value) => !uuid.test(value))) throw new BadRequestException('Invalid identifier.');
  }
}
