import { createHash } from 'node:crypto';
import { ForbiddenException, Injectable } from '@nestjs/common';
import type {
  AiProjectSettingsInput,
  AiProjectSettingsSnapshot,
  BuyerRecommendationItem,
  BuyerRecommendationRequest,
  BuyerRecommendationResponse,
  ManagerInsightResponse,
  ManagerProjectMetricsSnapshot,
} from '@preneura/contracts/ai';
import type { UnitTypeCommercialSnapshot } from '@preneura/contracts/catalog';
import { AccessService } from '../access/access.service.js';
import { CatalogService } from '../catalog/catalog.service.js';
import { AiProvider } from './ai.provider.js';
import { AiRepository } from './ai.repository.js';

@Injectable()
export class AiService {
  constructor(
    private readonly repository: AiRepository,
    private readonly provider: AiProvider,
    private readonly access: AccessService,
    private readonly catalog: CatalogService,
  ) {}

  async settings(input: {
    actorUserId: string;
    tenantId: string;
    projectId: string;
  }): Promise<AiProjectSettingsSnapshot> {
    const context = { tenantId: input.tenantId, projectId: input.projectId };
    const decisions = await Promise.all([
      this.access.can({ userId: input.actorUserId, permission: 'ai.buyer.use', context }),
      this.access.can({ userId: input.actorUserId, permission: 'ai.manager.use', context }),
      this.access.can({ userId: input.actorUserId, permission: 'ai.settings.manage', context }),
    ]);
    if (!decisions.some((decision) => decision.allowed)) {
      throw new ForbiddenException('You do not have AI access for this project.');
    }
    return this.repository.snapshot(
      await this.repository.settings(input.tenantId, input.projectId),
      input.tenantId,
      input.projectId,
    );
  }

  async updateSettings(input: {
    actorUserId: string;
    tenantId: string;
    projectId: string;
    settings: AiProjectSettingsInput;
  }): Promise<AiProjectSettingsSnapshot> {
    await this.access.assert({
      userId: input.actorUserId,
      permission: 'ai.settings.manage',
      context: { tenantId: input.tenantId, projectId: input.projectId },
    });
    const row = await this.repository.upsertSettings(input);
    return this.repository.snapshot(row, input.tenantId, input.projectId);
  }

