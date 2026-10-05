import { ForbiddenException, Injectable } from '@nestjs/common';
import type { BrokerCommissionContextSnapshot } from '@preneura/contracts/commissions';
import { AccessService } from '../access/access.service.js';
import { CommissionContextRepository } from './commission-context.repository.js';

@Injectable()
export class CommissionContextService {
  constructor(
    private readonly repository: CommissionContextRepository,
    private readonly access: AccessService,
  ) {}

  async list(input: {
    actorUserId: string;
    tenantId: string;
    projectId: string;
  }): Promise<BrokerCommissionContextSnapshot[]> {
    const internal = await this.access.can({
      userId: input.actorUserId,
      permission: 'commission.status.read',
      context: { tenantId: input.tenantId, projectId: input.projectId },
    });

    if (internal.allowed && internal.scopeType !== 'BROKER_COMPANY') {
      return this.repository.listProjectBrokers({
        tenantId: input.tenantId,
        projectId: input.projectId,
        now: new Date(),
      });
    }

    const assignments = await this.access.matchingAssignments({
      userId: input.actorUserId,
      permission: 'commission.status.read',
      context: { tenantId: input.tenantId, projectId: input.projectId },
    });
    const brokerCompanyIds = [...new Set(assignments
      .filter((assignment) => assignment.scopeType === 'BROKER_COMPANY' && assignment.brokerCompanyId)
      .map((assignment) => assignment.brokerCompanyId!))];

    if (brokerCompanyIds.length === 0) {
      throw new ForbiddenException('You do not have commission visibility for this project.');
    }

    return this.repository.listProjectBrokers({
      tenantId: input.tenantId,
      projectId: input.projectId,
      brokerCompanyIds,
      now: new Date(),
    });
  }
}
