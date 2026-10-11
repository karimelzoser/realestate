import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { BrokerageOnboardingController } from './brokerage-onboarding.controller.js';
import { BrokerageOnboardingRepository } from './brokerage-onboarding.repository.js';
import { BrokerageOnboardingService } from './brokerage-onboarding.service.js';

@Module({
  imports: [AuthModule, AccessModule],
  controllers: [BrokerageOnboardingController],
  providers: [BrokerageOnboardingRepository, BrokerageOnboardingService],
  exports: [BrokerageOnboardingService],
})
export class BrokerageOnboardingModule {}
