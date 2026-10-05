import { Injectable } from '@nestjs/common';
import type { DocumentTemplateSnapshot } from '@preneura/contracts/documents';
import { AccessService } from '../access/access.service.js';
import { DocumentTemplateListRepository } from './document-template-list.repository.js';

@Injectable()
export class DocumentTemplateListService {
  constructor(
    private readonly repository: DocumentTemplateListRepository,
    private readonly access: AccessService,
  ) {}

  async list(input: {
    actorUserId: string;
    tenantId: string;
    projectId: string;
  }): Promise<DocumentTemplateSnapshot[]> {
    await this.access.assert({
      userId: input.actorUserId,
      permission: 'documents.templates.manage',
      context: { tenantId: input.tenantId, projectId: input.projectId },
    });
    return this.repository.list(input);
  }
}
