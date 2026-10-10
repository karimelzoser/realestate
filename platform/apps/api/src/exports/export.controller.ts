import { BadRequestException, Controller, Get, Param, Res, UseGuards } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import type { ResolvedSession } from '../auth/auth.repository.js';
import { CurrentSession, SessionAuthGuard } from '../auth/session-auth.guard.js';
import { EXPORT_DATASETS, ExportService, type ExportDataset } from './export.service.js';

@UseGuards(SessionAuthGuard)
@Controller('tenants/:tenantId/projects/:projectId/exports')
export class ExportController {
  constructor(private readonly exports: ExportService) {}

  @Get()
  available(
    @Param('tenantId') tenantId: string,
    @Param('projectId') projectId: string,
    @CurrentSession() session: ResolvedSession,
  ) {
    this.assertUuid(tenantId, 'tenantId');
    this.assertUuid(projectId, 'projectId');
    return this.exports.available({ actorUserId: session.userId, tenantId, projectId });
  }

  @Get(':dataset')
  async download(
    @Param('tenantId') tenantId: string,
    @Param('projectId') projectId: string,
    @Param('dataset') datasetValue: string,
    @CurrentSession() session: ResolvedSession,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<string> {
    this.assertUuid(tenantId, 'tenantId');
    this.assertUuid(projectId, 'projectId');
    const dataset = this.assertDataset(datasetValue);
    const result = await this.exports.exportCsv({ actorUserId: session.userId, tenantId, projectId, dataset });
    reply.header('content-type', 'text/csv; charset=utf-8');
    reply.header('content-disposition', `attachment; filename="${result.filename}"`);
    reply.header('x-export-row-count', String(result.rowCount));
    reply.header('cache-control', 'private, no-store');
    return result.csv;
  }

  private assertDataset(value: string): ExportDataset {
    if (!(EXPORT_DATASETS as readonly string[]).includes(value)) {
      throw new BadRequestException('Unknown export dataset.');
    }
    return value as ExportDataset;
  }

  private assertUuid(value: string, field: string): void {
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!uuid.test(value)) throw new BadRequestException(`Invalid ${field}.`);
  }
}
