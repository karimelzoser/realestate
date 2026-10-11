import { Injectable, NotFoundException } from '@nestjs/common';
import type { ConvertLockToReservationInput, ExactReservationResult } from '@preneura/contracts/sales';
import { AccessService } from '../access/access.service.js';
import { ReservationConversionRepository } from './reservation-conversion.repository.js';
import { SalesRepository } from './sales.repository.js';

@Injectable()
export class ReservationConversionService {
  constructor(
    private readonly repository: ReservationConversionRepository,
    private readonly salesRepository: SalesRepository,
    private readonly access: AccessService,
  ) {}

  async convert(input: {
    actorUserId: string;
    data: ConvertLockToReservationInput;
  }): Promise<ExactReservationResult> {
    if (!(await this.salesRepository.projectExists(input.data.tenantId, input.data.projectId))) {
      throw new NotFoundException('Project not found.');
    }

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

    const result = await this.repository.convert({
      actorUserId: input.actorUserId,
      tenantId: input.data.tenantId,
      projectId: input.data.projectId,
      buyerProfileId: input.data.buyerProfileId,
      queueEntryId: input.data.queueEntryId,
      lockId: input.data.lockId,
      now: new Date(),
    });

    // The focused repository persists and returns exact physical-unit identity;
    // its legacy base return annotation is kept only for source compatibility.
    return result as ExactReservationResult;
  }
}
