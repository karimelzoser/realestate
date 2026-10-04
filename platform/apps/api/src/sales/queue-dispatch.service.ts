import { Injectable, NotFoundException } from '@nestjs/common';
import type { QueueEntrySnapshot } from '@preneura/contracts/sales';
import { AccessService } from '../access/access.service.js';
import { QueueDispatchRepository } from './queue-dispatch.repository.js';

@Injectable()
export class QueueDispatchService {
  constructor(
    private readonly repository: QueueDispatchRepository,
    private readonly access: AccessService,
  ) {}

  async callNext(input: {
    actorUserId: string;
    tenantId: string;
    projectId: string;
  }): Promise<QueueEntrySnapshot> {
    await this.access.assert({
      userId: input.actorUserId,
      permission: 'queue.manage',
      context: { tenantId: input.tenantId, projectId: input.projectId },
    });

    const called = await this.repository.callNext({
      ...input,
      now: new Date(),
    });
    if (!called) throw new NotFoundException('No buyer is waiting in this project queue.');
    return called;
  }
}
