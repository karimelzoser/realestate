import { Inject, Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import type { Database } from '@preneura/database';
import { DATABASE } from '../database/database.module.js';

export type ObjectTrustPurpose = 'DOCUMENT_TEMPLATE' | 'TRANSACTION_DOCUMENT' | 'SIGNATURE' | 'PROJECT_ASSET';
export type ObjectTrustStatus = 'PENDING_SCAN' | 'CLEAN' | 'REJECTED' | 'SCAN_FAILED' | 'LEGACY_UNSCANNED';
export type ObjectScanResult = 'CLEAN' | 'INFECTED' | 'MIME_MISMATCH' | 'ERROR';

export interface ObjectTrustRecord {
  id: string;
  tenantId: string;
  projectId: string | null;
  purpose: ObjectTrustPurpose;
  objectKey: string;
  declaredMimeType: string;
  detectedMimeType: string | null;
  byteSize: number;
  sha256Hex: string;
  status: ObjectTrustStatus;
  scannerProvider: string | null;
  scannerReference: string | null;
  scannerSignature: string | null;
  lastErrorCode: string | null;
  scannedAt: string | null;
}

@Injectable()
export class ObjectTrustRepository {
  constructor(@Inject(DATABASE) private readonly db: Kysely<Database>) {}

  async ensurePending(input: {
    tenantId: string;
    projectId: string | null;
    purpose: ObjectTrustPurpose;
    objectKey: string;
    declaredMimeType: string;
    byteSize: number;
    sha256Hex: string;
  }): Promise<ObjectTrustRecord> {
    await sql`
      INSERT INTO storage_object_trust (
        tenant_id, project_id, purpose, object_key, declared_mime_type,
        byte_size, sha256_hex, status
      ) VALUES (
        ${input.tenantId}::uuid,
        ${input.projectId}::uuid,
        ${input.purpose},
        ${input.objectKey},
        ${input.declaredMimeType},
        ${input.byteSize},
        ${input.sha256Hex.toLowerCase()},
        'PENDING_SCAN'
      )
      ON CONFLICT (object_key) DO NOTHING
    `.execute(this.db);

    const record = await this.getByObjectKey(input.objectKey);
    if (!record) throw new Error('Object trust record was not created.');
    if (
      record.tenantId !== input.tenantId ||
      record.projectId !== input.projectId ||
      record.purpose !== input.purpose ||
      record.declaredMimeType !== input.declaredMimeType ||
      record.byteSize !== input.byteSize ||
      record.sha256Hex !== input.sha256Hex.toLowerCase()
    ) {
      throw new Error('Object trust identity conflicts with an existing object key.');
    }
    return record;
  }

  async getByObjectKey(objectKey: string): Promise<ObjectTrustRecord | null> {
    const result = await sql<{
      id: string;
      tenant_id: string;
      project_id: string | null;
      purpose: ObjectTrustPurpose;
      object_key: string;
      declared_mime_type: string;
      detected_mime_type: string | null;
      byte_size: string | number;
      sha256_hex: string;
      status: ObjectTrustStatus;
      scanner_provider: string | null;
      scanner_reference: string | null;
      scanner_signature: string | null;
      last_error_code: string | null;
      scanned_at: Date | null;
    }>`
      SELECT id, tenant_id, project_id, purpose, object_key, declared_mime_type,
             detected_mime_type, byte_size, sha256_hex, status, scanner_provider,
             scanner_reference, scanner_signature, last_error_code, scanned_at
      FROM storage_object_trust
      WHERE object_key = ${objectKey}
      LIMIT 1
    `.execute(this.db);
    const row = result.rows[0];
    return row ? this.map(row) : null;
  }

  async getById(id: string): Promise<ObjectTrustRecord | null> {
    const result = await sql<{
      id: string;
      tenant_id: string;
      project_id: string | null;
      purpose: ObjectTrustPurpose;
      object_key: string;
      declared_mime_type: string;
      detected_mime_type: string | null;
      byte_size: string | number;
      sha256_hex: string;
      status: ObjectTrustStatus;
      scanner_provider: string | null;
      scanner_reference: string | null;
      scanner_signature: string | null;
      last_error_code: string | null;
      scanned_at: Date | null;
    }>`
      SELECT id, tenant_id, project_id, purpose, object_key, declared_mime_type,
             detected_mime_type, byte_size, sha256_hex, status, scanner_provider,
             scanner_reference, scanner_signature, last_error_code, scanned_at
      FROM storage_object_trust
      WHERE id = ${id}::uuid
      LIMIT 1
    `.execute(this.db);
    const row = result.rows[0];
    return row ? this.map(row) : null;
  }

  async recordAttempt(input: {
    objectTrustId: string;
    provider: string;
    result: ObjectScanResult;
    detectedMimeType: string | null;
    engineVersion: string | null;
    providerReference: string | null;
    malwareSignature: string | null;
    errorCode: string | null;
    startedAt: Date;
    completedAt: Date;
  }): Promise<ObjectTrustRecord> {
    return this.db.transaction().execute(async (trx) => {
      const current = await sql<{ status: ObjectTrustStatus }>`
        SELECT status
        FROM storage_object_trust
        WHERE id = ${input.objectTrustId}::uuid
        FOR UPDATE
      `.execute(trx);
      if (!current.rows[0]) throw new Error('Object trust record not found.');
      if (current.rows[0].status === 'CLEAN' || current.rows[0].status === 'REJECTED') {
        const final = await this.getById(input.objectTrustId);
        if (!final) throw new Error('Final object trust record disappeared.');
        return final;
      }

      const sequence = await sql<{ next_attempt: number }>`
        SELECT COALESCE(max(attempt_number), 0)::int + 1 AS next_attempt
        FROM storage_object_scan_attempts
        WHERE object_trust_id = ${input.objectTrustId}::uuid
      `.execute(trx);
      const attemptNumber = sequence.rows[0]?.next_attempt ?? 1;

      await sql`
        INSERT INTO storage_object_scan_attempts (
          object_trust_id, attempt_number, provider, result, detected_mime_type,
          engine_version, provider_reference, malware_signature, error_code,
          started_at, completed_at
        ) VALUES (
          ${input.objectTrustId}::uuid,
          ${attemptNumber},
          ${input.provider},
          ${input.result},
          ${input.detectedMimeType},
          ${input.engineVersion},
          ${input.providerReference},
          ${input.malwareSignature},
          ${input.errorCode},
          ${input.startedAt}::timestamptz,
          ${input.completedAt}::timestamptz
        )
      `.execute(trx);

      const status: ObjectTrustStatus = input.result === 'CLEAN'
        ? 'CLEAN'
        : input.result === 'INFECTED' || input.result === 'MIME_MISMATCH'
          ? 'REJECTED'
          : 'SCAN_FAILED';

      await sql`
        UPDATE storage_object_trust
        SET status = ${status},
            detected_mime_type = COALESCE(${input.detectedMimeType}, detected_mime_type),
            scanner_provider = ${input.provider},
            scanner_reference = ${input.providerReference},
            scanner_signature = ${input.malwareSignature},
            last_error_code = ${input.errorCode},
            scanned_at = CASE WHEN ${status} IN ('CLEAN','REJECTED') THEN ${input.completedAt}::timestamptz ELSE scanned_at END,
            updated_at = ${input.completedAt}::timestamptz
        WHERE id = ${input.objectTrustId}::uuid
      `.execute(trx);

      const refreshed = await sql<{
        id: string;
        tenant_id: string;
        project_id: string | null;
        purpose: ObjectTrustPurpose;
        object_key: string;
        declared_mime_type: string;
        detected_mime_type: string | null;
        byte_size: string | number;
        sha256_hex: string;
        status: ObjectTrustStatus;
        scanner_provider: string | null;
        scanner_reference: string | null;
        scanner_signature: string | null;
        last_error_code: string | null;
        scanned_at: Date | null;
      }>`
        SELECT id, tenant_id, project_id, purpose, object_key, declared_mime_type,
               detected_mime_type, byte_size, sha256_hex, status, scanner_provider,
               scanner_reference, scanner_signature, last_error_code, scanned_at
        FROM storage_object_trust
        WHERE id = ${input.objectTrustId}::uuid
      `.execute(trx);
      return this.map(refreshed.rows[0]!);
    });
  }

  private map(row: {
    id: string;
    tenant_id: string;
    project_id: string | null;
    purpose: ObjectTrustPurpose;
    object_key: string;
    declared_mime_type: string;
    detected_mime_type: string | null;
    byte_size: string | number;
    sha256_hex: string;
    status: ObjectTrustStatus;
    scanner_provider: string | null;
    scanner_reference: string | null;
    scanner_signature: string | null;
    last_error_code: string | null;
    scanned_at: Date | null;
  }): ObjectTrustRecord {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      projectId: row.project_id,
      purpose: row.purpose,
      objectKey: row.object_key,
      declaredMimeType: row.declared_mime_type,
      detectedMimeType: row.detected_mime_type,
      byteSize: Number(row.byte_size),
      sha256Hex: row.sha256_hex,
      status: row.status,
      scannerProvider: row.scanner_provider,
      scannerReference: row.scanner_reference,
      scannerSignature: row.scanner_signature,
      lastErrorCode: row.last_error_code,
      scannedAt: row.scanned_at?.toISOString() ?? null,
    };
  }
}