  async recommend(input: {
    actorUserId: string;
    tenantId: string;
    projectId: string;
    preferences: BuyerRecommendationRequest;
  }): Promise<BuyerRecommendationResponse> {
    await this.access.assert({
      userId: input.actorUserId,
      permission: 'ai.buyer.use',
      context: { tenantId: input.tenantId, projectId: input.projectId },
    });
    const settings = this.repository.snapshot(
      await this.repository.settings(input.tenantId, input.projectId),
      input.tenantId,
      input.projectId,
    );
    if (!settings.buyerEnabled) throw new ForbiddenException('Buyer AI is disabled for this project.');

    const started = Date.now();
    const catalog = await this.catalog.listCommercialCatalog({
      actorUserId: input.actorUserId,
      tenantId: input.tenantId,
      projectId: input.projectId,
    });
    const deterministic = scoreCandidates(catalog, input.preferences);
    const fingerprint = hash({ preferences: input.preferences, candidateIds: deterministic.map((item) => item.snapshot.unitTypeId) });

    if (settings.providerCode !== 'EXTERNAL_HTTP') {
      const results = deterministic.slice(0, input.preferences.maxResults).map(toRecommendationItem);
      await this.repository.logInvocation({
        tenantId: input.tenantId, projectId: input.projectId, userId: input.actorUserId,
        purpose: 'BUYER_RECOMMENDATION', providerCode: 'DETERMINISTIC', model: null,
        requestFingerprint: fingerprint, candidateCount: deterministic.length, status: 'SUCCESS',
        latencyMs: Date.now() - started, externalRequestId: null, errorCode: null,
      });
      return { providerUsed: 'DETERMINISTIC', fallbackUsed: false, advisoryOnly: true, generatedAt: new Date().toISOString(), results };
    }

    if (!this.provider.isConfigured()) {
      return this.recommendationFallback(input, deterministic, fingerprint, started, settings.model, 'AI_PROVIDER_NOT_CONFIGURED');
    }

    try {
      const external = await this.provider.rerank({
        model: settings.model,
        preferences: input.preferences,
        candidates: deterministic.map((item) => item.snapshot),
      });
      const byId = new Map(deterministic.map((item) => [item.snapshot.unitTypeId, item]));
      const used = new Set<string>();
      const ranked: ScoredCandidate[] = [];
      for (const item of external.rankings) {
        const baseline = byId.get(item.unitTypeId);
        if (!baseline || used.has(item.unitTypeId)) continue;
        used.add(item.unitTypeId);
        ranked.push({ snapshot: baseline.snapshot, score: roundScore(item.score), reasons: [item.reason, ...baseline.reasons] });
      }
      for (const baseline of deterministic) {
        if (!used.has(baseline.snapshot.unitTypeId)) ranked.push(baseline);
      }
      const results = ranked.slice(0, input.preferences.maxResults).map(toRecommendationItem);
      await this.repository.logInvocation({
        tenantId: input.tenantId, projectId: input.projectId, userId: input.actorUserId,
        purpose: 'BUYER_RECOMMENDATION', providerCode: 'EXTERNAL_HTTP', model: settings.model,
        requestFingerprint: fingerprint, candidateCount: deterministic.length, status: 'SUCCESS',
        latencyMs: Date.now() - started, externalRequestId: external.requestId, errorCode: null,
      });
      return { providerUsed: 'EXTERNAL_HTTP', fallbackUsed: false, advisoryOnly: true, generatedAt: new Date().toISOString(), results };
    } catch (error) {
      return this.recommendationFallback(input, deterministic, fingerprint, started, settings.model, errorCode(error));
    }
  }

  async managerInsight(input: {
    actorUserId: string;
    tenantId: string;
    projectId: string;
    question: string;
  }): Promise<ManagerInsightResponse> {
    await this.access.assert({
      userId: input.actorUserId,
      permission: 'ai.manager.use',
      context: { tenantId: input.tenantId, projectId: input.projectId },
    });
    const settings = this.repository.snapshot(
      await this.repository.settings(input.tenantId, input.projectId),
      input.tenantId,
      input.projectId,
    );
    if (!settings.managerEnabled) throw new ForbiddenException('Manager AI is disabled for this project.');

    const started = Date.now();
    const metrics = await this.repository.managerMetrics(input.tenantId, input.projectId);
    const fingerprint = hash({ question: input.question, metrics });
    const baseline = deterministicManagerInsight(metrics);

    if (settings.providerCode !== 'EXTERNAL_HTTP') {
      await this.repository.logInvocation({
        tenantId: input.tenantId, projectId: input.projectId, userId: input.actorUserId,
        purpose: 'MANAGER_INSIGHT', providerCode: 'DETERMINISTIC', model: null,
        requestFingerprint: fingerprint, candidateCount: null, status: 'SUCCESS',
        latencyMs: Date.now() - started, externalRequestId: null, errorCode: null,
      });
      return { providerUsed: 'DETERMINISTIC', fallbackUsed: false, advisoryOnly: true, generatedAt: new Date().toISOString(), ...baseline, metrics };
    }

    if (!this.provider.isConfigured()) {
      return this.managerFallback(input, settings.model, metrics, baseline, fingerprint, started, 'AI_PROVIDER_NOT_CONFIGURED');
    }

    try {
      const external = await this.provider.managerInsight({ model: settings.model, question: input.question, metrics });
      await this.repository.logInvocation({
        tenantId: input.tenantId, projectId: input.projectId, userId: input.actorUserId,
        purpose: 'MANAGER_INSIGHT', providerCode: 'EXTERNAL_HTTP', model: settings.model,
        requestFingerprint: fingerprint, candidateCount: null, status: 'SUCCESS',
        latencyMs: Date.now() - started, externalRequestId: external.requestId, errorCode: null,
      });
      return {
        providerUsed: 'EXTERNAL_HTTP', fallbackUsed: false, advisoryOnly: true,
        generatedAt: new Date().toISOString(), answer: external.answer,
        findings: external.findings, metrics,
      };
    } catch (error) {
      return this.managerFallback(input, settings.model, metrics, baseline, fingerprint, started, errorCode(error));
    }
  }

