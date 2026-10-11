import { Injectable, NotFoundException } from '@nestjs/common';
import type {
  ExactAllocationContextSnapshot,
  ExactAllocationLockInput,
  ExactAllocationLockResult,
} from '@preneura/contracts/allocation';
import { AccessService } from '../access/access.service.js';
import { ExactAllocationRepository } from './exact-allocation.repository.js';

@Injectable()
export class ExactAllocationService {
  constructor(
    private readonly repository: ExactAllocationRepository,
    private readonly access: AccessService,
  ) {}

  async context(input: {
    actorUserId: string;
    tenantId: string;
    projectId: string;
    queueEntryId: string;
  }): Promise<ExactAllocationContextSnapshot> {
    await this.access.assert({
      userId: input.actorUserId,
      permission: 'allocation.assist',
      context: { tenantId: input.tenantId, projectId: input.projectId },
    });
    await this.access.assert({
      userId: input.actorUserId,
      permission: 'inventory.read',
      context: { tenantId: input.tenantId, projectId: input.projectId },
    });

    const context = await this.repository.getContext({ ...input, now: new Date() });
    if (!context) {
      throw new NotFoundException(
        'Called allocation entry with a paid typed EOI was not found.',
      );
    }
    return context;
  }

  async lock(input: {
    actorUserId: string;
    data: ExactAllocationLockInput;
  }): Promise<ExactAllocationLockResult> {
    await this.access.assert({
      userId: input.actorUserId,
      permission: 'allocation.assist',
      context: { tenantId: input.data.tenantId, projectId: input.data.projectId },
    });
    await this.access.assert({
      userId: input.actorUserId,
      permission: 'unit.lock',
      context: { tenantId: input.data.tenantId, projectId: input.data.projectId },
    });

    return this.repository.lock({
      tenantId: input.data.tenantId,
      projectId: input.data.projectId,
      queueEntryId: input.data.queueEntryId,
      physicalUnitId: input.data.physicalUnitId,
      lockedByUserId: input.actorUserId,
      ttlSeconds: input.data.ttlSeconds,
      now: new Date(),
    });
  }
}
