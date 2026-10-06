import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { CommissionModule } from '../commissions/commission.module.js';
import { FinanceController } from './finance.controller.js';
import { FinanceLedgerRepository } from './finance-ledger.repository.js';
import { FinanceProviderController } from './finance-provider.controller.js';
import { FinanceRepository } from './finance.repository.js';
import { FinanceService } from './finance.service.js';

@Module({
  imports: [AuthModule, AccessModule, CommissionModule],
  controllers: [FinanceController, FinanceProviderController],
  providers: [FinanceRepository, FinanceLedgerRepository, FinanceService],
  exports: [FinanceService],
})
export class FinanceModule {}
