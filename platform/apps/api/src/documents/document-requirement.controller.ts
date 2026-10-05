import { BadRequestException, Body, Controller, Delete, Get, Param, Put, UseGuards } from '@nestjs/common';
import {
  documentCategorySchema,
  upsertProjectDocumentRequirementSchema,
  type ProjectDocumentRequirementSnapshot,
} from '@preneura/contracts/documents';
import type { ResolvedSession } from '../auth/auth.repository.js';
import { CurrentSession, SessionAuthGuard } from '../auth/session-auth.guard.js';
import { DocumentRequirementService } from './document-requirement.service.js';

@UseGuards(SessionAuthGuard)
@Controller('tenants/:tenantId/projects/:projectId/document-requirements')
export class DocumentRequirementController {
  constructor(private readonly requirements: DocumentRequirementService) {}

  @Get()
  list(
    @Param('tenantId') tenantId: string,
    @Param('projectId') projectId: string,
    @CurrentSession() session: ResolvedSession,
  ): Promise<ProjectDocumentRequirementSnapshot[]> {
    this.assertUuid(tenantId, 'tenantId');
    this.assertUuid(projectId, 'projectId');
    return this.requirements.list({ actorUserId: session.userId, tenantId, projectId });
  }

  @Put(':category')
  upsert(
    @Param('tenantId') tenantId: string,
    @Param('projectId') projectId: string,
    @Param('category') category: string,
    @Body() body: unknown,
    @CurrentSession() session: ResolvedSession,
  ): Promise<ProjectDocumentRequirementSnapshot> {
    const parsed = upsertProjectDocumentRequirementSchema.safeParse({
      ...this.objectBody(body),
      tenantId,
      projectId,
      category,
    });
    if (!parsed.success) throw new BadRequestException('Invalid document requirement.');
    return this.requirements.upsert({ actorUserId: session.userId, data: parsed.data });
  }

  @Delete(':category')
  remove(
    @Param('tenantId') tenantId: string,
    @Param('projectId') projectId: string,
    @Param('category') category: string,
    @CurrentSession() session: ResolvedSession,
  ): Promise<{ removed: true }> {
    this.assertUuid(tenantId, 'tenantId');
    this.assertUuid(projectId, 'projectId');
    const parsedCategory = documentCategorySchema.safeParse(category);
    if (!parsedCategory.success) throw new BadRequestException('Invalid document category.');
    return this.requirements.remove({
      actorUserId: session.userId,
      tenantId,
      projectId,
      category: parsedCategory.data,
    });
  }

  private objectBody(body: unknown): Record<string, unknown> {
    return body && typeof body === 'object' && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : {};
  }

  private assertUuid(value: string, field: string): void {
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!uuid.test(value)) throw new BadRequestException(`Invalid ${field}.`);
  }
}
