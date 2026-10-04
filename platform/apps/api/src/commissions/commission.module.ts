import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { CommissionController } from './commission.controller.js';
import { CommissionRepository } from './commission.repository.js';
import { CommissionService } from './commission.service.js';

@Module({
  imports: [AuthModule, AccessModule],
  controllers: [CommissionController],
  providers: [CommissionRepository, CommissionService],
  exports: [CommissionService],
})
export class CommissionModule {}
