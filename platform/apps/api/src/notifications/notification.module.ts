import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { RealtimeModule } from '../realtime/realtime.module.js';
import { NotificationRepository } from './notification.repository.js';
import { NotificationService } from './notification.service.js';
import { NotificationSlaController, UserNotificationController } from './notification.controller.js';

@Module({
  imports: [AuthModule, AccessModule, RealtimeModule],
  controllers: [NotificationSlaController, UserNotificationController],
  providers: [NotificationRepository, NotificationService],
})
export class NotificationModule {}
