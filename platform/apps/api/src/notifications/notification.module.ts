import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { RealtimeModule } from '../realtime/realtime.module.js';
import { InstallmentReminderController } from './installment-reminder.controller.js';
import { InstallmentReminderRepository } from './installment-reminder.repository.js';
import { InstallmentReminderService } from './installment-reminder.service.js';
import { MilestoneReminderController } from './milestone-reminder.controller.js';
import { MilestoneReminderRepository } from './milestone-reminder.repository.js';
import { MilestoneReminderService } from './milestone-reminder.service.js';
import { NotificationRepository } from './notification.repository.js';
import { NotificationService } from './notification.service.js';
import { NotificationSlaController, UserNotificationController } from './notification.controller.js';

@Module({
  imports: [AuthModule, AccessModule, RealtimeModule],
  controllers: [
    NotificationSlaController,
    UserNotificationController,
    InstallmentReminderController,
    MilestoneReminderController,
  ],
  providers: [
    NotificationRepository,
    NotificationService,
    InstallmentReminderRepository,
    InstallmentReminderService,
    MilestoneReminderRepository,
    MilestoneReminderService,
  ],
})
export class NotificationModule {}
