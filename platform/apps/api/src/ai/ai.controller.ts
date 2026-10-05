import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  aiProjectSettingsInputSchema,
  buyerRecommendationRequestSchema,
  managerInsightRequestSchema,
  type AiProjectSettingsSnapshot,
  type BuyerRecommendationResponse,
  type ManagerInsightResponse,
} from '@preneura/contracts/ai';
import type { ResolvedSession } from '../auth/auth.repository.js';
import { CurrentSession, SessionAuthGuard } from '../auth/session-auth.guard.js';
import { AiService } from './ai.service.js';

@UseGuards(SessionAuthGuard)
@Controller('tenants/:tenantId/projects/:projectId/ai')
export class AiController {
  constructor(private readonly ai: AiService) {}

  @Get('settings')
  settings(
    @Param('tenantId') tenantId: string,
    @Param('projectId') projectId: string,
    @CurrentSession() session: ResolvedSession,
  ): Promise<AiProjectSettingsSnapshot> {
    this.assertUuid(tenantId, 'tenantId');
    this.assertUuid(projectId, 'projectId');
    return this.ai.settings({ actorUserId: session.userId, tenantId, projectId });
  }

  @Patch('settings')
  updateSettings(
    @Param('tenantId') tenantId: string,
    @Param('projectId') projectId: string,
    @Body() body: unknown,
    @CurrentSession() session: ResolvedSession,
  ): Promise<AiProjectSettingsSnapshot> {
    this.assertUuid(tenantId, 'tenantId');
    this.assertUuid(projectId, 'projectId');
    const parsed = aiProjectSettingsInputSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Invalid AI project settings.');
    return this.ai.updateSettings({
      actorUserId: session.userId,
      tenantId,
      projectId,
      settings: parsed.data,
    });
  }

  @Post('recommendations')
  recommend(
    @Param('tenantId') tenantId: string,
    @Param('projectId') projectId: string,
    @Body() body: unknown,
    @CurrentSession() session: ResolvedSession,
  ): Promise<BuyerRecommendationResponse> {
    this.assertUuid(tenantId, 'tenantId');
    this.assertUuid(projectId, 'projectId');
    const parsed = buyerRecommendationRequestSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Invalid buyer recommendation preferences.');
    return this.ai.recommend({
      actorUserId: session.userId,
      tenantId,
      projectId,
      preferences: parsed.data,
    });
  }

  @Post('manager-insight')
  managerInsight(
    @Param('tenantId') tenantId: string,
    @Param('projectId') projectId: string,
    @Body() body: unknown,
    @CurrentSession() session: ResolvedSession,
  ): Promise<ManagerInsightResponse> {
    this.assertUuid(tenantId, 'tenantId');
    this.assertUuid(projectId, 'projectId');
    const parsed = managerInsightRequestSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Invalid manager insight question.');
    return this.ai.managerInsight({
      actorUserId: session.userId,
      tenantId,
      projectId,
      question: parsed.data.question,
    });
  }

  private assertUuid(value: string, field: string): void {
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!uuid.test(value)) throw new BadRequestException(`Invalid ${field}.`);
  }
}
