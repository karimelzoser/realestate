import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { ExportController } from './export.controller.js';
import { ExportService } from './export.service.js';

@Module({
  imports: [AuthModule, AccessModule],
  controllers: [ExportController],
  providers: [ExportService],
})
export class ExportModule {}
