import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { fileTypeFromBuffer } from 'file-type';
import { ObjectStorageService, type VerifiedObject } from './object-storage.service.js';
import {
  ObjectTrustRepository,
  type ObjectTrustPurpose,
  type ObjectTrustRecord,
} from './object-trust.repository.js';

type ScannerResponse = {
  verdict: 'CLEAN' | 'INFECTED';
  engine: string;
  engineVersion: string | null;
  reference: string | null;
  signature: string | null;
};

@Injectable()
export class ObjectTrustService {
  constructor(
    private readonly repository: ObjectTrustRepository,
    private readonly storage: ObjectStorageService,
  ) {}

  async trustVerifiedObject(input: {
    tenantId: string;
    projectId: string | null;
    purpose: ObjectTrustPurpose;
    verified: VerifiedObject;
    maxInspectionBytes: number;
  }): Promise<ObjectTrustRecord> {
    const trust = await this.repository.ensurePending({
      tenantId: input.tenantId,
      projectId: input.projectId,
      purpose: input.purpose,
      objectKey: input.verified.objectKey,
      declaredMimeType: input.verified.contentType,
      byteSize: input.verified.byteSize,
      sha256Hex: input.verified.sha256Hex,
    });
    if (trust.status === 'CLEAN') return trust;
    if (trust.status === 'REJECTED') {
      throw new BadRequestException('Stored object has already been rejected by the trust pipeline.');
    }

    const startedAt = new Date();
    let detectedMimeType: string | null = null;
    try {
      const bytes = await this.storage.readObjectBytes({
        objectKey: input.verified.objectKey,
        maxBytes: input.maxInspectionBytes,
      });
      const detected = await fileTypeFromBuffer(bytes);
      detectedMimeType = detected?.mime ?? null;
    } catch {
      await this.repository.recordAttempt({
        objectTrustId: trust.id,
        provider: 'LOCAL_FILE_TYPE',
        result: 'ERROR',
        detectedMimeType: null,
        engineVersion: null,
        providerReference: null,
        malwareSignature: null,
        errorCode: 'MIME_INSPECTION_FAILED',
        startedAt,
        completedAt: new Date(),
      });
      throw new ServiceUnavailableException('Stored object could not be inspected safely.');
    }

    if (!detectedMimeType || detectedMimeType !== input.verified.contentType.toLowerCase()) {
      await this.repository.recordAttempt({
        objectTrustId: trust.id,
        provider: 'LOCAL_FILE_TYPE',
        result: 'MIME_MISMATCH',
        detectedMimeType,
        engineVersion: null,
        providerReference: null,
        malwareSignature: null,
        errorCode: 'DECLARED_MIME_MISMATCH',
        startedAt,
        completedAt: new Date(),
      });
      throw new BadRequestException('Uploaded file content does not match its declared MIME type.');
    }

    const scannerUrl = process.env.DOCUMENT_SCANNER_URL?.trim();
    if (!scannerUrl) {
      await this.repository.recordAttempt({
        objectTrustId: trust.id,
        provider: 'EXTERNAL_HTTP',
        result: 'ERROR',
        detectedMimeType,
        engineVersion: null,
        providerReference: null,
        malwareSignature: null,
        errorCode: 'SCANNER_NOT_CONFIGURED',
        startedAt,
        completedAt: new Date(),
      });
      throw new ServiceUnavailableException('Document malware scanner is not configured. Object remains untrusted.');
    }

    const signed = await this.storage.createDownloadUrl({
      objectKey: input.verified.objectKey,
      expiresInSeconds: 300,
    });

    let scanner: ScannerResponse;
    try {
      scanner = await this.callScanner({
        url: scannerUrl,
        token: process.env.DOCUMENT_SCANNER_TOKEN,
        objectUrl: signed.downloadUrl,
        sha256Hex: input.verified.sha256Hex,
        detectedMimeType,
        byteSize: input.verified.byteSize,
      });
    } catch (error) {
      await this.repository.recordAttempt({
        objectTrustId: trust.id,
        provider: 'EXTERNAL_HTTP',
        result: 'ERROR',
        detectedMimeType,
        engineVersion: null,
        providerReference: null,
        malwareSignature: null,
        errorCode: error instanceof ScannerCallError ? error.code : 'SCANNER_REQUEST_FAILED',
        startedAt,
        completedAt: new Date(),
      });
      throw new ServiceUnavailableException('Malware scan did not produce a trusted verdict. Object remains untrusted.');
    }

    if (scanner.verdict === 'INFECTED') {
      if (!scanner.signature) {
        await this.repository.recordAttempt({
          objectTrustId: trust.id,
          provider: scanner.engine,
          result: 'ERROR',
          detectedMimeType,
          engineVersion: scanner.engineVersion,
          providerReference: scanner.reference,
          malwareSignature: null,
          errorCode: 'INFECTED_WITHOUT_SIGNATURE',
          startedAt,
          completedAt: new Date(),
        });
        throw new ServiceUnavailableException('Scanner returned an incomplete infected verdict.');
      }
      await this.repository.recordAttempt({
        objectTrustId: trust.id,
        provider: scanner.engine,
        result: 'INFECTED',
        detectedMimeType,
        engineVersion: scanner.engineVersion,
        providerReference: scanner.reference,
        malwareSignature: scanner.signature,
        errorCode: null,
        startedAt,
        completedAt: new Date(),
      });
      throw new BadRequestException('Uploaded file was rejected by malware scanning.');
    }

    return this.repository.recordAttempt({
      objectTrustId: trust.id,
      provider: scanner.engine,
      result: 'CLEAN',
      detectedMimeType,
      engineVersion: scanner.engineVersion,
      providerReference: scanner.reference,
      malwareSignature: null,
      errorCode: null,
      startedAt,
      completedAt: new Date(),
    });
  }

