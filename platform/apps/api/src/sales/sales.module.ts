import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module.js';
import { AccountVerificationDelivery } from '../accounts/account-verification-delivery.js';
import { AuthModule } from '../auth/auth.module.js';
import { AllocationRoleController } from './allocation-role.controller.js';
import { AllocationRoleRepository } from './allocation-role.repository.js';
import { AllocationRoleService } from './allocation-role.service.js';
import { EoiFinanceRepository } from './eoi-finance.repository.js';
import { EoiFinanceService } from './eoi-finance.service.js';
import { EoiListController } from './eoi-list.controller.js';
import { EoiListRepository } from './eoi-list.repository.js';
import { EoiListService } from './eoi-list.service.js';
import { EoiRefundController } from './eoi-refund.controller.js';
import { EoiRefundRepository } from './eoi-refund.repository.js';
import { EoiRefundService } from './eoi-refund.service.js';
import { MilestoneEvidenceService } from './milestone-evidence.service.js';
import { QueueDispatchController } from './queue-dispatch.controller.js';
import { QueueDispatchRepository } from './queue-dispatch.repository.js';
import { QueueDispatchService } from './queue-dispatch.service.js';
import { SalesBuyerController } from './sales-buyer.controller.js';
import { SalesBuyerListRepository } from './sales-buyer-list.repository.js';
import { SalesBuyerListService } from './sales-buyer-list.service.js';
import { SalesBuyerOnboardingRepository } from './sales-buyer-onboarding.repository.js';
import { SalesBuyerOnboardingService } from './sales-buyer-onboarding.service.js';
import { SalesController } from './sales.controller.js';
import { SalesRepository } from './sales.repository.js';
import { SalesService } from './sales.service.js';
import { TransactionListController } from './transaction-list.controller.js';
import { TransactionListRepository } from './transaction-list.repository.js';
import { TransactionListService } from './transaction-list.service.js';
import { TransactionOperationsController } from './transaction-operations.controller.js';
import { TransactionOperationsRepository } from './transaction-operations.repository.js';
import { TransactionOperationsService } from './transaction-operations.service.js';
import { TransactionPriceController } from './transaction-price.controller.js';
import { TransactionPriceRepository } from './transaction-price.repository.js';
import { TransactionPriceService } from './transaction-price.service.js';
import { TransactionTimelineController } from './transaction-timeline.controller.js';
import { TransactionTimelineRepository } from './transaction-timeline.repository.js';
import { TransactionTimelineService } from './transaction-timeline.service.js';

@Module({
  imports: [AuthModule, AccessModule],
  controllers: [
    SalesController,
    SalesBuyerController,
    EoiListController,
    EoiRefundController,
    QueueDispatchController,
    AllocationRoleController,
    TransactionListController,
    TransactionOperationsController,
    TransactionPriceController,
    TransactionTimelineController,
  ],
  providers: [
    SalesRepository,
    MilestoneEvidenceService,
    SalesService,
    SalesBuyerListRepository,
    SalesBuyerListService,
    SalesBuyerOnboardingRepository,
    SalesBuyerOnboardingService,
    AccountVerificationDelivery,
    EoiFinanceRepository,
    EoiFinanceService,
    EoiListRepository,
    EoiListService,
    EoiRefundRepository,
    EoiRefundService,
    QueueDispatchRepository,
    QueueDispatchService,
    AllocationRoleRepository,
    AllocationRoleService,
    TransactionListRepository,
    TransactionListService,
    TransactionOperationsRepository,
    TransactionOperationsService,
    TransactionPriceRepository,
    TransactionPriceService,
    TransactionTimelineRepository,
    TransactionTimelineService,
  ],
  exports: [
    SalesService,
    EoiFinanceService,
    EoiListService,
    EoiRefundService,
    AllocationRoleService,
    TransactionListService,
    TransactionOperationsService,
    TransactionTimelineService,
  ],
})
export class SalesModule {}
