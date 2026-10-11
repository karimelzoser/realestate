import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { CreateBuyerEoiInput } from '@preneura/contracts/sales';
import { AccessService } from '../access/access.service.js';
import { EoiWriteRepository } from './eoi-write.repository.js';
import { SalesRepository } from './sales.repository.js';

@Injectable()
export class EoiCommandService {
  constructor(
    private readonly salesRepository: SalesRepository,
    private readonly eoiWrite: EoiWriteRepository,
    private readonly access: AccessService,
  ) {}

  async create(input: {
    actorUserId: string;
    data: CreateBuyerEoiInput;
  }): Promise<{ eoiId: string; amount: string; currency: string }> {
    if (!(await this.salesRepository.projectExists(input.data.tenantId, input.data.projectId))) {
      throw new NotFoundException('Project not found.');
    }

    const buyer = await this.salesRepository.getBuyerProfile({
      tenantId: input.data.tenantId,
      buyerProfileId: input.data.buyerProfileId,
    });
    if (!buyer) throw new NotFoundException('Buyer profile not found.');

    if (buyer.userId === input.actorUserId) {
      await this.access.assert({
        userId: input.actorUserId,
        permission: 'eoi.manage.self',
        context: {
          tenantId: input.data.tenantId,
          projectId: input.data.projectId,
          resourceOwnerUserId: buyer.userId,
        },
      });
    } else if (buyer.source === 'BROKER' && buyer.brokerCompanyId) {
      const brokerAssignments = await this.access.matchingAssignments({
        userId: input.actorUserId,
        permission: 'eoi.manage',
        context: {
          tenantId: input.data.tenantId,
          projectId: input.data.projectId,
          brokerCompanyId: buyer.brokerCompanyId,
        },
      });
      if (brokerAssignments.length === 0) {
        throw new ForbiddenException('Actor cannot create an EOI for this broker-attributed buyer.');
      }
      if (
        brokerAssignments.every((assignment) => assignment.role === 'BROKER_AGENT') &&
        buyer.brokerAgentUserId !== input.actorUserId
      ) {
        throw new ForbiddenException('Broker agents may create EOIs only for their attributed buyers.');
      }
    } else {
      await this.access.assert({
        userId: input.actorUserId,
        permission: 'eoi.manage',
        context: { tenantId: input.data.tenantId, projectId: input.data.projectId },
      });
    }

    return this.eoiWrite.create({ actorUserId: input.actorUserId, data: input.data, now: new Date() });
  }
}
