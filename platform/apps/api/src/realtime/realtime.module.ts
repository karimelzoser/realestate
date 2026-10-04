import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { RealtimeController } from './realtime.controller.js';
import { RealtimeListenerService } from './realtime-listener.service.js';
import { RealtimeRepository } from './realtime.repository.js';
import { RealtimeService } from './realtime.service.js';

@Module({
  imports: [AuthModule, AccessModule],
  controllers: [RealtimeController],
  providers: [RealtimeListenerService, RealtimeRepository, RealtimeService],
  exports: [RealtimeListenerService],
})
export class RealtimeModule {}
