import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { AccessController } from './access.controller.js';
import { AccessRepository, PostgresAccessRepository } from './access.repository.js';
import { AccessService } from './access.service.js';

@Module({
  imports: [AuthModule],
  controllers: [AccessController],
  providers: [
    PostgresAccessRepository,
    { provide: AccessRepository, useExisting: PostgresAccessRepository },
    AccessService,
  ],
  exports: [AccessService],
})
export class AccessModule {}
