import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type {
  AllocationSessionSnapshot,
  AssignedAllocationLockSnapshot,
  CreateAssignedAllocationLockInput,
} from '@preneura/contracts/allocation';
import { AccessService } from '../access/access.service.js';
import { AllocationRoleRepository } from './allocation-role.repository.js';

@Injectable()
export class AllocationRoleService {
  constructor(
    private readonly repository: AllocationRoleRepository,
    private readonly access: AccessService,
  ) {}

  async current(input: {
    actorUserId: string;
    tenantId: string;
    projectId: string;
  }): Promise<AllocationSessionSnapshot | null> {
    await this.requireAllocator(input);
    return this.repository.getCurrent({
      tenantId: input.tenantId,
      projectId: input.projectId,
      allocatorUserId: input.actorUserId,
    });
  }

  async claimNext(input: {
    actorUserId: string;
    tenantId: string;
    projectId: string;
  }): Promise<AllocationSessionSnapshot> {
    await this.requireAllocator(input);
    try {
      const claimed = await this.repository.claimNext({
        tenantId: input.tenantId,
        projectId: input.projectId,
        allocatorUserId: input.actorUserId,
        now: new Date(),
      });
      if (!claimed) throw new NotFoundException('No called buyer is awaiting allocator assignment.');
      return claimed;
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes('already has an active session')) {
        throw new ConflictException('Finish the current allocation session before claiming another buyer.');
      }
      throw error;
    }
  }

  async createLock(input: {
    actorUserId: string;
    data: CreateAssignedAllocationLockInput;
  }): Promise<AssignedAllocationLockSnapshot> {
    await this.requireAllocator({
      actorUserId: input.actorUserId,
      tenantId: input.data.tenantId,
      projectId: input.data.projectId,
    });

    if (!(await this.repository.unitTypeExists(input.data))) {
      throw new NotFoundException('Active unit type not found.');
    }

    try {
      const lock = await this.repository.createAssignedLock({
        tenantId: input.data.tenantId,
        projectId: input.data.projectId,
        allocatorUserId: input.actorUserId,
        unitTypeId: input.data.unitTypeId,
        ttlSeconds: input.data.ttlSeconds,
        now: new Date(),
      });
      if (!lock) throw new ConflictException('No inventory is currently available for this unit type.');
      return lock;
    } catch (error) {
      if (error instanceof ConflictException || error instanceof NotFoundException) throw error;
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes('no claimed called queue session')) {
        throw new ForbiddenException('Claim a called buyer before locking inventory.');
      }
      throw error;
    }
  }

  private async requireAllocator(input: {
    actorUserId: string;
    tenantId: string;
    projectId: string;
  }): Promise<void> {
    const assignments = await this.access.matchingAssignments({
      userId: input.actorUserId,
      permission: 'allocation.assist',
      context: { tenantId: input.tenantId, projectId: input.projectId },
    });
    if (!assignments.some((assignment) => assignment.role === 'ALLOCATOR')) {
      throw new ForbiddenException('An active Allocator assignment is required for this operation.');
    }
  }
}
