import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type {
  BrokerageAgreementInput,
  BrokerageAttributionReviewInput,
  BrokerageAttributionTransferInput,
  BrokerageOnboardingSnapshot,
  BrokerageOrganizationInput,
  BrokerageProjectAccessInput,
} from '@preneura/contracts/brokerage-onboarding';
import { AccessService } from '../access/access.service.js';
import { BrokerageOnboardingRepository } from './brokerage-onboarding.repository.js';

@Injectable()
export class BrokerageOnboardingService {
  constructor(
    private readonly repository: BrokerageOnboardingRepository,
    private readonly access: AccessService,
  ) {}

  async workspace(actorUserId: string, tenantId: string): Promise<BrokerageOnboardingSnapshot> {
    const tenantAdmin = await this.access.can({
      userId: actorUserId,
      permission: 'tenant.projects.manage',
      context: { tenantId },
    });
    if (tenantAdmin.allowed) return this.repository.workspace(tenantId, null);

    const brokerCompanyIds = await this.brokerManagerCompanies(actorUserId, tenantId);
    if (brokerCompanyIds.length === 0) {
      throw new ForbiddenException('Brokerage administration is not available for this account.');
    }
    return this.repository.workspace(tenantId, brokerCompanyIds);
  }

  async upsertOrganization(input: {
    actorUserId: string; tenantId: string; data: BrokerageOrganizationInput;
  }): Promise<BrokerageOnboardingSnapshot> {
    await this.assertTenantAdmin(input.actorUserId, input.tenantId);
    try {
      await this.repository.upsertOrganization(input);
    } catch (error) {
      if (error instanceof Error && error.message.includes('BROKERAGE_CODE_NAME_MISMATCH')) {
        throw new BadRequestException('This brokerage code already belongs to a different organization name.');
      }
      throw error;
    }
    return this.repository.workspace(input.tenantId, null);
  }

  async createAgreement(input: {
    actorUserId: string; tenantId: string; data: BrokerageAgreementInput;
  }): Promise<{ agreementId: string; onboarding: BrokerageOnboardingSnapshot }> {
    await this.assertTenantAdmin(input.actorUserId, input.tenantId);
    const from = new Date(input.data.effectiveFrom);
    const to = input.data.effectiveTo ? new Date(input.data.effectiveTo) : null;
    if (to && to <= from) throw new BadRequestException('Agreement end must be after its start.');
    let agreementId: string;
    try {
      agreementId = await this.repository.createAgreement(input);
    } catch (error) {
      if (error instanceof Error && error.message.includes('BROKERAGE_NOT_LINKED_TO_TENANT')) {
        throw new NotFoundException('Brokerage is not linked to this developer.');
      }
      throw error;
    }
    return { agreementId, onboarding: await this.repository.workspace(input.tenantId, null) };
  }

  async activateAgreement(input: {
    actorUserId: string; tenantId: string; agreementId: string;
  }): Promise<BrokerageOnboardingSnapshot> {
    await this.assertTenantAdmin(input.actorUserId, input.tenantId);
    const activated = await this.repository.activateAgreement(input);
    if (!activated) throw new NotFoundException('Draft or suspended brokerage agreement was not found.');
    return this.repository.workspace(input.tenantId, null);
  }

  async setProjectAccess(input: {
    actorUserId: string; tenantId: string; agreementId: string; projectId: string; data: BrokerageProjectAccessInput;
  }): Promise<BrokerageOnboardingSnapshot> {
    await this.access.assert({
      userId: input.actorUserId,
      permission: 'tenant.projects.manage',
      context: { tenantId: input.tenantId, projectId: input.projectId },
    });
    const from = new Date(input.data.effectiveFrom);
    const to = input.data.effectiveTo ? new Date(input.data.effectiveTo) : null;
    if (to && to <= from) throw new BadRequestException('Project access end must be after its start.');
    const updated = await this.repository.setProjectAccess(input);
    if (!updated) throw new NotFoundException('Active brokerage agreement or project was not found.');
    return this.repository.workspace(input.tenantId, null);
  }

