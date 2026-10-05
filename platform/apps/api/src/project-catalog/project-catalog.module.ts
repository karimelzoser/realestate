import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { ProjectCatalogController } from './project-catalog.controller.js';
import { ProjectCatalogRepository } from './project-catalog.repository.js';
import { ProjectCatalogService } from './project-catalog.service.js';

@Module({
  imports: [AuthModule, AccessModule],
  controllers: [ProjectCatalogController],
  providers: [ProjectCatalogRepository, ProjectCatalogService],
  exports: [ProjectCatalogService],
})
export class ProjectCatalogModule {}
