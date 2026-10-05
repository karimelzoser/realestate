import { Injectable } from '@nestjs/common';
import {
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  type HeadObjectOutput,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'node:crypto';

export interface UploadIntent {
  objectKey: string;
  uploadUrl: string;
  expiresAt: string;
  requiredHeaders: Readonly<Record<string, string>>;
}

export interface VerifiedObject {
  objectKey: string;
  byteSize: number;
  contentType: string;
  sha256Base64: string;
  sha256Hex: string;
}

@Injectable()
export class ObjectStorageService {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor() {
    this.bucket = this.required('OBJECT_STORAGE_BUCKET');
    const endpoint = process.env.OBJECT_STORAGE_ENDPOINT;
    const accessKeyId = process.env.OBJECT_STORAGE_ACCESS_KEY_ID;
    const secretAccessKey = process.env.OBJECT_STORAGE_SECRET_ACCESS_KEY;

    this.client = new S3Client({
      region: process.env.OBJECT_STORAGE_REGION ?? 'us-east-1',
      ...(endpoint ? { endpoint } : {}),
      forcePathStyle: process.env.OBJECT_STORAGE_FORCE_PATH_STYLE === 'true',
      ...(accessKeyId && secretAccessKey
        ? { credentials: { accessKeyId, secretAccessKey } }
        : {}),
    });
  }

  documentObjectKey(input: {
    tenantId: string;
    projectId: string;
    transactionId: string;
    category: string;
  }): string {
    return [
      'tenants',
      input.tenantId,
      'projects',
      input.projectId,
      'transactions',
      input.transactionId,
      'documents',
      this.safeSegment(input.category.toLowerCase()),
      randomUUID(),
    ].join('/');
  }

  templateObjectKey(input: {
    tenantId: string;
    projectId?: string | null;
    code: string;
  }): string {
    return [
      'tenants',
      input.tenantId,
      input.projectId ? `projects/${input.projectId}` : 'tenant-defaults',
      'templates',
      this.safeSegment(input.code.toLowerCase()),
      randomUUID(),
    ].join('/');
  }

  signatureObjectKey(input: {
    tenantId: string;
    projectId: string;
    transactionId: string;
    documentId: string;
    signerRole: string;
  }): string {
    return [
      'tenants',
      input.tenantId,
      'projects',
      input.projectId,
      'transactions',
      input.transactionId,
      'documents',
      input.documentId,
      'signatures',
      this.safeSegment(input.signerRole.toLowerCase()),
      randomUUID(),
    ].join('/');
  }

  async createUploadIntent(input: {
    objectKey: string;
    contentType: string;
    byteSize: number;
    sha256Base64: string;
    expiresInSeconds?: number;
  }): Promise<UploadIntent> {
    const expiresInSeconds = Math.min(Math.max(input.expiresInSeconds ?? 600, 60), 900);
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: input.objectKey,
      ContentType: input.contentType,
      ContentLength: input.byteSize,
      ChecksumSHA256: input.sha256Base64,
      Metadata: {
        'preneura-sha256': this.sha256Hex(input.sha256Base64),
      },
    });
    const uploadUrl = await getSignedUrl(this.client, command, { expiresIn: expiresInSeconds });
    const expiresAt = new Date(Date.now() + expiresInSeconds * 1000).toISOString();

    return {
      objectKey: input.objectKey,
      uploadUrl,
      expiresAt,
      // `Content-Length` is intentionally omitted here. Browsers control that
      // forbidden request header themselves. The signed PutObject request still
      // carries the declared byte size and PRENEURA verifies ContentLength again
      // with HeadObject before finalizing the business record.
      requiredHeaders: {
        'content-type': input.contentType,
        'x-amz-checksum-sha256': input.sha256Base64,
        'x-amz-meta-preneura-sha256': this.sha256Hex(input.sha256Base64),
      },
    };
  }

  async verifyObject(input: {
    objectKey: string;
    expectedContentType: string;
    expectedByteSize: number;
    expectedSha256Base64: string;
  }): Promise<VerifiedObject | null> {
    let head: HeadObjectOutput;
    try {
      head = await this.client.send(
        new HeadObjectCommand({
          Bucket: this.bucket,
          Key: input.objectKey,
          ChecksumMode: 'ENABLED',
        }),
      );
    } catch {
      return null;
    }

    const expectedHex = this.sha256Hex(input.expectedSha256Base64);
    const metadataHash = head.Metadata?.['preneura-sha256']?.toLowerCase();
    const providerChecksum = head.ChecksumSHA256;
    const hashMatches =
      providerChecksum === input.expectedSha256Base64 || metadataHash === expectedHex;

    if (
      head.ContentLength !== input.expectedByteSize ||
      head.ContentType !== input.expectedContentType ||
      !hashMatches
    ) {
      return null;
    }

    return {
      objectKey: input.objectKey,
      byteSize: input.expectedByteSize,
      contentType: input.expectedContentType,
      sha256Base64: input.expectedSha256Base64,
      sha256Hex: expectedHex,
    };
  }

  ensurePrefix(objectKey: string, requiredPrefix: string): boolean {
    return objectKey.startsWith(`${requiredPrefix}/`);
  }

  private sha256Hex(base64Digest: string): string {
    const digest = Buffer.from(base64Digest, 'base64');
    if (digest.length !== 32) throw new Error('SHA-256 digest must be exactly 32 bytes');
    return digest.toString('hex');
  }

  private safeSegment(value: string): string {
    const cleaned = value.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
    if (!cleaned) throw new Error('Object storage path segment is empty after sanitization');
    return cleaned;
  }

  private required(name: string): string {
    const value = process.env[name];
    if (!value) throw new Error(`${name} is required`);
    return value;
  }
}