  async requestTransfer(input: {
    actorUserId: string; tenantId: string; data: BrokerageAttributionTransferInput;
  }): Promise<{ transferId: string }> {
    const current = await this.repository.buyerAttribution(input.tenantId, input.data.buyerProfileId);
    if (!current) throw new NotFoundException('Buyer profile was not found.');
    if (current.brokerCompanyId === input.data.toBrokerCompanyId &&
        current.brokerAgentUserId === (input.data.toBrokerAgentUserId ?? null)) {
      throw new BadRequestException('Buyer already has this brokerage attribution.');
    }

    const targetEligible = await this.repository.targetEligible({
      tenantId: input.tenantId,
      projectId: input.data.projectId,
      brokerCompanyId: input.data.toBrokerCompanyId,
      brokerAgentUserId: input.data.toBrokerAgentUserId ?? null,
    });
    if (!targetEligible) {
      throw new BadRequestException('Target brokerage or agent is not active for this project.');
    }

    const developer = await this.access.can({
      userId: input.actorUserId,
      permission: 'buyers.manage',
      context: { tenantId: input.tenantId, projectId: input.data.projectId },
    });
    if (!developer.allowed) {
      const managedCompanies = await this.brokerManagerCompanies(input.actorUserId, input.tenantId);
      const sameBrokerageReassignment = current.brokerCompanyId !== null &&
        current.brokerCompanyId === input.data.toBrokerCompanyId &&
        managedCompanies.includes(current.brokerCompanyId);
      if (!sameBrokerageReassignment) {
        throw new ForbiddenException('Only developer management can request cross-brokerage attribution transfer.');
      }
    }

    try {
      const transferId = await this.repository.createTransfer({
        ...input,
        fromBrokerCompanyId: current.brokerCompanyId,
        fromBrokerAgentUserId: current.brokerAgentUserId,
      });
      return { transferId };
    } catch (error) {
      if (error instanceof Error && error.message.includes('brokerage_attribution_transfers_one_pending')) {
        throw new BadRequestException('Buyer already has a pending attribution transfer.');
      }
      throw error;
    }
  }

  async reviewTransfer(input: {
    actorUserId: string; tenantId: string; transferId: string; data: BrokerageAttributionReviewInput;
  }): Promise<BrokerageOnboardingSnapshot> {
    const transfer = await this.repository.transfer(input.tenantId, input.transferId);
    if (!transfer) throw new NotFoundException('Attribution transfer was not found.');
    await this.access.assert({
      userId: input.actorUserId,
      permission: 'buyers.manage',
      context: { tenantId: input.tenantId, projectId: transfer.projectId },
    });
    try {
      const reviewed = await this.repository.reviewTransfer({
        tenantId: input.tenantId,
        transferId: input.transferId,
        actorUserId: input.actorUserId,
        decision: input.data.decision,
        note: input.data.note ?? null,
      });
      if (!reviewed) throw new NotFoundException('Pending attribution transfer was not found.');
    } catch (error) {
      if (error instanceof Error && (
        error.message.includes('buyer attribution changed after transfer request') ||
        error.message.includes('target brokerage has no active agreement') ||
        error.message.includes('target broker agent is not active')
      )) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }
    return this.repository.workspace(input.tenantId, null);
  }

  private async assertTenantAdmin(actorUserId: string, tenantId: string): Promise<void> {
    await this.access.assert({
      userId: actorUserId,
      permission: 'tenant.projects.manage',
      context: { tenantId },
    });
  }

  private async brokerManagerCompanies(actorUserId: string, tenantId: string): Promise<string[]> {
    const assignments = await this.access.assignmentsForUser(actorUserId);
    return [...new Set(assignments
      .filter((assignment) =>
        assignment.tenantId === tenantId &&
        assignment.role === 'BROKER_MANAGER' &&
        assignment.brokerCompanyId,
      )
      .map((assignment) => assignment.brokerCompanyId!))];
  }
}
