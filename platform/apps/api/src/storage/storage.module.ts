import { Global, Module } from '@nestjs/common';
import { ObjectStorageService } from './object-storage.service.js';
import { ObjectTrustRepository } from './object-trust.repository.js';
import { ObjectTrustService } from './object-trust.service.js';

@Global()
@Module({
  providers: [ObjectStorageService, ObjectTrustRepository, ObjectTrustService],
  exports: [ObjectStorageService, ObjectTrustRepository, ObjectTrustService],
})
export class StorageModule {}
