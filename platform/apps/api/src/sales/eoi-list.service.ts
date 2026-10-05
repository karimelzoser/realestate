import { ForbiddenException, Injectable } from '@nestjs/common';
import type { EoiListItemSnapshot } from '@preneura/contracts/sales';
import { AccessService } from '../access/access.service.js';
import { EoiListRepository } from './eoi-list.repository.js';

const BROKER_ROLES = new Set(['BROKER_MANAGER', 'BROKER_FINANCE', 'BROKER_AGENT']);

@Injectable()
export class EoiListService {
  constructor(
    private readonly repository: EoiListRepository,
    private readonly access: AccessService,
  ) {}

  async list(input: {
    actorUserId: string;
    tenantId: string;
    projectId: string;
  }): Promise<EoiListItemSnapshot[]> {
    const regularAssignments = await this.access.matchingAssignments({
      userId: input.actorUserId,
      permission: 'eoi.read',
      context: { tenantId: input.tenantId, projectId: input.projectId },
    });

    if (regularAssignments.some((assignment) => !BROKER_ROLES.has(assignment.role))) {
      return this.repository.list({ tenantId: input.tenantId, projectId: input.projectId });
    }

    const brokerAssignments = regularAssignments.filter(
      (assignment) => BROKER_ROLES.has(assignment.role) && Boolean(assignment.brokerCompanyId),
    );
    if (brokerAssignments.length > 0) {
      const wideAssignments = brokerAssignments.filter((assignment) => assignment.role !== 'BROKER_AGENT');
      const effectiveAssignments = wideAssignments.length > 0 ? wideAssignments : brokerAssignments;
      const brokerCompanyIds = [...new Set(effectiveAssignments.map((assignment) => assignment.brokerCompanyId!))];
      return this.repository.list({
        tenantId: input.tenantId,
        projectId: input.projectId,
        brokerCompanyIds,
        brokerAgentUserId: wideAssignments.length === 0 ? input.actorUserId : null,
      });
    }

    const selfAssignments = await this.access.matchingAssignments({
      userId: input.actorUserId,
      permission: 'eoi.read.self',
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

    throw new ForbiddenException('You do not have permission to view EOIs in this project.');
  }
}
