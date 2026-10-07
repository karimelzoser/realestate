import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module.js';
import { SettlementController } from './settlement.controller.js';
import { SettlementProviderController } from './settlement-provider.controller.js';
import { SettlementRepository } from './settlement.repository.js';
import { SettlementService } from './settlement.service.js';

@Module({
  imports: [AccessModule],
  controllers: [SettlementController, SettlementProviderController],
  providers: [SettlementRepository, SettlementService],
  exports: [SettlementService],
})
export class SettlementModule {}