  private async recommendationFallback(
    input: { actorUserId: string; tenantId: string; projectId: string; preferences: BuyerRecommendationRequest },
    deterministic: ScoredCandidate[], fingerprint: string, started: number, model: string | null, code: string,
  ): Promise<BuyerRecommendationResponse> {
    await this.repository.logInvocation({
      tenantId: input.tenantId, projectId: input.projectId, userId: input.actorUserId,
      purpose: 'BUYER_RECOMMENDATION', providerCode: 'EXTERNAL_HTTP', model,
      requestFingerprint: fingerprint, candidateCount: deterministic.length, status: 'FALLBACK',
      latencyMs: Date.now() - started, externalRequestId: null, errorCode: code,
    });
    return {
      providerUsed: 'DETERMINISTIC', fallbackUsed: true, advisoryOnly: true,
      generatedAt: new Date().toISOString(),
      results: deterministic.slice(0, input.preferences.maxResults).map(toRecommendationItem),
    };
  }

  private async managerFallback(
    input: { actorUserId: string; tenantId: string; projectId: string; question: string },
    model: string | null, metrics: ManagerProjectMetricsSnapshot,
    baseline: { answer: string; findings: string[] }, fingerprint: string, started: number, code: string,
  ): Promise<ManagerInsightResponse> {
    await this.repository.logInvocation({
      tenantId: input.tenantId, projectId: input.projectId, userId: input.actorUserId,
      purpose: 'MANAGER_INSIGHT', providerCode: 'EXTERNAL_HTTP', model,
      requestFingerprint: fingerprint, candidateCount: null, status: 'FALLBACK',
      latencyMs: Date.now() - started, externalRequestId: null, errorCode: code,
    });
    return {
      providerUsed: 'DETERMINISTIC', fallbackUsed: true, advisoryOnly: true,
      generatedAt: new Date().toISOString(), ...baseline, metrics,
    };
  }
}

type ScoredCandidate = { snapshot: UnitTypeCommercialSnapshot; score: number; reasons: string[] };

