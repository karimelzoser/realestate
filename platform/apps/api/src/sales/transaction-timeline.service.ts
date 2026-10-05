import { Injectable, NotFoundException } from '@nestjs/common';
import type { TransactionTimelineEventSnapshot } from '@preneura/contracts/sales';
import { TransactionListService } from './transaction-list.service.js';
import { TransactionTimelineRepository } from './transaction-timeline.repository.js';

@Injectable()
export class TransactionTimelineService {
  constructor(
    private readonly repository: TransactionTimelineRepository,
    private readonly transactions: TransactionListService,
  ) {}

  async list(input: {
    actorUserId: string;
    tenantId: string;
    projectId: string;
    transactionId: string;
  }): Promise<TransactionTimelineEventSnapshot[]> {
    const visible = await this.transactions.list({
      actorUserId: input.actorUserId,
      tenantId: input.tenantId,
      projectId: input.projectId,
    });
    if (!visible.some((transaction) => transaction.transactionId === input.transactionId)) {
      throw new NotFoundException('Transaction not found.');
    }
    return this.repository.list(input);
  }
}
