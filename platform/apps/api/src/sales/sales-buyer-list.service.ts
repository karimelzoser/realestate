import { Injectable, NotFoundException } from '@nestjs/common';
import type { ProjectBuyerSnapshot } from '@preneura/contracts/sales';
import { AccessService } from '../access/access.service.js';
import { SalesBuyerListRepository } from './sales-buyer-list.repository.js';

@Injectable()
export class SalesBuyerListService {
  constructor(
    private readonly repository: SalesBuyerListRepository,
    private readonly access: AccessService,
  ) {}

  async list(input: {
    actorUserId: string;
    tenantId: string;
    projectId: string;
  }): Promise<ProjectBuyerSnapshot[]> {
    const project = await this.access.can({
      userId: input.actorUserId,
      permission: 'buyers.read',
      context: { tenantId: input.tenantId, projectId: input.projectId },
    });
    if (!project.allowed) {
      throw new NotFoundException('Project buyers are not available.');
    }
    return this.repository.list({ tenantId: input.tenantId, projectId: input.projectId });
  }
}
