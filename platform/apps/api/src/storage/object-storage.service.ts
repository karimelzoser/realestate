import { Injectable } from '@nestjs/common';
import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  type HeadObjectOutput,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { createHash, randomUUID } from 'node:crypto';

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
  private readonly signingClient: S3Client;
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
    const publicEndpoint = process.env.OBJECT_STORAGE_PUBLIC_ENDPOINT;
    if (publicEndpoint) {
      const url = new URL(publicEndpoint);
      const testLoopback = process.env.NODE_ENV === 'test' && ['localhost','127.0.0.1','[::1]'].includes(url.hostname);
      if ((url.protocol !== 'https:' && !testLoopback) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
        throw new Error('OBJECT_STORAGE_PUBLIC_ENDPOINT must be an HTTPS origin without credentials or a path.');
      }
      this.signingClient = new S3Client({
        region: process.env.OBJECT_STORAGE_REGION ?? 'us-east-1',
        endpoint: url.origin,
        forcePathStyle: process.env.OBJECT_STORAGE_FORCE_PATH_STYLE === 'true',
        ...(accessKeyId && secretAccessKey ? { credentials: { accessKeyId, secretAccessKey } } : {}),
      });
    } else this.signingClient = this.client;
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

  projectAssetObjectKey(input: {
    tenantId: string;
    projectId: string;
    assetType: string;
  }): string {
    return [
      'tenants',
      input.tenantId,
      'projects',
      input.projectId,
      'master-plan-assets',
      this.safeSegment(input.assetType.toLowerCase()),
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
      // A still-valid upload URL cannot replace an object after it was scanned
      // and attached to a document or contract. Providers must implement this.
      IfNoneMatch: '*',
      Metadata: {
        'preneura-sha256': this.sha256Hex(input.sha256Base64),
      },
    });
    const uploadUrl = await getSignedUrl(this.signingClient, command, {
      expiresIn: expiresInSeconds,
      signableHeaders: new Set(['if-none-match','content-type']),
      unhoistableHeaders: new Set(['x-amz-checksum-sha256','x-amz-meta-preneura-sha256']),
    });
    const expiresAt = new Date(Date.now() + expiresInSeconds * 1000).toISOString();

    return {
      objectKey: input.objectKey,
      uploadUrl,
      expiresAt,
      requiredHeaders: {
        'content-type': input.contentType,
        'if-none-match': '*',
        'x-amz-checksum-sha256': input.sha256Base64,
        'x-amz-meta-preneura-sha256': this.sha256Hex(input.sha256Base64),
      },
    };
  }

  async createDownloadUrl(input: {
    objectKey: string;
    expiresInSeconds?: number;
  }): Promise<{ downloadUrl: string; expiresAt: string }> {
    const expiresInSeconds = Math.min(Math.max(input.expiresInSeconds ?? 300, 30), 600);
    const command = new GetObjectCommand({ Bucket: this.bucket, Key: input.objectKey });
    const downloadUrl = await getSignedUrl(this.signingClient, command, { expiresIn: expiresInSeconds });
    return {
      downloadUrl,
      expiresAt: new Date(Date.now() + expiresInSeconds * 1000).toISOString(),
    };
  }

  async readObjectBytes(input: { objectKey: string; maxBytes: number }): Promise<Uint8Array> {
    if (!Number.isInteger(input.maxBytes) || input.maxBytes <= 0) {
      throw new Error('maxBytes must be a positive integer.');
    }
    const response = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: input.objectKey }),
    );
    if (response.ContentLength !== undefined && response.ContentLength > input.maxBytes) {
      this.discardBody(response.Body);
      throw new Error('Stored object exceeds the permitted inspection size.');
    }
    if (!response.Body) throw new Error('Stored object has no readable body.');
    const chunks: Buffer[] = [];
    let total = 0;
    for await (const chunk of response.Body as AsyncIterable<Uint8Array>) {
      const bytes = Buffer.from(chunk);
      total += bytes.byteLength;
      if (total > input.maxBytes) throw new Error('Stored object exceeds the permitted inspection size.');
      chunks.push(bytes);
    }
    return Buffer.concat(chunks,total);
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

    // Metadata is a caller's declaration, not proof of stored bytes. Some S3
    // compatible providers omit native checksum headers, so always verify the
    // physical object digest in a bounded, constant-memory stream.
    try {
      const stored = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: input.objectKey }));
      if (!stored.Body) return null;
      if (stored.ContentLength !== undefined && stored.ContentLength !== input.expectedByteSize) {
        this.discardBody(stored.Body);
        return null;
      }
      const digest = createHash('sha256');
      let total = 0;
      for await (const chunk of stored.Body as AsyncIterable<Uint8Array>) {
        total += chunk.byteLength;
        if (total > input.expectedByteSize) return null;
        digest.update(chunk);
      }
      if (total !== input.expectedByteSize || digest.digest('base64') !== input.expectedSha256Base64) return null;
    } catch { return null; }

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

  private discardBody(body: unknown): void {
    const destroy = (body as { destroy?: () => void } | undefined)?.destroy;
    if (typeof destroy === 'function') destroy.call(body);
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
