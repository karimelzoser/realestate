import { Injectable, NotFoundException } from '@nestjs/common';
import type {
  CreateSettlementInput,
  SettlementProviderEventInput,
  SettlementSnapshot,
  SubmitSettlementInput,
} from '@preneura/contracts/settlements';
import { AccessService } from '../access/access.service.js';
import { SettlementRepository } from './settlement.repository.js';

@Injectable()
export class SettlementService {
  constructor(
    private readonly repository: SettlementRepository,
    private readonly access: AccessService,
  ) {}

  async createRefund(input: {
    actorUserId: string;
    tenantId: string;
    projectId: string;
    refundRequestId: string;
    data: CreateSettlementInput;
  }): Promise<SettlementSnapshot> {
    await this.access.assert({
      userId: input.actorUserId,
      permission: 'refund.payout.manage',
      context: { tenantId: input.tenantId, projectId: input.projectId },
    });
    const settlementId = await this.repository.createEoiRefund({
      tenantId: input.tenantId,
      projectId: input.projectId,
      refundRequestId: input.refundRequestId,
      actorUserId: input.actorUserId,
      idempotencyKey: input.data.idempotencyKey,
    });
    return this.repository.snapshot(settlementId);
  }

  async createCommission(input: {
    actorUserId: string;
    tenantId: string;
    projectId: string;
    brokerCompanyId: string;
    commissionCaseId: string;
    data: CreateSettlementInput;
  }): Promise<SettlementSnapshot> {
    await this.access.assert({
      userId: input.actorUserId,
      permission: 'commission.payment.manage',
      context: {
        tenantId: input.tenantId,
        projectId: input.projectId,
        brokerCompanyId: input.brokerCompanyId,
      },
    });
    const settlementId = await this.repository.createCommission({
      tenantId: input.tenantId,
      projectId: input.projectId,
      brokerCompanyId: input.brokerCompanyId,
      commissionCaseId: input.commissionCaseId,
      actorUserId: input.actorUserId,
      idempotencyKey: input.data.idempotencyKey,
    });
    return this.repository.snapshot(settlementId);
  }

  async get(input: {
    actorUserId: string;
    tenantId: string;
    projectId: string;
    settlementId: string;
  }): Promise<SettlementSnapshot> {
    const context = await this.requireContext(input);
    if (context.settlementType === 'EOI_REFUND') {
      const read = await this.access.can({
        userId: input.actorUserId,
        permission: 'refund.read',
        context: { tenantId: input.tenantId, projectId: input.projectId },
      });
      if (!read.allowed) {
        await this.access.assert({
          userId: input.actorUserId,
          permission: 'refund.payout.manage',
          context: { tenantId: input.tenantId, projectId: input.projectId },
        });
      }
    } else {
      await this.access.assert({
        userId: input.actorUserId,
        permission: 'commission.status.read',
        context: {
          tenantId: input.tenantId,
          projectId: input.projectId,
          ...(context.brokerCompanyId ? { brokerCompanyId: context.brokerCompanyId } : {}),
        },
      });
    }
    return this.repository.snapshot(input.settlementId);
  }

  async submit(input: {
    actorUserId: string;
    tenantId: string;
    projectId: string;
    settlementId: string;
    data: SubmitSettlementInput;
  }): Promise<SettlementSnapshot> {
    const context = await this.requireContext(input);
    await this.access.assert({
      userId: input.actorUserId,
      permission: context.settlementType === 'EOI_REFUND' ? 'refund.payout.manage' : 'commission.payment.manage',
      context: {
        tenantId: input.tenantId,
        projectId: input.projectId,
        ...(context.brokerCompanyId ? { brokerCompanyId: context.brokerCompanyId } : {}),
      },
    });
    await this.repository.submit({
      settlementId: input.settlementId,
      actorUserId: input.actorUserId,
      provider: input.data.provider,
      providerReference: input.data.providerReference,
    });
    return this.repository.snapshot(input.settlementId);
  }

  ingestProvider(input: {
    provider: string;
    contentHashHex: string;
    data: SettlementProviderEventInput;
  }): Promise<SettlementSnapshot> {
    return this.repository.ingestProvider({
      provider: input.provider,
      providerEventId: input.data.providerEventId,
      contentHashHex: input.contentHashHex,
      settlementId: input.data.settlementId,
      eventType: input.data.eventType,
      providerReference: input.data.providerReference,
      occurredAt: new Date(input.data.occurredAt),
    });
  }

  private async requireContext(input: {
    tenantId: string;
    projectId: string;
    settlementId: string;
  }): Promise<{
    settlementType: 'EOI_REFUND' | 'BROKER_COMMISSION';
    brokerCompanyId: string | null;
  }> {
    const context = await this.repository.context(input.settlementId);
    if (!context || context.tenant_id !== input.tenantId || context.project_id !== input.projectId) {
      throw new NotFoundException('Settlement not found.');
    }
    return {
      settlementType: context.settlement_type,
      brokerCompanyId: context.broker_company_id,
    };
  }
}
