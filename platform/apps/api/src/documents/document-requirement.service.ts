import { Injectable, NotFoundException } from '@nestjs/common';
import type {
  DocumentCategory,
  ProjectDocumentRequirementSnapshot,
  UpsertProjectDocumentRequirementInput,
} from '@preneura/contracts/documents';
import { AccessService } from '../access/access.service.js';
import { DocumentRequirementRepository } from './document-requirement.repository.js';

@Injectable()
export class DocumentRequirementService {
  constructor(
    private readonly repository: DocumentRequirementRepository,
    private readonly access: AccessService,
  ) {}

  async list(input: {
    actorUserId: string;
    tenantId: string;
    projectId: string;
  }): Promise<ProjectDocumentRequirementSnapshot[]> {
    const read = await this.access.can({
      userId: input.actorUserId,
      permission: 'documents.read',
      context: { tenantId: input.tenantId, projectId: input.projectId },
    });
    if (!read.allowed) {
      await this.access.assert({
        userId: input.actorUserId,
        permission: 'documents.templates.manage',
        context: { tenantId: input.tenantId, projectId: input.projectId },
      });
    }
    return this.repository.list(input);
  }

  async upsert(input: {
    actorUserId: string;
    data: UpsertProjectDocumentRequirementInput;
  }): Promise<ProjectDocumentRequirementSnapshot> {
    await this.access.assert({
      userId: input.actorUserId,
      permission: 'documents.templates.manage',
      context: { tenantId: input.data.tenantId, projectId: input.data.projectId },
    });
    return this.repository.upsert({
      actorUserId: input.actorUserId,
      data: input.data,
      now: new Date(),
    });
  }

  async remove(input: {
    actorUserId: string;
    tenantId: string;
    projectId: string;
    category: DocumentCategory;
  }): Promise<{ removed: true }> {
    await this.access.assert({
      userId: input.actorUserId,
      permission: 'documents.templates.manage',
      context: { tenantId: input.tenantId, projectId: input.projectId },
    });
    const removed = await this.repository.remove(input);
    if (!removed) throw new NotFoundException('Document requirement not found.');
    return { removed: true };
  }
}
