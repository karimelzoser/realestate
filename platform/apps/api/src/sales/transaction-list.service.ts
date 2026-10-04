import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { TransactionListItemSnapshot } from '@preneura/contracts/sales';
import { AccessService } from '../access/access.service.js';
import { TransactionListRepository } from './transaction-list.repository.js';

const BROKER_ROLES = new Set(['BROKER_MANAGER', 'BROKER_FINANCE', 'BROKER_AGENT']);

@Injectable()
export class TransactionListService {
  constructor(
    private readonly repository: TransactionListRepository,
    private readonly access: AccessService,
  ) {}

  async list(input: {
    actorUserId: string;
    tenantId: string;
    projectId: string;
  }): Promise<TransactionListItemSnapshot[]> {
    if (!(await this.repository.projectExists(input.tenantId, input.projectId))) {
      throw new NotFoundException('Project not found.');
    }

    const regularAssignments = await this.access.matchingAssignments({
      userId: input.actorUserId,
      permission: 'transaction.read',
      context: { tenantId: input.tenantId, projectId: input.projectId },
    });

    const internalAssignments = regularAssignments.filter((assignment) => !BROKER_ROLES.has(assignment.role));
    if (internalAssignments.length > 0) {
      return this.repository.list({ tenantId: input.tenantId, projectId: input.projectId });
    }

    const brokerAssignments = regularAssignments.filter((assignment) =>
      BROKER_ROLES.has(assignment.role) && Boolean(assignment.brokerCompanyId),
    );
    if (brokerAssignments.length > 0) {
      const wideBrokerAssignments = brokerAssignments.filter((assignment) => assignment.role !== 'BROKER_AGENT');
      const effectiveAssignments = wideBrokerAssignments.length > 0 ? wideBrokerAssignments : brokerAssignments;
      const brokerCompanyIds = [...new Set(effectiveAssignments.map((assignment) => assignment.brokerCompanyId!))];
      const agentOnly = wideBrokerAssignments.length === 0;
      return this.repository.list({
        tenantId: input.tenantId,
        projectId: input.projectId,
        brokerCompanyIds,
        brokerAgentUserId: agentOnly ? input.actorUserId : null,
      });
    }

    const selfAssignments = await this.access.matchingAssignments({
      userId: input.actorUserId,
      permission: 'transaction.read.self',
      context: {
        tenantId: input.tenantId,
        projectId: input.projectId,
        resourceOwnerUserId: input.actorUserId,
      },
    });
    if (selfAssignments.length > 0) {
      return this.repository.list({
        tenantId: input.tenantId,
        projectId: input.projectId,
        buyerUserId: input.actorUserId,
      });
    }

    throw new ForbiddenException('You do not have permission to view transactions in this project.');
  }
}
