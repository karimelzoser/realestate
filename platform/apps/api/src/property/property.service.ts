import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { BuyerPropertyPortfolioSnapshot } from '@preneura/contracts/property';
import { AccessService } from '../access/access.service.js';
import { PropertyRepository } from './property.repository.js';

@Injectable()
export class PropertyService {
  constructor(
    private readonly repository: PropertyRepository,
    private readonly access: AccessService,
  ) {}

  async getBuyerPortfolio(input: {
    actorUserId: string;
    tenantId: string;
    projectId: string;
  }): Promise<BuyerPropertyPortfolioSnapshot> {
    if (!(await this.repository.projectExists(input.tenantId, input.projectId))) {
      throw new NotFoundException('Project not found.');
    }

    const context = {
      tenantId: input.tenantId,
      projectId: input.projectId,
      resourceOwnerUserId: input.actorUserId,
    };
    const [propertyAssignments, installmentAssignments] = await Promise.all([
      this.access.matchingAssignments({
        userId: input.actorUserId,
        permission: 'property.read.self',
        context,
      }),
      this.access.matchingAssignments({
        userId: input.actorUserId,
        permission: 'installment.read.self',
        context,
      }),
    ]);

    if (propertyAssignments.length === 0) {
      throw new ForbiddenException('You do not have permission to view this property portfolio.');
    }
    if (installmentAssignments.length === 0) {
      throw new ForbiddenException('You do not have permission to view installment information.');
    }

    const generatedAt = new Date();
    const properties = await this.repository.listBuyerProperties({
      tenantId: input.tenantId,
      projectId: input.projectId,
      buyerUserId: input.actorUserId,
      now: generatedAt,
    });

    return {
      tenantId: input.tenantId,
      projectId: input.projectId,
      buyerUserId: input.actorUserId,
      generatedAt: generatedAt.toISOString(),
      properties,
    };
  }
}
