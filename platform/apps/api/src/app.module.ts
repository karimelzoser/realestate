import { Module } from '@nestjs/common';
import { AccessModule } from './access/access.module.js';
import { AuthModule } from './auth/auth.module.js';
import { CatalogModule } from './catalog/catalog.module.js';
import { DatabaseModule } from './database/database.module.js';
import { HealthController } from './health/health.controller.js';
import { SalesModule } from './sales/sales.module.js';

@Module({
  imports: [DatabaseModule, AuthModule, AccessModule, CatalogModule, SalesModule],
  controllers: [HealthController],
})
export class AppModule {}
