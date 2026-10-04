import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { StorageModule } from '../storage/storage.module.js';
import { DocumentRepository } from './document.repository.js';
import { DocumentService } from './document.service.js';
import { DocumentTemplateController, TransactionDocumentController } from './document.controller.js';

@Module({
  imports: [AuthModule, AccessModule, StorageModule],
  controllers: [DocumentTemplateController, TransactionDocumentController],
  providers: [DocumentRepository, DocumentService],
  exports: [DocumentService],
})
export class DocumentModule {}
