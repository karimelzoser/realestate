import { Injectable, NotFoundException } from '@nestjs/common';
import type {
  CreateProjectInput,
  CreateTenantInput,
  PlatformControlPlaneSnapshot,
  PlatformProjectSnapshot,
  StartSupportAccessInput,
  SupportAccessSessionSnapshot,
} from '@preneura/contracts/platform-admin';
import { AccessService } from '../access/access.service.js';
import { PlatformAdminRepository } from './platform-admin.repository.js';

@Injectable()
export class PlatformAdminService {
  constructor(
    private readonly access: AccessService,
    private readonly repository: PlatformAdminRepository,
  ) {}

  async snapshot(userId: string): Promise<PlatformControlPlaneSnapshot> {
    await this.access.assert({ userId, permission: 'platform.tenants.read' });
    return this.repository.snapshot();
  }

  async projects(userId: string, tenantId: string): Promise<PlatformProjectSnapshot[]> {
    await this.access.assert({ userId, permission: 'platform.tenants.read' });
    return this.repository.listProjects(tenantId);
  }

  async createTenant(userId: string, input: CreateTenantInput): Promise<{ tenantId: string }> {
    await this.access.assert({ userId, permission: 'platform.tenants.manage' });
    return this.repository.createTenant(input, userId);
  }

  async createProject(userId: string, tenantId: string, input: CreateProjectInput): Promise<{ projectId: string }> {
    await this.access.assert({ userId, permission: 'platform.tenants.manage' });
    return this.repository.createProject(tenantId, input, userId);
  }

  async setTenantStatus(
    userId: string,
    tenantId: string,
    status: 'ACTIVE' | 'SUSPENDED' | 'ARCHIVED',
  ): Promise<{ updated: true }> {
    await this.access.assert({ userId, permission: 'platform.tenants.manage' });
    if (!await this.repository.setTenantStatus(tenantId, status, userId)) {
      throw new NotFoundException('Tenant not found.');
    }
    return { updated: true };
  }

  async setProjectStatus(
    userId: string,
    tenantId: string,
    projectId: string,
    status: 'DRAFT' | 'ACTIVE' | 'PAUSED' | 'CLOSED' | 'ARCHIVED',
  ): Promise<{ updated: true }> {
    await this.access.assert({ userId, permission: 'platform.tenants.manage' });
    if (!await this.repository.setProjectStatus(tenantId, projectId, status, userId)) {
      throw new NotFoundException('Project not found.');
    }
    return { updated: true };
  }

  async supportSessions(userId: string): Promise<SupportAccessSessionSnapshot[]> {
    await this.access.assert({ userId, permission: 'platform.support.access' });
    return this.repository.listSupportSessions(false);
  }

  async startSupportSession(
    userId: string,
    input: StartSupportAccessInput,
  ): Promise<SupportAccessSessionSnapshot> {
    await this.access.assert({ userId, permission: 'platform.support.access' });
    return this.repository.startSupportSession({
      operatorUserId: userId,
      tenantId: input.tenantId,
      projectId: input.projectId ?? null,
      reason: input.reason,
      durationMinutes: input.durationMinutes,
    });
  }

  async endSupportSession(userId: string, sessionId: string): Promise<{ ended: true }> {
    await this.access.assert({ userId, permission: 'platform.support.access' });
    if (!await this.repository.endSupportSession(userId, sessionId)) {
      throw new NotFoundException('Active support session not found.');
    }
    return { ended: true };
  }
}
