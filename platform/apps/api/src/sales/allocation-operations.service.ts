import { Injectable } from '@nestjs/common';
import type { AllocationQueueEntrySnapshot } from '@preneura/contracts/allocation';
import { AccessService } from '../access/access.service.js';
import { AllocationOperationsRepository } from './allocation-operations.repository.js';

@Injectable()
export class AllocationOperationsService {
  constructor(
    private readonly repository: AllocationOperationsRepository,
    private readonly access: AccessService,
  ) {}

  async listQueue(input: {
    actorUserId: string;
    tenantId: string;
    projectId: string;
  }): Promise<AllocationQueueEntrySnapshot[]> {
    await this.access.assert({
      userId: input.actorUserId,
      permission: 'queue.read',
      context: { tenantId: input.tenantId, projectId: input.projectId },
    });
    return this.repository.listQueue({
      tenantId: input.tenantId,
      projectId: input.projectId,
      now: new Date(),
    });
  }
}
