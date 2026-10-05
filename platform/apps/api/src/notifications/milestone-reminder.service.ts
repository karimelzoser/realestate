import { Injectable } from '@nestjs/common';
import type {
  MilestoneReminderPolicySnapshot,
  UpsertMilestoneReminderPolicyInput,
} from '@preneura/contracts/notifications';
import { AccessService } from '../access/access.service.js';
import { MilestoneReminderRepository } from './milestone-reminder.repository.js';

@Injectable()
export class MilestoneReminderService {
  constructor(
    private readonly repository: MilestoneReminderRepository,
    private readonly access: AccessService,
  ) {}

  async list(input: {
    actorUserId: string;
    tenantId: string;
    projectId: string;
  }): Promise<MilestoneReminderPolicySnapshot[]> {
    await this.access.assert({
      userId: input.actorUserId,
      permission: 'notifications.manage',
      context: { tenantId: input.tenantId, projectId: input.projectId },
    });
    return this.repository.list(input);
  }

  async upsert(input: {
    actorUserId: string;
    data: UpsertMilestoneReminderPolicyInput;
  }): Promise<MilestoneReminderPolicySnapshot> {
    await this.access.assert({
      userId: input.actorUserId,
      permission: 'notifications.manage',
      context: { tenantId: input.data.tenantId, projectId: input.data.projectId },
    });
    return this.repository.upsert({
      actorUserId: input.actorUserId,
      data: input.data,
      now: new Date(),
    });
  }
}
