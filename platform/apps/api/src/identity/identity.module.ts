import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module.js';
import { AuthModule } from '../auth/auth.module.js';
import {
  IdentityAdminController,
  IdentityRecoveryController,
  SelfIdentityController,
} from './identity.controller.js';
import { IdentityRecoveryDelivery } from './identity-recovery-delivery.js';
import { IdentityRepository } from './identity.repository.js';
import { IdentityService } from './identity.service.js';

@Module({
  imports: [AuthModule, AccessModule],
  controllers: [SelfIdentityController, IdentityAdminController, IdentityRecoveryController],
  providers: [IdentityRepository, IdentityService, IdentityRecoveryDelivery],
})
export class IdentityModule {}
