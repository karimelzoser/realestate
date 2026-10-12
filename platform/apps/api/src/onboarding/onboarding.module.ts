import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module.js';
import { AccountModule } from '../accounts/account.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { OnboardingController } from './onboarding.controller.js';
import { OnboardingProjectRepository } from './onboarding-project.repository.js';
import { OnboardingRepository } from './onboarding.repository.js';
import { OnboardingService } from './onboarding.service.js';

@Module({
  imports: [AuthModule, AccessModule, AccountModule],
  controllers: [OnboardingController],
  providers: [OnboardingRepository, OnboardingProjectRepository, OnboardingService],
  exports: [OnboardingService],
})
export class OnboardingModule {}
