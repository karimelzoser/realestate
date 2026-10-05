import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { ProjectMasterPlanAssetType } from '@preneura/contracts/project-catalog';
import { AccessService } from '../access/access.service.js';
import { ObjectStorageService, type UploadIntent } from '../storage/object-storage.service.js';
import { ProjectCatalogRepository } from './project-catalog.repository.js';

export interface ProjectAssetUploadRequest {
  assetType: ProjectMasterPlanAssetType;
  label: string;
  phaseId: string | null;
  buildingId: string | null;
  contentType: string;
  byteSize: number;
  sha256Base64: string;
  metadata: Record<string, unknown>;
}

export interface ProjectAssetFinalizeRequest extends ProjectAssetUploadRequest {
  objectKey: string;
}

const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MODEL_TYPES = new Set(['model/gltf+json', 'model/gltf-binary']);
const FLOOR_PLAN_TYPES = new Set([...IMAGE_TYPES, 'application/pdf']);
const OTHER_TYPES = new Set([...IMAGE_TYPES, ...MODEL_TYPES, 'application/pdf']);

@Injectable()
export class ProjectAssetUploadService {
  constructor(
    private readonly access: AccessService,
    private readonly storage: ObjectStorageService,
    private readonly catalog: ProjectCatalogRepository,
  ) {}

  async createIntent(input: {
    actorUserId: string;
    tenantId: string;
    projectId: string;
    data: ProjectAssetUploadRequest;
  }): Promise<UploadIntent> {
    await this.authorize(input);
    this.validateUpload(input.data);
    const objectKey = this.storage.projectAssetObjectKey({
      tenantId: input.tenantId,
      projectId: input.projectId,
      assetType: input.data.assetType,
    });
    return this.storage.createUploadIntent({
      objectKey,
      contentType: input.data.contentType,
      byteSize: input.data.byteSize,
      sha256Base64: input.data.sha256Base64,
      expiresInSeconds: 600,
    });
  }

  async finalize(input: {
    actorUserId: string;
    tenantId: string;
    projectId: string;
    data: ProjectAssetFinalizeRequest;
  }): Promise<{ id: string }> {
    await this.authorize(input);
    this.validateUpload(input.data);
    const prefix = `tenants/${input.tenantId}/projects/${input.projectId}/master-plan-assets`;
    if (!this.storage.ensurePrefix(input.data.objectKey, prefix)) {
      throw new BadRequestException('Uploaded object does not belong to this project asset namespace.');
    }
    const verified = await this.storage.verifyObject({
      objectKey: input.data.objectKey,
      expectedContentType: input.data.contentType,
      expectedByteSize: input.data.byteSize,
      expectedSha256Base64: input.data.sha256Base64,
    });
    if (!verified) throw new BadRequestException('Uploaded asset could not be verified against its declared size, content type and SHA-256 checksum.');

    return {
      id: await this.catalog.createAsset({
        actorUserId: input.actorUserId,
        tenantId: input.tenantId,
        projectId: input.projectId,
        data: {
          phaseId: input.data.phaseId,
          buildingId: input.data.buildingId,
          assetType: input.data.assetType,
          label: input.data.label,
          storageObjectKey: verified.objectKey,
          mimeType: verified.contentType,
          sha256Hex: verified.sha256Hex,
          metadata: input.data.metadata,
        },
      }),
    };
  }

  private async authorize(input: { actorUserId: string; tenantId: string; projectId: string }): Promise<void> {
    if (!(await this.catalog.projectExists(input.tenantId, input.projectId))) throw new NotFoundException('Project not found.');
    await this.access.assert({
      userId: input.actorUserId,
      permission: 'project.manage',
      context: { tenantId: input.tenantId, projectId: input.projectId },
    });
  }

  private validateUpload(data: ProjectAssetUploadRequest): void {
    if (!data.label.trim() || data.label.trim().length > 200) {
      throw new BadRequestException('Asset label is required and must be 200 characters or fewer.');
    }
    if (!Number.isInteger(data.byteSize) || data.byteSize <= 0 || data.byteSize > 100 * 1024 * 1024) {
      throw new BadRequestException('Master-plan assets must be between 1 byte and 100 MB.');
    }

    let metadataBytes: number;
    try {
      metadataBytes = Buffer.byteLength(JSON.stringify(data.metadata), 'utf8');
    } catch {
      throw new BadRequestException('Asset metadata must be valid JSON.');
    }
    if (metadataBytes > 8 * 1024) throw new BadRequestException('Asset metadata must be 8 KB or smaller.');

    const contentType = data.contentType.toLowerCase();
    const allowed = this.allowedContentTypes(data.assetType);
    if (!allowed.has(contentType)) {
      throw new BadRequestException(`Unsupported content type for ${data.assetType}.`);
    }

    let digest: Buffer;
    try {
      digest = Buffer.from(data.sha256Base64, 'base64');
    } catch {
      throw new BadRequestException('Invalid SHA-256 checksum.');
    }
    if (digest.length !== 32) throw new BadRequestException('SHA-256 checksum must decode to exactly 32 bytes.');
  }

  private allowedContentTypes(assetType: ProjectMasterPlanAssetType): ReadonlySet<string> {
    switch (assetType) {
      case 'MASTER_PLAN_IMAGE':
        return IMAGE_TYPES;
      case 'MASTER_PLAN_3D':
      case 'BUILDING_MODEL':
      case 'UNIT_MODEL':
        return MODEL_TYPES;
      case 'FLOOR_PLAN':
        return FLOOR_PLAN_TYPES;
      case 'OTHER':
        return OTHER_TYPES;
    }
  }
}
