import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module.js';
import { ExportController } from './export.controller.js';
import { ExportService } from './export.service.js';

@Module({
  imports: [AccessModule],
  controllers: [ExportController],
  providers: [ExportService],
})
export class ExportModule {}
