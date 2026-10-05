import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { ProjectAssetUploadController } from './project-asset-upload.controller.js';
import { ProjectAssetUploadService } from './project-asset-upload.service.js';
import { ProjectCatalogController } from './project-catalog.controller.js';
import { ProjectCatalogRepository } from './project-catalog.repository.js';
import { ProjectCatalogService } from './project-catalog.service.js';

@Module({
  imports: [AuthModule, AccessModule],
  controllers: [ProjectCatalogController, ProjectAssetUploadController],
  providers: [ProjectCatalogRepository, ProjectCatalogService, ProjectAssetUploadService],
  exports: [ProjectCatalogService],
})
export class ProjectCatalogModule {}
