import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module.js';
import { AccountModule } from '../accounts/account.module.js';
import { OnboardingController } from './onboarding.controller.js';
import { OnboardingRepository } from './onboarding.repository.js';
import { OnboardingService } from './onboarding.service.js';

@Module({
  imports: [AccessModule, AccountModule],
  controllers: [OnboardingController],
  providers: [OnboardingRepository, OnboardingService],
  exports: [OnboardingService],
})
export class OnboardingModule {}
