import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  Param,
  Post,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  settlementProviderEventSchema,
  type SettlementSnapshot,
} from '@preneura/contracts/settlements';
import { createHash, timingSafeEqual } from 'node:crypto';
import { SettlementService } from './settlement.service.js';

@Controller('settlements/providers/:provider/events')
export class SettlementProviderController {
  constructor(private readonly settlements: SettlementService) {}

  @Post()
  ingest(
    @Param('provider') providerParam: string,
    @Headers('authorization') authorization: string | undefined,
    @Body() body: unknown,
  ): Promise<SettlementSnapshot> {
    this.assertIngressToken(authorization);
    const provider = providerParam.trim().toUpperCase();
    if (!/^[A-Z0-9][A-Z0-9_-]{0,79}$/.test(provider)) {
      throw new BadRequestException('Invalid settlement provider identifier.');
    }
    const parsed = settlementProviderEventSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Invalid normalized settlement provider event.');

    const contentHashHex = createHash('sha256')
      .update(this.canonicalJson(parsed.data), 'utf8')
      .digest('hex');
    return this.settlements.ingestProvider({ provider, contentHashHex, data: parsed.data });
  }

  private assertIngressToken(authorization: string | undefined): void {
    const token = process.env.SETTLEMENT_PROVIDER_INGRESS_TOKEN?.trim();
    if (!token) {
      throw new ServiceUnavailableException('Settlement provider ingress is not configured.');
    }
    const supplied = authorization?.startsWith('Bearer ')
      ? authorization.slice('Bearer '.length)
      : '';
    const expectedDigest = createHash('sha256').update(token, 'utf8').digest();
    const suppliedDigest = createHash('sha256').update(supplied, 'utf8').digest();
    if (!timingSafeEqual(expectedDigest, suppliedDigest)) {
      throw new UnauthorizedException('Invalid settlement provider credential.');
    }
  }

  private canonicalJson(value: unknown): string {
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map((item) => this.canonicalJson(item)).join(',')}]`;
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${this.canonicalJson(object[key])}`)
      .join(',')}}`;
  }
}
