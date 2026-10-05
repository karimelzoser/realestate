import { BadRequestException, Controller, Get, Param, UseGuards } from '@nestjs/common';
import type { DocumentTemplateSnapshot } from '@preneura/contracts/documents';
import type { ResolvedSession } from '../auth/auth.repository.js';
import { CurrentSession, SessionAuthGuard } from '../auth/session-auth.guard.js';
import { DocumentTemplateListService } from './document-template-list.service.js';

@UseGuards(SessionAuthGuard)
@Controller('tenants/:tenantId/projects/:projectId/document-templates')
export class DocumentTemplateListController {
  constructor(private readonly templates: DocumentTemplateListService) {}

  @Get('active')
  active(
    @Param('tenantId') tenantId: string,
    @Param('projectId') projectId: string,
    @CurrentSession() session: ResolvedSession,
  ): Promise<DocumentTemplateSnapshot[]> {
    this.assertUuid(tenantId, 'tenantId');
    this.assertUuid(projectId, 'projectId');
    return this.templates.listEffectiveActive({ actorUserId: session.userId, tenantId, projectId });
  }

  @Get()
  list(
    @Param('tenantId') tenantId: string,
    @Param('projectId') projectId: string,
    @CurrentSession() session: ResolvedSession,
  ): Promise<DocumentTemplateSnapshot[]> {
    this.assertUuid(tenantId, 'tenantId');
    this.assertUuid(projectId, 'projectId');
    return this.templates.list({ actorUserId: session.userId, tenantId, projectId });
  }

  private assertUuid(value: string, field: string): void {
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!uuid.test(value)) throw new BadRequestException(`Invalid ${field}.`);
  }
}
