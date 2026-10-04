import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  roleHasPermission,
  type PermissionCode,
  type WorkspaceContextSnapshot,
} from '@preneura/contracts/access';
import { AccessRepository, type RoleAssignment } from './access.repository.js';

export interface AccessContext {
  tenantId?: string;
  projectId?: string;
  brokerCompanyId?: string;
  resourceOwnerUserId?: string;
}

export interface AccessDecision {
  allowed: boolean;
  assignmentId?: string;
  role?: RoleAssignment['role'];
}

@Injectable()
export class AccessService {
  constructor(private readonly repository: AccessRepository) {}

  async can(input: {
    userId: string;
    permission: PermissionCode;
    context?: AccessContext;
  }): Promise<AccessDecision> {
    const context = input.context ?? {};

    if (
      input.permission.endsWith('.self') &&
      context.resourceOwnerUserId !== input.userId
    ) {
      return { allowed: false };
    }

    const assignments = await this.repository.listActiveAssignments(input.userId);
    for (const assignment of assignments) {
      if (!roleHasPermission(assignment.role, input.permission)) continue;
      if (await this.scopeMatches(assignment, context)) {
        return {
          allowed: true,
          assignmentId: assignment.id,
          role: assignment.role,
        };
      }
    }

    return { allowed: false };
  }

  async assert(input: {
    userId: string;
    permission: PermissionCode;
    context?: AccessContext;
  }): Promise<AccessDecision> {
    const decision = await this.can(input);
    if (!decision.allowed) {
      throw new ForbiddenException('You do not have permission for this action.');
    }
    return decision;
  }

  async assignmentsForUser(userId: string): Promise<RoleAssignment[]> {
    return this.repository.listActiveAssignments(userId);
  }

  async workspaceContext(userId: string): Promise<WorkspaceContextSnapshot> {
    const context = await this.repository.workspaceContext(userId, new Date());
    if (!context) throw new NotFoundException('Active user not found.');
    return context;
  }

  private async scopeMatches(
    assignment: RoleAssignment,
    context: AccessContext,
  ): Promise<boolean> {
    switch (assignment.scopeType) {
      case 'PLATFORM':
        return true;

      case 'TENANT':
        return Boolean(
          context.tenantId && assignment.tenantId === context.tenantId,
        );

      case 'PROJECT':
        return Boolean(
          context.tenantId &&
            context.projectId &&
            assignment.tenantId === context.tenantId &&
            assignment.projectId === context.projectId,
        );

      case 'BROKER_COMPANY': {
        if (!context.tenantId || assignment.tenantId !== context.tenantId) {
          return false;
        }
        if (!assignment.brokerCompanyId) return false;
        if (
          context.brokerCompanyId &&
          assignment.brokerCompanyId !== context.brokerCompanyId
        ) {
          return false;
        }
        if (!context.projectId) return true;

        return this.repository.brokerCompanyCanAccessProject({
          tenantId: context.tenantId,
          brokerCompanyId: assignment.brokerCompanyId,
          projectId: context.projectId,
          at: new Date(),
        });
      }
    }
  }
}
