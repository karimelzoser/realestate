import { Injectable, NotFoundException } from '@nestjs/common';
import type {
  ManagementProjectOverviewSnapshot,
  ManagementTenantOverviewSnapshot,
} from '@preneura/contracts/management';
import { AccessService } from '../access/access.service.js';
import { TransactionOperationsService } from '../sales/transaction-operations.service.js';
import { ManagementRepository } from './management.repository.js';
import { ManagementTenantRepository } from './management-tenant.repository.js';

@Injectable()
export class ManagementService {
  constructor(
    private readonly repository: ManagementRepository,
    private readonly tenantRepository: ManagementTenantRepository,
    private readonly access: AccessService,
    private readonly transactionOperations: TransactionOperationsService,
  ) {}

  async overview(input: {
    actorUserId: string;
    tenantId: string;
    projectId: string;
  }): Promise<ManagementProjectOverviewSnapshot> {
    if (!(await this.repository.projectExists(input.tenantId, input.projectId))) {
      throw new NotFoundException('Project not found.');
    }

    await this.access.assert({
      userId: input.actorUserId,
      permission: 'project.manage',
      context: { tenantId: input.tenantId, projectId: input.projectId },
    });

    const now = new Date();
    const [core, completion] = await Promise.all([
      this.repository.overview({ tenantId: input.tenantId, projectId: input.projectId, now }),
      this.transactionOperations.queue({
        actorUserId: input.actorUserId,
        tenantId: input.tenantId,
        projectId: input.projectId,
      }),
    ]);

    return {
      generatedAt: now.toISOString(),
      ...core,
      completionBacklog: completion.counts,
    };
  }

  async tenantOverview(input: {
    actorUserId: string;
    tenantId: string;
  }): Promise<ManagementTenantOverviewSnapshot> {
    await this.access.assert({
      userId: input.actorUserId,
      permission: 'tenant.projects.manage',
      context: { tenantId: input.tenantId },
    });

    const context = await this.tenantRepository.context(input.tenantId);
    if (!context) throw new NotFoundException('Tenant not found.');

    const projects = await Promise.all(
      context.projects.map(async (project) => ({
        ...project,
        overview: await this.overview({
          actorUserId: input.actorUserId,
          tenantId: input.tenantId,
          projectId: project.projectId,
        }),
      })),
    );

    return {
      generatedAt: new Date().toISOString(),
      tenantId: input.tenantId,
      tenantName: context.tenantName,
      totals: {
        projectCount: projects.length,
        activeProjects: projects.filter((project) => project.projectStatus === 'ACTIVE').length,
        availableCapacity: projects.reduce((sum, project) => sum + project.overview.inventory.available, 0),
        queueWaiting: projects.reduce((sum, project) => sum + project.overview.allocation.waiting, 0),
        openTransactions: projects.reduce((sum, project) => sum + project.overview.transactions.open, 0),
        readyForCompletion: projects.reduce((sum, project) => sum + project.overview.transactions.readyForCompletion, 0),
        overdueItems: projects.reduce((sum, project) => sum + project.overview.finance.overdueItems, 0),
        commissionOverdueCases: projects.reduce((sum, project) => sum + project.overview.commissions.overdue, 0),
        failedNotifications: projects.reduce((sum, project) => sum + project.overview.notifications.failed, 0),
      },
      projects,
    };
  }
}
