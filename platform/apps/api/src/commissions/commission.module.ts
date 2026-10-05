import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { CommissionContextController } from './commission-context.controller.js';
import { CommissionContextRepository } from './commission-context.repository.js';
import { CommissionContextService } from './commission-context.service.js';
import { CommissionController } from './commission.controller.js';
import { CommissionRepository } from './commission.repository.js';
import { CommissionService } from './commission.service.js';

@Module({
  imports: [AuthModule, AccessModule],
  controllers: [CommissionController, CommissionContextController],
  providers: [
    CommissionRepository,
    CommissionService,
    CommissionContextRepository,
    CommissionContextService,
  ],
  exports: [CommissionService],
})
export class CommissionModule {}
