import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  AddInventoryCapacityInput,
  CreateInventoryLockInput,
  CreatePricingVersionInput,
  CreateUnitTypeInput,
  InventoryLockResult,
  PublishPricingVersionInput,
  ReleaseInventoryLockInput,
  UnitTypeCommercialSnapshot,
} from '@preneura/contracts/catalog';
import { AccessService } from '../access/access.service.js';
import { CatalogRepository } from './catalog.repository.js';

@Injectable()
export class CatalogService {
  constructor(
    private readonly repository: CatalogRepository,
    private readonly access: AccessService,
  ) {}

  async listCommercialCatalog(input: {
    actorUserId: string;
    tenantId: string;
    projectId: string;
  }): Promise<UnitTypeCommercialSnapshot[]> {
    await this.requireProject(input.tenantId, input.projectId);
    await this.access.assert({
      userId: input.actorUserId,
      permission: 'inventory.read',
      context: { tenantId: input.tenantId, projectId: input.projectId },
    });

    const pricingDecision = await this.access.can({
      userId: input.actorUserId,
      permission: 'pricing.read',
      context: { tenantId: input.tenantId, projectId: input.projectId },
    });

    const rows = await this.repository.listCommercialSnapshots({
      tenantId: input.tenantId,
      projectId: input.projectId,
      now: new Date(),
    });

    if (pricingDecision.allowed) return rows;
    return rows.map((row) => ({
      ...row,
      currentTotalPrice: null,
      currentPriceEffectiveAt: null,
      currentPricePublishedAt: null,
      nextPriceEffectiveAt: null,
      nextTotalPrice: null,
      nextPriceChangePercent: null,
    }));
  }

  async createUnitType(input: {
    actorUserId: string;
    data: CreateUnitTypeInput;
  }): Promise<{ unitTypeId: string }> {
    await this.requireProject(input.data.tenantId, input.data.projectId);
    await this.access.assert({
      userId: input.actorUserId,
      permission: 'project.manage',
      context: { tenantId: input.data.tenantId, projectId: input.data.projectId },
    });

    const unitTypeId = await this.repository.createUnitType(input.data);
    return { unitTypeId };
  }

  async addInventoryCapacity(input: {
    actorUserId: string;
    data: AddInventoryCapacityInput;
  }): Promise<{ added: number }> {
    await this.requireProject(input.data.tenantId, input.data.projectId);
    await this.access.assert({
      userId: input.actorUserId,
      permission: 'project.manage',
      context: { tenantId: input.data.tenantId, projectId: input.data.projectId },
    });
    await this.requireUnitTypes(input.data.tenantId, input.data.projectId, [input.data.unitTypeId]);

    await this.repository.addInventoryCapacity({
      ...input.data,
      actorUserId: input.actorUserId,
    });
    return { added: input.data.quantity };
  }

  async createPricingVersion(input: {
    actorUserId: string;
    data: CreatePricingVersionInput;
  }): Promise<{ pricingVersionId: string; versionNumber: number; status: 'DRAFT' }> {
    await this.requireProject(input.data.tenantId, input.data.projectId);
    await this.access.assert({
      userId: input.actorUserId,
      permission: 'pricing.publish',
      context: { tenantId: input.data.tenantId, projectId: input.data.projectId },
    });

    const keys = input.data.rates.map((rate) => `${rate.unitTypeId}:${rate.component}`);
    if (new Set(keys).size !== keys.length) {
      throw new BadRequestException('Each unit type can have only one rate per pricing component.');
    }

    await this.requireUnitTypes(
      input.data.tenantId,
      input.data.projectId,
      input.data.rates.map((rate) => rate.unitTypeId),
    );

    const created = await this.repository.createDraftPricingVersion({
      actorUserId: input.actorUserId,
      data: input.data,
    });
    return {
      pricingVersionId: created.id,
      versionNumber: created.versionNumber,
      status: 'DRAFT',
    };
  }

  async publishPricingVersion(input: {
    actorUserId: string;
    data: PublishPricingVersionInput;
  }): Promise<{ status: 'PUBLISHED' | 'SCHEDULED'; effectiveAt: string }> {
    await this.requireProject(input.data.tenantId, input.data.projectId);
    await this.access.assert({
      userId: input.actorUserId,
      permission: 'pricing.publish',
      context: { tenantId: input.data.tenantId, projectId: input.data.projectId },
    });

    const coverage = await this.repository.pricingCoverage(input.data);
    if (!coverage) throw new NotFoundException('Pricing version not found.');
    if (coverage.expectedRates === 0) {
      throw new ConflictException('At least one active unit type is required before publishing pricing.');
    }
    if (coverage.actualRates !== coverage.expectedRates) {
      throw new ConflictException(
        `Pricing is incomplete: expected ${coverage.expectedRates} component rates and found ${coverage.actualRates}.`,
      );
    }

    const published = await this.repository.publishPricingVersion({
      ...input.data,
      actorUserId: input.actorUserId,
      now: new Date(),
    });
    if (!published) {
      throw new ConflictException('Only a draft pricing version can be published.');
    }
    return {
      status: published.status,
      effectiveAt: published.effectiveAt.toISOString(),
    };
  }

  async createInventoryLock(input: {
    actorUserId: string;
    data: CreateInventoryLockInput;
  }): Promise<InventoryLockResult> {
    await this.requireProject(input.data.tenantId, input.data.projectId);
    await this.access.assert({
      userId: input.actorUserId,
      permission: 'unit.lock',
      context: { tenantId: input.data.tenantId, projectId: input.data.projectId },
    });
    await this.requireUnitTypes(input.data.tenantId, input.data.projectId, [input.data.unitTypeId]);

    const lock = await this.repository.createInventoryLock({
      tenantId: input.data.tenantId,
      projectId: input.data.projectId,
      unitTypeId: input.data.unitTypeId,
      buyerUserId: input.data.buyerUserId ?? null,
      lockedByUserId: input.actorUserId,
      ttlSeconds: input.data.ttlSeconds,
      now: new Date(),
    });
    if (!lock) {
      throw new ConflictException('No inventory is currently available for this unit type.');
    }
    return lock;
  }

  async releaseInventoryLock(input: {
    actorUserId: string;
    data: ReleaseInventoryLockInput;
  }): Promise<{ released: true }> {
    await this.requireProject(input.data.tenantId, input.data.projectId);
    await this.access.assert({
      userId: input.actorUserId,
      permission: 'unit.lock',
      context: { tenantId: input.data.tenantId, projectId: input.data.projectId },
    });

    const released = await this.repository.releaseInventoryLock({
      ...input.data,
      actorUserId: input.actorUserId,
      now: new Date(),
    });
    if (!released) {
      throw new NotFoundException('Active inventory lock not found.');
    }
    return { released: true };
  }

  private async requireProject(tenantId: string, projectId: string): Promise<void> {
    if (!(await this.repository.projectExists({ tenantId, projectId }))) {
      throw new NotFoundException('Project not found.');
    }
  }

  private async requireUnitTypes(
    tenantId: string,
    projectId: string,
    unitTypeIds: readonly string[],
  ): Promise<void> {
    if (
      !(await this.repository.unitTypesBelongToProject({
        tenantId,
        projectId,
        unitTypeIds,
      }))
    ) {
      throw new BadRequestException('One or more unit types do not belong to this project.');
    }
  }
}
