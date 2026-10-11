import { sql, type Kysely } from 'kysely';
import type { Database } from './index.js';

export const RUNTIME_SCHEMA_VERSION = 33;
export const RUNTIME_MIGRATION_MARKER = '0033_runtime_readiness_contract';

export type RuntimeReadinessErrorCode =
  | 'DATABASE_UNAVAILABLE'
  | 'SCHEMA_CONTRACT_MISSING'
  | 'SCHEMA_TOO_OLD'
  | 'RUNTIME_VERSION_TOO_OLD'
  | 'SCHEMA_CONTRACT_MISMATCH'
  | 'MIGRATION_LEDGER_MISMATCH';

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
  runtimeSchemaVersion: number;
  databaseSchemaVersion: number;
  minimumRuntimeVersion: number;
  migrationMarker: string;
  migrationLedgerVersion: number;
  latencyMs: number;
}

interface RuntimeContractRow {
  schema_version: number;
  minimum_runtime_version: number;
  migration_marker: string;
}

interface MigrationLedgerRow {
  version: number;
  filename: string;
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

  let contract: RuntimeContractRow | undefined;
  try {
    const result = await sql<RuntimeContractRow>`
      SELECT schema_version, minimum_runtime_version, migration_marker
      FROM platform_runtime_contract
      WHERE singleton_key = 'production'
    `.execute(db);
    contract = result.rows[0];
  } catch (error) {
    throw new RuntimeReadinessError(
      'SCHEMA_CONTRACT_MISSING',
      'Runtime schema contract is not available.',
      { cause: error },
    );
  }

  if (!contract) {
    throw new RuntimeReadinessError(
      'SCHEMA_CONTRACT_MISSING',
      'Runtime schema contract row is missing.',
    );
  }

  if (contract.schema_version < RUNTIME_SCHEMA_VERSION) {
    throw new RuntimeReadinessError(
      'SCHEMA_TOO_OLD',
      `Database schema ${contract.schema_version} is older than runtime schema ${RUNTIME_SCHEMA_VERSION}.`,
    );
  }

  if (contract.minimum_runtime_version > RUNTIME_SCHEMA_VERSION) {
    throw new RuntimeReadinessError(
      'RUNTIME_VERSION_TOO_OLD',
      `Runtime schema ${RUNTIME_SCHEMA_VERSION} is older than the database minimum ${contract.minimum_runtime_version}.`,
    );
  }

  if (
    contract.schema_version === RUNTIME_SCHEMA_VERSION &&
    contract.migration_marker !== RUNTIME_MIGRATION_MARKER
  ) {
    throw new RuntimeReadinessError(
      'SCHEMA_CONTRACT_MISMATCH',
      `Runtime schema ${RUNTIME_SCHEMA_VERSION} does not match migration marker ${RUNTIME_MIGRATION_MARKER}.`,
    );
  }

  let ledger: MigrationLedgerRow | undefined;
  try {
    const result = await sql<MigrationLedgerRow>`
      SELECT version, filename
      FROM platform_schema_migrations
      ORDER BY version DESC
      LIMIT 1
    `.execute(db);
    ledger = result.rows[0];
  } catch (error) {
    throw new RuntimeReadinessError(
      'MIGRATION_LEDGER_MISMATCH',
      'Migration ledger is not available.',
      { cause: error },
    );
  }

  const expectedFilename = `${contract.migration_marker}.sql`;
  if (
    !ledger ||
    ledger.version !== contract.schema_version ||
    ledger.filename !== expectedFilename
  ) {
    throw new RuntimeReadinessError(
      'MIGRATION_LEDGER_MISMATCH',
      `Runtime contract ${contract.schema_version}/${contract.migration_marker} is not backed by the migration ledger.`,
    );
  }

  return {
    database: 'ok',
    schema: 'ok',
    runtimeSchemaVersion: RUNTIME_SCHEMA_VERSION,
    databaseSchemaVersion: contract.schema_version,
    minimumRuntimeVersion: contract.minimum_runtime_version,
    migrationMarker: contract.migration_marker,
    migrationLedgerVersion: ledger.version,
    latencyMs: Math.max(0, Math.round(performance.now() - startedAt)),
  };
}
