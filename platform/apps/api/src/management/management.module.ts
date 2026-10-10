import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { SalesModule } from '../sales/sales.module.js';
import { ManagementController, TenantManagementController } from './management.controller.js';
import { ManagementRepository } from './management.repository.js';
import { ManagementService } from './management.service.js';
import { ManagementTenantRepository } from './management-tenant.repository.js';

@Module({
  imports: [AuthModule, AccessModule, SalesModule],
  controllers: [ManagementController, TenantManagementController],
  providers: [ManagementRepository, ManagementTenantRepository, ManagementService],
  exports: [ManagementService],
})
export class ManagementModule {}
