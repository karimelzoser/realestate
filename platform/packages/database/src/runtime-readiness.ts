import { sql, type Kysely } from 'kysely';
import type { Database } from './index.js';

export const RUNTIME_SCHEMA_VERSION = 33;
export const RUNTIME_MIGRATION_MARKER = '0033_runtime_readiness_contract';

export type RuntimeReadinessErrorCode =
  | 'DATABASE_UNAVAILABLE'
  | 'SCHEMA_CONTRACT_MISSING'
  | 'SCHEMA_CONTRACT_MISMATCH';

export class RuntimeReadinessError extends Error {
  constructor(
    public readonly code: RuntimeReadinessErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'RuntimeReadinessError';
  }
}

export interface RuntimeReadinessSnapshot {
  database: 'ok';
  schema: 'ok';
  schemaVersion: number;
  migrationMarker: string;
  latencyMs: number;
}

export async function assertRuntimeReadiness(
  db: Kysely<Database>,
): Promise<RuntimeReadinessSnapshot> {
  const startedAt = performance.now();

  try {
    await sql`SELECT 1`.execute(db);
  } catch (error) {
    throw new RuntimeReadinessError(
      'DATABASE_UNAVAILABLE',
      'PostgreSQL connectivity check failed.',
      { cause: error },
    );
  }

  let row: { schema_version: number; migration_marker: string } | undefined;
  try {
    const result = await sql<{ schema_version: number; migration_marker: string }>`
      SELECT schema_version, migration_marker
      FROM platform_runtime_contract
      WHERE singleton_key = 'production'
    `.execute(db);
    row = result.rows[0];
  } catch (error) {
    throw new RuntimeReadinessError(
      'SCHEMA_CONTRACT_MISSING',
      'Runtime schema contract is not available.',
      { cause: error },
    );
  }

  if (!row) {
    throw new RuntimeReadinessError(
      'SCHEMA_CONTRACT_MISSING',
      'Runtime schema contract row is missing.',
    );
  }

  if (
    row.schema_version !== RUNTIME_SCHEMA_VERSION ||
    row.migration_marker !== RUNTIME_MIGRATION_MARKER
  ) {
    throw new RuntimeReadinessError(
      'SCHEMA_CONTRACT_MISMATCH',
      `Expected runtime schema ${RUNTIME_SCHEMA_VERSION}/${RUNTIME_MIGRATION_MARKER}.`,
    );
  }

  return {
    database: 'ok',
    schema: 'ok',
    schemaVersion: row.schema_version,
    migrationMarker: row.migration_marker,
    latencyMs: Math.max(0, Math.round(performance.now() - startedAt)),
  };
}
