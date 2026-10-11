import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { AccountAdminController, EnrollmentController } from './account.controller.js';
import { AccountBootstrapService } from './account-bootstrap.service.js';
import { AccountRepository } from './account.repository.js';
import { AccountService } from './account.service.js';
import { AccountVerificationDelivery } from './account-verification-delivery.js';

@Module({
  imports: [AuthModule, AccessModule],
  controllers: [AccountAdminController, EnrollmentController],
  providers: [AccountRepository, AccountService, AccountBootstrapService, AccountVerificationDelivery],
  exports: [AccountService, AccountBootstrapService],
})
export class AccountModule {}