  async requireCleanById(objectTrustId: string): Promise<ObjectTrustRecord> {
    const trust = await this.repository.getById(objectTrustId);
    if (!trust || trust.status !== 'CLEAN') {
      throw new BadRequestException('A CLEAN trusted object is required.');
    }
    return trust;
  }

  private async callScanner(input: {
    url: string;
    token?: string;
    objectUrl: string;
    sha256Hex: string;
    detectedMimeType: string;
    byteSize: number;
  }): Promise<ScannerResponse> {
    const timeoutRaw = Number(process.env.DOCUMENT_SCANNER_TIMEOUT_MS ?? 20000);
    const timeoutMs = Number.isFinite(timeoutRaw)
      ? Math.min(Math.max(Math.trunc(timeoutRaw), 1000), 60000)
      : 20000;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(input.url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(input.token ? { authorization: `Bearer ${input.token}` } : {}),
        },
        body: JSON.stringify({
          objectUrl: input.objectUrl,
          expectedSha256Hex: input.sha256Hex,
          detectedMimeType: input.detectedMimeType,
          byteSize: input.byteSize,
        }),
        signal: controller.signal,
      });
      if (!response.ok) throw new ScannerCallError(`SCANNER_HTTP_${response.status}`);
      const value: unknown = await response.json();
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new ScannerCallError('SCANNER_INVALID_JSON');
      }
      const row = value as Record<string, unknown>;
      if (row.verdict !== 'CLEAN' && row.verdict !== 'INFECTED') {
        throw new ScannerCallError('SCANNER_INVALID_VERDICT');
      }
      if (typeof row.engine !== 'string' || !row.engine.trim() || row.engine.length > 120) {
        throw new ScannerCallError('SCANNER_INVALID_ENGINE');
      }
      const optionalString = (field: string, max: number): string | null => {
        const candidate = row[field];
        if (candidate === undefined || candidate === null) return null;
        if (typeof candidate !== 'string' || candidate.length > max) {
          throw new ScannerCallError(`SCANNER_INVALID_${field.toUpperCase()}`);
        }
        return candidate;
      };
      return {
        verdict: row.verdict,
        engine: row.engine.trim(),
        engineVersion: optionalString('engineVersion', 120),
        reference: optionalString('reference', 500),
        signature: optionalString('signature', 500),
      };
    } catch (error) {
      if (error instanceof ScannerCallError) throw error;
      if (error instanceof Error && error.name === 'AbortError') {
        throw new ScannerCallError('SCANNER_TIMEOUT');
      }
      throw new ScannerCallError('SCANNER_REQUEST_FAILED');
    } finally {
      clearTimeout(timer);
    }
  }
}

class ScannerCallError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}
