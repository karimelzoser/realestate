import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { CatalogModule } from '../catalog/catalog.module.js';
import { AiController } from './ai.controller.js';
import { AiProvider } from './ai.provider.js';
import { AiRepository } from './ai.repository.js';
import { AiService } from './ai.service.js';

@Module({
  imports: [AuthModule, AccessModule, CatalogModule],
  controllers: [AiController],
  providers: [AiRepository, AiProvider, AiService],
  exports: [AiService],
})
export class AiModule {}
