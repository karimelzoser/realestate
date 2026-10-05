import { Injectable, NotFoundException } from '@nestjs/common';
import type { ContractExecutionSnapshot } from '@preneura/contracts/contract-execution';
import { AccessService } from '../access/access.service.js';
import { ContractExecutionRepository } from './contract-execution.repository.js';
import { DocumentRepository } from './document.repository.js';

@Injectable()
export class ContractExecutionService {
  constructor(
    private readonly repository: ContractExecutionRepository,
    private readonly documents: DocumentRepository,
    private readonly access: AccessService,
  ) {}

  async getSnapshot(input: {
    actorUserId: string;
    tenantId: string;
    projectId: string;
    transactionId: string;
  }): Promise<ContractExecutionSnapshot | null> {
    const transaction = await this.documents.getTransactionContext({
      tenantId: input.tenantId,
      projectId: input.projectId,
      transactionId: input.transactionId,
    });
    if (!transaction) throw new NotFoundException('Transaction not found.');

    const regular = await this.access.can({
      userId: input.actorUserId,
      permission: 'documents.read',
      context: { tenantId: input.tenantId, projectId: input.projectId },
    });
    if (!regular.allowed) {
      await this.access.assert({
        userId: input.actorUserId,
        permission: 'documents.read.self',
        context: {
          tenantId: input.tenantId,
          projectId: input.projectId,
          resourceOwnerUserId: transaction.buyerUserId,
        },
      });
    }

    return this.repository.getSnapshot({
      tenantId: input.tenantId,
      projectId: input.projectId,
      transactionId: input.transactionId,
    });
  }
}
