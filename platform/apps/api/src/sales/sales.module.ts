import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { EoiRefundController } from './eoi-refund.controller.js';
import { EoiRefundRepository } from './eoi-refund.repository.js';
import { EoiRefundService } from './eoi-refund.service.js';
import { QueueDispatchController } from './queue-dispatch.controller.js';
import { QueueDispatchRepository } from './queue-dispatch.repository.js';
import { QueueDispatchService } from './queue-dispatch.service.js';
import { SalesController } from './sales.controller.js';
import { SalesRepository } from './sales.repository.js';
import { SalesService } from './sales.service.js';

@Module({
  imports: [AuthModule, AccessModule],
  controllers: [SalesController, EoiRefundController, QueueDispatchController],
  providers: [
    SalesRepository,
    SalesService,
    EoiRefundRepository,
    EoiRefundService,
    QueueDispatchRepository,
    QueueDispatchService,
  ],
  exports: [SalesService, EoiRefundService],
})
export class SalesModule {}
