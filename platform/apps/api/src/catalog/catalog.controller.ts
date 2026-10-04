import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  addInventoryCapacitySchema,
  createInventoryLockSchema,
  createPricingVersionSchema,
  createUnitTypeSchema,
  publishPricingVersionSchema,
  releaseInventoryLockSchema,
  type UnitTypeCommercialSnapshot,
} from '@preneura/contracts/catalog';
import type { ResolvedSession } from '../auth/auth.repository.js';
import { CurrentSession, SessionAuthGuard } from '../auth/session-auth.guard.js';
import { CatalogService } from './catalog.service.js';

@UseGuards(SessionAuthGuard)
@Controller('tenants/:tenantId/projects/:projectId')
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Get('catalog')
  listCatalog(
    @Param('tenantId') tenantId: string,
    @Param('projectId') projectId: string,
    @CurrentSession() session: ResolvedSession,
  ): Promise<UnitTypeCommercialSnapshot[]> {
    this.assertUuid(tenantId, 'tenantId');
    this.assertUuid(projectId, 'projectId');
    return this.catalog.listCommercialCatalog({
      actorUserId: session.userId,
      tenantId,
      projectId,
    });
  }

  @Post('unit-types')
  async createUnitType(
    @Param('tenantId') tenantId: string,
    @Param('projectId') projectId: string,
    @Body() body: unknown,
    @CurrentSession() session: ResolvedSession,
  ): Promise<{ unitTypeId: string }> {
    const parsed = createUnitTypeSchema.safeParse({
      ...(this.objectBody(body)),
      tenantId,
      projectId,
    });
    if (!parsed.success) throw new BadRequestException('Invalid unit type data.');
    return this.catalog.createUnitType({ actorUserId: session.userId, data: parsed.data });
  }

  @Post('unit-types/:unitTypeId/capacity')
  async addCapacity(
    @Param('tenantId') tenantId: string,
    @Param('projectId') projectId: string,
    @Param('unitTypeId') unitTypeId: string,
    @Body() body: unknown,
    @CurrentSession() session: ResolvedSession,
  ): Promise<{ added: number }> {
    const parsed = addInventoryCapacitySchema.safeParse({
      ...(this.objectBody(body)),
      tenantId,
      projectId,
      unitTypeId,
    });
    if (!parsed.success) throw new BadRequestException('Invalid capacity data.');
    return this.catalog.addInventoryCapacity({ actorUserId: session.userId, data: parsed.data });
  }

  @Post('pricing-versions')
  async createPricingVersion(
    @Param('tenantId') tenantId: string,
    @Param('projectId') projectId: string,
    @Body() body: unknown,
    @CurrentSession() session: ResolvedSession,
  ): Promise<{ pricingVersionId: string; versionNumber: number; status: 'DRAFT' }> {
    const parsed = createPricingVersionSchema.safeParse({
      ...(this.objectBody(body)),
      tenantId,
      projectId,
    });
    if (!parsed.success) throw new BadRequestException('Invalid pricing version data.');
    return this.catalog.createPricingVersion({ actorUserId: session.userId, data: parsed.data });
  }

  @Post('pricing-versions/:pricingVersionId/publish')
  async publishPricingVersion(
    @Param('tenantId') tenantId: string,
    @Param('projectId') projectId: string,
    @Param('pricingVersionId') pricingVersionId: string,
    @CurrentSession() session: ResolvedSession,
  ): Promise<{ status: 'PUBLISHED' | 'SCHEDULED'; effectiveAt: string }> {
    const parsed = publishPricingVersionSchema.safeParse({
      tenantId,
      projectId,
      pricingVersionId,
    });
    if (!parsed.success) throw new BadRequestException('Invalid pricing version identifier.');
    return this.catalog.publishPricingVersion({ actorUserId: session.userId, data: parsed.data });
  }

  @Post('unit-types/:unitTypeId/locks')
  async createLock(
    @Param('tenantId') tenantId: string,
    @Param('projectId') projectId: string,
    @Param('unitTypeId') unitTypeId: string,
    @Body() body: unknown,
    @CurrentSession() session: ResolvedSession,
  ) {
    const parsed = createInventoryLockSchema.safeParse({
      ...(this.objectBody(body)),
      tenantId,
      projectId,
      unitTypeId,
    });
    if (!parsed.success) throw new BadRequestException('Invalid lock request.');
    return this.catalog.createInventoryLock({ actorUserId: session.userId, data: parsed.data });
  }

  @Delete('locks/:lockId')
  async releaseLock(
    @Param('tenantId') tenantId: string,
    @Param('projectId') projectId: string,
    @Param('lockId') lockId: string,
    @Body() body: unknown,
    @CurrentSession() session: ResolvedSession,
  ): Promise<{ released: true }> {
    const parsed = releaseInventoryLockSchema.safeParse({
      ...(this.objectBody(body)),
      tenantId,
      projectId,
      lockId,
    });
    if (!parsed.success) throw new BadRequestException('Invalid lock release request.');
    return this.catalog.releaseInventoryLock({ actorUserId: session.userId, data: parsed.data });
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
