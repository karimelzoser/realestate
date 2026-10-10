import { Injectable, NotFoundException } from '@nestjs/common';
import type { ManagementProjectOverviewSnapshot } from '@preneura/contracts/management';
import { AccessService } from '../access/access.service.js';
import { TransactionOperationsService } from '../sales/transaction-operations.service.js';
import { ManagementRepository } from './management.repository.js';

@Injectable()
export class ManagementService {
  constructor(
    private readonly repository: ManagementRepository,
    private readonly access: AccessService,
    private readonly transactionOperations: TransactionOperationsService,
  ) {}

  async overview(input: {
    actorUserId: string;
    tenantId: string;
    projectId: string;
  }): Promise<ManagementProjectOverviewSnapshot> {
    if (!(await this.repository.projectExists(input.tenantId, input.projectId))) {
      throw new NotFoundException('Project not found.');
    }

    await this.access.assert({
      userId: input.actorUserId,
      permission: 'project.manage',
      context: { tenantId: input.tenantId, projectId: input.projectId },
    });

    const now = new Date();
    const [core, completion] = await Promise.all([
      this.repository.overview({ tenantId: input.tenantId, projectId: input.projectId, now }),
      this.transactionOperations.queue({
        actorUserId: input.actorUserId,
        tenantId: input.tenantId,
        projectId: input.projectId,
      }),
    ]);

    return {
      generatedAt: now.toISOString(),
      ...core,
      completionBacklog: completion.counts,
    };
  }
}
