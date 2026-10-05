import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { EoiRefundController } from './eoi-refund.controller.js';
import { EoiRefundRepository } from './eoi-refund.repository.js';
import { EoiRefundService } from './eoi-refund.service.js';
import { MilestoneEvidenceService } from './milestone-evidence.service.js';
import { QueueDispatchController } from './queue-dispatch.controller.js';
import { QueueDispatchRepository } from './queue-dispatch.repository.js';
import { QueueDispatchService } from './queue-dispatch.service.js';
import { SalesController } from './sales.controller.js';
import { SalesRepository } from './sales.repository.js';
import { SalesService } from './sales.service.js';
import { TransactionListController } from './transaction-list.controller.js';
import { TransactionListRepository } from './transaction-list.repository.js';
import { TransactionListService } from './transaction-list.service.js';
import { TransactionTimelineController } from './transaction-timeline.controller.js';
import { TransactionTimelineRepository } from './transaction-timeline.repository.js';
import { TransactionTimelineService } from './transaction-timeline.service.js';

@Module({
  imports: [AuthModule, AccessModule],
  controllers: [
    SalesController,
    EoiRefundController,
    QueueDispatchController,
    TransactionListController,
    TransactionTimelineController,
  ],
  providers: [
    SalesRepository,
    MilestoneEvidenceService,
    SalesService,
    EoiRefundRepository,
    EoiRefundService,
    QueueDispatchRepository,
    QueueDispatchService,
    TransactionListRepository,
    TransactionListService,
    TransactionTimelineRepository,
    TransactionTimelineService,
  ],
  exports: [SalesService, EoiRefundService, TransactionListService, TransactionTimelineService],
})
export class SalesModule {}
