import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { SalesController } from './sales.controller.js';
import { SalesRepository } from './sales.repository.js';
import { SalesService } from './sales.service.js';

@Module({
  imports: [AuthModule, AccessModule],
  controllers: [SalesController],
  providers: [SalesRepository, SalesService],
  exports: [SalesService],
})
export class SalesModule {}
