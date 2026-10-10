import { Injectable, NotFoundException } from '@nestjs/common';
import type { TransactionOperationQueueSnapshot } from '@preneura/contracts/transaction-operations';
import { AccessService } from '../access/access.service.js';
import { TransactionOperationsRepository } from './transaction-operations.repository.js';

@Injectable()
export class TransactionOperationsService {
  constructor(
    private readonly repository: TransactionOperationsRepository,
    private readonly access: AccessService,
  ) {}

  async queue(input: {
    actorUserId: string;
    tenantId: string;
    projectId: string;
  }): Promise<TransactionOperationQueueSnapshot> {
    if (!(await this.repository.projectExists(input.tenantId, input.projectId))) {
      throw new NotFoundException('Project not found.');
    }

    await this.access.assert({
      userId: input.actorUserId,
      permission: 'transaction.manage',
      context: { tenantId: input.tenantId, projectId: input.projectId },
    });

    return this.repository.queue({
      tenantId: input.tenantId,
      projectId: input.projectId,
      now: new Date(),
    });
  }
}
