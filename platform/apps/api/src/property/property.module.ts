import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { PropertyController } from './property.controller.js';
import { PropertyRepository } from './property.repository.js';
import { PropertyService } from './property.service.js';

@Module({
  imports: [AuthModule, AccessModule],
  controllers: [PropertyController],
  providers: [PropertyRepository, PropertyService],
})
export class PropertyModule {}
