import { ConflictException, Injectable } from '@nestjs/common';
import type { TransactionPriceSnapshot } from '@preneura/contracts/pricing-quote';
import { SalesService } from './sales.service.js';
import { TransactionPriceRepository } from './transaction-price.repository.js';

@Injectable()
export class TransactionPriceService {
  constructor(
    private readonly sales: SalesService,
    private readonly repository: TransactionPriceRepository,
  ) {}

  async getSnapshot(input: {
    actorUserId: string;
    tenantId: string;
    projectId: string;
    transactionId: string;
  }): Promise<TransactionPriceSnapshot> {
    // Reuse the existing transaction-read authorization boundary, including
    // buyer-self and broker-company/agent field-scope rules.
    await this.sales.getTransactionProgress(input);

    const snapshot = await this.repository.getSnapshot(input);
    if (!snapshot) {
      throw new ConflictException('Transaction does not have a complete certified pricing snapshot.');
    }
    return snapshot;
  }
}