function scoreCandidates(catalog: UnitTypeCommercialSnapshot[], preferences: BuyerRecommendationRequest): ScoredCandidate[] {
  const eligible = catalog.filter((candidate) => {
    if (candidate.availableQuantity <= 0) return false;
    if (preferences.budgetMax != null && candidate.currentTotalPrice != null && Number(candidate.currentTotalPrice) > preferences.budgetMax) return false;
    if (preferences.bedrooms != null && candidate.bedroomCount != null && candidate.bedroomCount < preferences.bedrooms) return false;
    if (preferences.minIndoorAreaSqm != null && Number(candidate.indoorAreaSqm) < preferences.minIndoorAreaSqm) return false;
    if (preferences.gardenPreference === 'REQUIRED' && Number(candidate.gardenAreaSqm) <= 0) return false;
    if (preferences.roofPreference === 'REQUIRED' && Number(candidate.roofAreaSqm) <= 0) return false;
    return true;
  });

  return eligible.map((snapshot) => {
    let score = 50;
    const reasons: string[] = [];
    const price = snapshot.currentTotalPrice == null ? null : Number(snapshot.currentTotalPrice);
    if (preferences.budgetMax != null && price != null) {
      const headroom = Math.max(0, preferences.budgetMax - price) / preferences.budgetMax;
      score += 12 + Math.min(8, headroom * 8);
      reasons.push('Fits the selected budget.');
    }
    if (preferences.bedrooms != null && snapshot.bedroomCount != null) {
      if (snapshot.bedroomCount === preferences.bedrooms) { score += 15; reasons.push('Matches the requested bedroom count.'); }
      else if (snapshot.bedroomCount > preferences.bedrooms) { score += 8; reasons.push('Meets or exceeds the requested bedroom count.'); }
    }
    if (preferences.minIndoorAreaSqm != null) {
      score += 10;
      reasons.push('Meets the minimum indoor area.');
    }
    if (preferences.gardenPreference !== 'NONE' && Number(snapshot.gardenAreaSqm) > 0) {
      score += preferences.gardenPreference === 'REQUIRED' ? 12 : 8;
      reasons.push('Includes garden area.');
    }
    if (preferences.roofPreference !== 'NONE' && Number(snapshot.roofAreaSqm) > 0) {
      score += preferences.roofPreference === 'REQUIRED' ? 12 : 8;
      reasons.push('Includes roof area.');
    }
    score += Math.min(5, snapshot.availableQuantity);
    if (reasons.length === 0) reasons.push('Available now and compatible with the selected filters.');
    return { snapshot, score: roundScore(score), reasons };
  }).sort((a, b) => b.score - a.score || b.snapshot.availableQuantity - a.snapshot.availableQuantity || a.snapshot.name.localeCompare(b.snapshot.name));
}

function toRecommendationItem(candidate: ScoredCandidate): BuyerRecommendationItem {
  const snapshot = candidate.snapshot;
  return {
    unitTypeId: snapshot.unitTypeId,
    code: snapshot.code,
    name: snapshot.name,
    score: candidate.score,
    reasons: [...new Set(candidate.reasons)].slice(0, 5),
    bedroomCount: snapshot.bedroomCount,
    indoorAreaSqm: snapshot.indoorAreaSqm,
    roofAreaSqm: snapshot.roofAreaSqm,
    gardenAreaSqm: snapshot.gardenAreaSqm,
    availableQuantity: snapshot.availableQuantity,
    currency: snapshot.currency,
    currentTotalPrice: snapshot.currentTotalPrice,
    nextPriceEffectiveAt: snapshot.nextPriceEffectiveAt,
    nextTotalPrice: snapshot.nextTotalPrice,
    nextPriceChangePercent: snapshot.nextPriceChangePercent,
  };
}

function deterministicManagerInsight(metrics: ManagerProjectMetricsSnapshot): { answer: string; findings: string[] } {
  const findings: string[] = [];
  if (metrics.overduePaymentItems > 0) findings.push(`${metrics.overduePaymentItems} payment items are overdue.`);
  if (metrics.dueCommissionCases > 0) findings.push(`${metrics.dueCommissionCases} broker commission cases are due.`);
  if (metrics.failedNotificationJobs > 0) findings.push(`${metrics.failedNotificationJobs} notification jobs have failed.`);
  if (metrics.pendingDocumentRequirements > 0) findings.push(`${metrics.pendingDocumentRequirements} transactions are still missing required buyer documents.`);
  if (metrics.availableInventory === 0) findings.push('No inventory is currently available.');
  if (findings.length === 0) findings.push('No overdue payment, due commission, failed notification, or pending-document exception is currently flagged.');
  const answer = `Project snapshot: ${metrics.availableInventory} available, ${metrics.reservedInventory} reserved and ${metrics.soldInventory} sold inventory slots; ${metrics.transactionsOpen + metrics.transactionsReady} transactions remain open or ready for completion.`;
  return { answer, findings };
}

function hash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
function roundScore(value: number): number { return Math.max(0, Math.min(100, Math.round(value * 10) / 10)); }
function errorCode(error: unknown): string {
  if (!(error instanceof Error)) return 'AI_PROVIDER_UNKNOWN';
  return error.message.slice(0, 120).replace(/[^A-Z0-9_.:-]/gi, '_');
}
