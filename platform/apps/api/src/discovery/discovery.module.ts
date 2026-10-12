import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { AccessModule } from '../access/access.module.js';
import { DiscoveryController, ProjectPublicationController } from './discovery.controller.js';
import { DiscoveryRepository } from './discovery.repository.js';
@Module({imports:[AuthModule,AccessModule],controllers:[DiscoveryController,ProjectPublicationController],providers:[DiscoveryRepository]})
export class DiscoveryModule {}
