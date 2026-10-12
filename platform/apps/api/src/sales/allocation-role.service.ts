import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type {
  AllocationSessionSnapshot,
  AssignedAllocationLockSnapshot,
  CreateAssignedAllocationLockInput,
  CreateExactApartmentQuoteInput,
  ExactApartmentQuoteSnapshot,
  EligibleApartmentFilter,
  EligibleApartmentPage,
  EligibleApartmentStructure,
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

    try {
      const lock = await this.repository.createAssignedLock({
        tenantId: input.data.tenantId,
        projectId: input.data.projectId,
        allocatorUserId: input.actorUserId,
        quoteId: input.data.quoteId,
        idempotencyKey: input.data.idempotencyKey,
        ttlSeconds: input.data.ttlSeconds,
      });
      if (!lock) throw new ConflictException('The requested apartment could not be held.');
      return lock;
    } catch (error) {
      if (error instanceof ConflictException || error instanceof NotFoundException) throw error;
      this.rethrowAllocationConflict(error);
      throw error;
    }
  }

  async apartments(input: { actorUserId: string; tenantId: string; projectId: string; filters: EligibleApartmentFilter }): Promise<EligibleApartmentPage> {
    await this.requireAllocator(input);
    return this.repository.eligibleApartments({ ...input, allocatorUserId: input.actorUserId });
  }
  async structure(input: { actorUserId:string; tenantId:string; projectId:string }): Promise<EligibleApartmentStructure> {
    await this.requireAllocator(input);
    return this.repository.structure({ ...input,allocatorUserId:input.actorUserId });
  }

  async createQuote(input: { actorUserId: string; data: CreateExactApartmentQuoteInput }): Promise<ExactApartmentQuoteSnapshot> {
    await this.requireAllocator({ actorUserId: input.actorUserId, ...input.data });
    try {
      const quote=await this.repository.quoteApartment({ ...input.data, allocatorUserId: input.actorUserId });
      if (!quote) throw new NotFoundException('Exact apartment quote not found.');
      return quote;
    } catch (error) {
      this.rethrowAllocationConflict(error);
      throw error;
    }
  }

  async quote(input: { actorUserId: string; tenantId: string; projectId: string; quoteId: string }): Promise<ExactApartmentQuoteSnapshot> {
    await this.requireAllocator(input);
    const quote=await this.repository.quote({ ...input, allocatorUserId: input.actorUserId });
    if (!quote) throw new NotFoundException('Owned exact apartment quote not found.');
    return quote;
  }

  private rethrowAllocationConflict(error: unknown): void {
    const code=error && typeof error==='object' && 'code' in error ? error.code : null;
    if (['P0001','23505','55P03','40P01'].includes(String(code))) {
      throw new ConflictException({ error: 'EXACT_SELECTION_CHANGED', message: 'Apartment availability, eligibility or quote changed. Refresh the selection.' });
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
