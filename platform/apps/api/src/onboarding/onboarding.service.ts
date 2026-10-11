import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  BootstrapOperationsDirectorInput,
  DeveloperOnboardingSnapshot,
  ProjectBrandingInput,
  TenantBrandingInput,
} from '@preneura/contracts/onboarding';
import type { ProvisionedAccountSnapshot } from '@preneura/contracts/accounts';
import type { CreateProjectInput } from '@preneura/contracts/platform-admin';
import { AccessService } from '../access/access.service.js';
import { AccountBootstrapService } from '../accounts/account-bootstrap.service.js';
import { OnboardingProjectRepository } from './onboarding-project.repository.js';
import { OnboardingRepository } from './onboarding.repository.js';

@Injectable()
export class OnboardingService {
  constructor(
    private readonly repository: OnboardingRepository,
    private readonly projects: OnboardingProjectRepository,
    private readonly access: AccessService,
    private readonly accountBootstrap: AccountBootstrapService,
  ) {}

  async snapshot(actorUserId: string, tenantId: string): Promise<DeveloperOnboardingSnapshot> {
    await this.assertCanRead(actorUserId, tenantId);
    return this.requireSnapshot(tenantId);
  }

  async updateTenantBranding(
    actorUserId: string,
    tenantId: string,
    data: TenantBrandingInput,
  ): Promise<DeveloperOnboardingSnapshot> {
    await this.assertCanManageTenant(actorUserId, tenantId);
    await this.requireSnapshot(tenantId);
    await this.repository.upsertTenantBranding({ tenantId, actorUserId, data });
    return this.requireSnapshot(tenantId);
  }

  async createProject(
    actorUserId: string,
    tenantId: string,
    data: CreateProjectInput,
  ): Promise<{ projectId: string; onboarding: DeveloperOnboardingSnapshot }> {
    await this.assertCanManageTenant(actorUserId, tenantId);
    await this.requireSnapshot(tenantId);
    const created = await this.projects.createProject({ tenantId, actorUserId, data });
    return { ...created, onboarding: await this.requireSnapshot(tenantId) };
  }

  async setProjectStatus(
    actorUserId: string,
    tenantId: string,
    projectId: string,
    status: 'DRAFT' | 'ACTIVE' | 'PAUSED' | 'CLOSED' | 'ARCHIVED',
  ): Promise<DeveloperOnboardingSnapshot> {
    await this.assertCanManageTenant(actorUserId, tenantId);
    if (!await this.projects.setProjectStatus({ tenantId, projectId, actorUserId, status })) {
      throw new NotFoundException('Project not found in this tenant.');
    }
    return this.requireSnapshot(tenantId);
  }

  async updateProjectBranding(
    actorUserId: string,
    tenantId: string,
    projectId: string,
    data: ProjectBrandingInput,
  ): Promise<DeveloperOnboardingSnapshot> {
    await this.assertCanManageProject(actorUserId, tenantId, projectId);
    if (!await this.repository.upsertProjectBranding({ tenantId, projectId, actorUserId, data })) {
      throw new NotFoundException('Project not found in this tenant.');
    }
    return this.requireSnapshot(tenantId);
  }

  async bootstrapOperationsDirector(
    actorUserId: string,
    tenantId: string,
    data: BootstrapOperationsDirectorInput,
  ): Promise<ProvisionedAccountSnapshot & { verificationDispatched: boolean }> {
    await this.access.assert({ userId: actorUserId, permission: 'platform.tenants.manage' });
    const snapshot = await this.requireSnapshot(tenantId);
    if (snapshot.staff.operationsDirectors > 0) {
      throw new ConflictException(
        'The tenant already has an Operations Director. Use Account Center for subsequent staff administration.',
      );
    }

    const provisioned = await this.accountBootstrap.provisionOperationsDirector({
      actorUserId,
      tenantId,
      data,
    });
    await this.repository.recordOperationsDirectorInvited({
      tenantId,
      actorUserId,
      userId: provisioned.userId,
    });
    return provisioned;
  }

  async complete(actorUserId: string, tenantId: string): Promise<DeveloperOnboardingSnapshot> {
    await this.assertCanManageTenant(actorUserId, tenantId);
    const before = await this.requireSnapshot(tenantId);
    if (!before.readiness.ready) {
      throw new ConflictException({
        message: 'Developer onboarding prerequisites are incomplete.',
        readiness: before.readiness,
      });
    }
    if (!await this.repository.complete(tenantId, actorUserId)) {
      throw new ConflictException('Developer onboarding could not be completed.');
    }
    return this.requireSnapshot(tenantId);
  }

  private async requireSnapshot(tenantId: string): Promise<DeveloperOnboardingSnapshot> {
    const snapshot = await this.repository.snapshot(tenantId);
    if (!snapshot) throw new NotFoundException('Tenant not found.');
    return snapshot;
  }

  private async assertCanRead(userId: string, tenantId: string): Promise<void> {
    if ((await this.access.can({ userId, permission: 'platform.tenants.read' })).allowed) return;
    await this.access.assert({ userId, permission: 'tenant.read', context: { tenantId } });
  }

  private async assertCanManageTenant(userId: string, tenantId: string): Promise<void> {
    if ((await this.access.can({ userId, permission: 'platform.tenants.manage' })).allowed) return;
    const tenantManagement = await this.access.can({
      userId,
      permission: 'tenant.projects.manage',
      context: { tenantId },
    });
    if (!tenantManagement.allowed) {
      throw new ForbiddenException('You do not have developer onboarding authority for this tenant.');
    }
  }

  private async assertCanManageProject(userId: string, tenantId: string, projectId: string): Promise<void> {
    if ((await this.access.can({ userId, permission: 'platform.tenants.manage' })).allowed) return;
    if ((await this.access.can({
      userId,
      permission: 'tenant.projects.manage',
      context: { tenantId },
    })).allowed) return;
    await this.access.assert({
      userId,
      permission: 'project.manage',
      context: { tenantId, projectId },
    });
  }
}
