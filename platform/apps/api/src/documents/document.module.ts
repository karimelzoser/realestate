import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { CommissionModule } from '../commissions/commission.module.js';
import { StorageModule } from '../storage/storage.module.js';
import { DocumentRequirementController } from './document-requirement.controller.js';
import { DocumentRequirementRepository } from './document-requirement.repository.js';
import { DocumentRequirementService } from './document-requirement.service.js';
import { DocumentTemplateListController } from './document-template-list.controller.js';
import { DocumentTemplateListRepository } from './document-template-list.repository.js';
import { DocumentTemplateListService } from './document-template-list.service.js';
import { DocumentRepository } from './document.repository.js';
import { DocumentService } from './document.service.js';
import { DocumentTemplateController, TransactionDocumentController } from './document.controller.js';

@Module({
  imports: [AuthModule, AccessModule, CommissionModule, StorageModule],
  controllers: [
    DocumentTemplateController,
    TransactionDocumentController,
    DocumentRequirementController,
    DocumentTemplateListController,
  ],
  providers: [
    DocumentRepository,
    DocumentService,
    DocumentRequirementRepository,
    DocumentRequirementService,
    DocumentTemplateListRepository,
    DocumentTemplateListService,
  ],
  exports: [DocumentService, DocumentRequirementService, DocumentTemplateListService],
})
export class DocumentModule {}
