import { Module } from '@nestjs/common';
import { AccessRepository, PostgresAccessRepository } from './access.repository.js';
import { AccessService } from './access.service.js';

@Module({
  providers: [
    PostgresAccessRepository,
    { provide: AccessRepository, useExisting: PostgresAccessRepository },
    AccessService,
  ],
  exports: [AccessService],
})
export class AccessModule {}
