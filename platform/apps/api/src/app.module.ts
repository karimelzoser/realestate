import { Module } from '@nestjs/common';
import { AccessModule } from './access/access.module.js';
import { AccountModule } from './accounts/account.module.js';
import { AuthModule } from './auth/auth.module.js';
import { CatalogModule } from './catalog/catalog.module.js';
import { CommissionModule } from './commissions/commission.module.js';
import { DatabaseModule } from './database/database.module.js';
import { DocumentModule } from './documents/document.module.js';
import { FinanceModule } from './finance/finance.module.js';
import { HealthController } from './health/health.controller.js';
import { NotificationModule } from './notifications/notification.module.js';
import { PlatformAdminModule } from './platform-admin/platform-admin.module.js';
import { RealtimeModule } from './realtime/realtime.module.js';
import { SalesModule } from './sales/sales.module.js';
import { StorageModule } from './storage/storage.module.js';

@Module({
  imports: [
    DatabaseModule,
    AuthModule,
    AccessModule,
    AccountModule,
    PlatformAdminModule,
    StorageModule,
    CatalogModule,
    SalesModule,
    CommissionModule,
    DocumentModule,
    FinanceModule,
    RealtimeModule,
    NotificationModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
