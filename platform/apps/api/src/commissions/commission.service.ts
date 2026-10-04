import { Injectable, NotFoundException } from '@nestjs/common';
import type {
  CommissionCaseSnapshot,
  CreateCommissionPlanInput,
  UpdateCommissionCaseStatusInput,
} from '@preneura/contracts/commissions';
import { AccessService } from '../access/access.service.js';
import { CommissionRepository } from './commission.repository.js';

@Injectable()
export class CommissionService {
  constructor(
    private readonly repository: CommissionRepository,
    private readonly access: AccessService,
  ) {}

  async createPlan(input: {
    actorUserId: string;
    data: CreateCommissionPlanInput;
  }): Promise<{ commissionPlanId: string; versionNumber: number }> {
    await this.access.assert({
      userId: input.actorUserId,
      permission: 'commission.plan.manage',
      context: {
        tenantId: input.data.tenantId,
        projectId: input.data.projectId,
        brokerCompanyId: input.data.brokerCompanyId,
      },
    });
    return this.repository.createPlan({ actorUserId: input.actorUserId, data: input.data, now: new Date() });
  }

  async listCases(input: {
    actorUserId: string;
    tenantId: string;
    projectId: string;
    brokerCompanyId: string;
  }): Promise<CommissionCaseSnapshot[]> {
    const context = {
      tenantId: input.tenantId,
      projectId: input.projectId,
      brokerCompanyId: input.brokerCompanyId,
    };
    const statusDecision = await this.access.assert({
      userId: input.actorUserId,
      permission: 'commission.status.read',
      context,
    });

    const now = new Date();
    await this.repository.syncBrokerCases({
      tenantId: input.tenantId,
      projectId: input.projectId,
      brokerCompanyId: input.brokerCompanyId,
      now,
    });
    const cases = await this.repository.listCases({
      tenantId: input.tenantId,
      projectId: input.projectId,
      brokerCompanyId: input.brokerCompanyId,
      brokerAgentUserId: statusDecision.role === 'BROKER_AGENT' ? input.actorUserId : null,
      now,
    });

    const [amountDecision, rateDecision] = await Promise.all([
      this.access.can({ userId: input.actorUserId, permission: 'commission.amount.read', context }),
      this.access.can({ userId: input.actorUserId, permission: 'commission.rate.read', context }),
    ]);

    return cases.map((commissionCase) => ({
      ...commissionCase,
      ...(amountDecision.allowed
        ? {
            basisAmount: commissionCase.basisAmount,
            commissionAmount: commissionCase.commissionAmount,
          }
        : {
            basisAmount: undefined,
            commissionAmount: undefined,
          }),
      ratePercent: rateDecision.allowed ? commissionCase.ratePercent : undefined,
    }));
  }

  async updateCaseStatus(input: {
    actorUserId: string;
    data: UpdateCommissionCaseStatusInput;
  }): Promise<{ updated: true }> {
    await this.access.assert({
      userId: input.actorUserId,
      permission: 'commission.payment.manage',
      context: {
        tenantId: input.data.tenantId,
        projectId: input.data.projectId,
        brokerCompanyId: input.data.brokerCompanyId,
      },
    });
    const updated = await this.repository.updateCaseStatus({
      actorUserId: input.actorUserId,
      data: input.data,
      now: new Date(),
    });
    if (!updated) throw new NotFoundException('Commission case not found.');
    return { updated: true };
  }

  async refreshTransactionCase(input: {
    tenantId: string;
    projectId: string;
    transactionId: string;
  }): Promise<void> {
    await this.repository.refreshTransactionCase({ ...input, now: new Date() });
  }
}
