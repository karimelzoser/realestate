import { Injectable } from '@nestjs/common';
import {
  externalManagerInsightResponseSchema,
  externalRecommendationResponseSchema,
  type BuyerRecommendationRequest,
  type ManagerProjectMetricsSnapshot,
} from '@preneura/contracts/ai';
import type { UnitTypeCommercialSnapshot } from '@preneura/contracts/catalog';

export interface ExternalRecommendationResult {
  rankings: Array<{ unitTypeId: string; score: number; reason: string }>;
  requestId: string | null;
}

export interface ExternalInsightResult {
  answer: string;
  findings: string[];
  requestId: string | null;
}

@Injectable()
export class AiProvider {
  isConfigured(): boolean {
    return Boolean(process.env.AI_PROVIDER_URL);
  }

  async rerank(input: {
    model: string | null;
    preferences: BuyerRecommendationRequest;
    candidates: UnitTypeCommercialSnapshot[];
  }): Promise<ExternalRecommendationResult> {
    const payload = await this.post({
      version: '1',
      purpose: 'BUYER_RECOMMENDATION',
      model: input.model ?? process.env.AI_PROVIDER_MODEL ?? null,
      input: {
        preferences: input.preferences,
        candidates: input.candidates.map((candidate) => ({
          unitTypeId: candidate.unitTypeId,
          code: candidate.code,
          name: candidate.name,
          bedroomCount: candidate.bedroomCount,
          indoorAreaSqm: candidate.indoorAreaSqm,
          roofAreaSqm: candidate.roofAreaSqm,
          gardenAreaSqm: candidate.gardenAreaSqm,
          availableQuantity: candidate.availableQuantity,
          currency: candidate.currency,
          currentTotalPrice: candidate.currentTotalPrice,
          nextPriceEffectiveAt: candidate.nextPriceEffectiveAt,
          nextTotalPrice: candidate.nextTotalPrice,
        })),
      },
    });
    const parsed = externalRecommendationResponseSchema.safeParse(payload);
    if (!parsed.success) throw new Error('AI_PROVIDER_RESPONSE_INVALID');
    return {
      rankings: parsed.data.rankings,
      requestId: parsed.data.requestId ?? null,
    };
  }

  async managerInsight(input: {
    model: string | null;
    question: string;
    metrics: ManagerProjectMetricsSnapshot;
  }): Promise<ExternalInsightResult> {
    const payload = await this.post({
      version: '1',
      purpose: 'MANAGER_INSIGHT',
      model: input.model ?? process.env.AI_PROVIDER_MODEL ?? null,
      input: {
        question: input.question,
        metrics: input.metrics,
        policy: {
          advisoryOnly: true,
          noOperationalActions: true,
          noPII: true,
        },
      },
    });
    const parsed = externalManagerInsightResponseSchema.safeParse(payload);
    if (!parsed.success) throw new Error('AI_PROVIDER_RESPONSE_INVALID');
    return {
      answer: parsed.data.answer,
      findings: parsed.data.findings,
      requestId: parsed.data.requestId ?? null,
    };
  }

  private async post(body: unknown): Promise<unknown> {
    const url = process.env.AI_PROVIDER_URL;
    if (!url) throw new Error('AI_PROVIDER_NOT_CONFIGURED');
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (process.env.AI_PROVIDER_TOKEN) headers.authorization = `Bearer ${process.env.AI_PROVIDER_TOKEN}`;
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(Number(process.env.AI_PROVIDER_TIMEOUT_MS ?? 8000)),
    });
    if (!response.ok) throw new Error(`AI_PROVIDER_HTTP_${response.status}`);
    return response.json() as Promise<unknown>;
  }
}
