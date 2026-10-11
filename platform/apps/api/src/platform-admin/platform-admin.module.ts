import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { PlatformAdminController } from './platform-admin.controller.js';
import { PlatformAdminRepository } from './platform-admin.repository.js';
import { PlatformAdminService } from './platform-admin.service.js';

@Module({
  imports: [AuthModule, AccessModule],
  controllers: [PlatformAdminController],
  providers: [PlatformAdminRepository, PlatformAdminService],
})
export class PlatformAdminModule {}
