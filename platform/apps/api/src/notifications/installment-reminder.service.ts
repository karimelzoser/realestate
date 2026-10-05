import { Injectable } from '@nestjs/common';
import type {
  InstallmentReminderPolicySnapshot,
  UpsertInstallmentReminderPolicyInput,
} from '@preneura/contracts/notifications';
import { AccessService } from '../access/access.service.js';
import { InstallmentReminderRepository } from './installment-reminder.repository.js';

@Injectable()
export class InstallmentReminderService {
  constructor(
    private readonly repository: InstallmentReminderRepository,
    private readonly access: AccessService,
  ) {}

  async list(input: {
    actorUserId: string;
    tenantId: string;
    projectId: string;
  }): Promise<InstallmentReminderPolicySnapshot[]> {
    await this.access.assert({
      userId: input.actorUserId,
      permission: 'notifications.manage',
      context: { tenantId: input.tenantId, projectId: input.projectId },
    });
    return this.repository.list(input);
  }

  async upsert(input: {
    actorUserId: string;
    data: UpsertInstallmentReminderPolicyInput;
  }): Promise<InstallmentReminderPolicySnapshot> {
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
