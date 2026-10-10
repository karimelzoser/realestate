import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool, type PoolClient } from 'pg';
import {
  RUNTIME_MIGRATION_MARKER,
  RUNTIME_SCHEMA_VERSION,
} from './runtime-readiness.js';

type MigrationFile = {
  version: number;
  name: string;
  filename: string;
  checksum: string;
  sql: string;
};

type AppliedMigration = {
  version: number;
  name: string;
  checksum_sha256: string;
};

type Mode = 'migrate' | 'check' | 'baseline';

const DATABASE_URL = required('DATABASE_URL');
const MIGRATIONS_DIR = process.env.MIGRATIONS_DIR
  ? resolve(process.env.MIGRATIONS_DIR)
  : resolve(dirname(fileURLToPath(import.meta.url)), '../migrations');
const MIGRATION_LOCK_NAME = 'preneura-platform-schema-migrations';

async function main(): Promise<void> {
  const mode = parseMode(process.argv.slice(2));
  const pool = new Pool({ connectionString: DATABASE_URL, max: 1, connectionTimeoutMillis: 5_000 });
  const client = await pool.connect();

  try {
    await acquireLock(client);
    await ensureHistoryTable(client);

    const files = await loadMigrationFiles();
    validateMigrationSequence(files);
    validateRuntimeMarker(files);

    if (mode === 'baseline') {
      await baselineExistingSchema(client, files);
      log('migration.baseline_complete', { count: files.length });
      return;
    }

    const applied = await loadAppliedMigrations(client);
    verifyAppliedHistory(files, applied);
    const pending = files.filter((migration) => !applied.has(migration.version));

    if (mode === 'check') {
      if (pending.length > 0) {
        throw new Error(`Database has ${pending.length} pending migration(s): ${pending.map((m) => m.filename).join(', ')}`);
      }
      await assertRuntimeContract(client);
      log('migration.check_ok', { applied: applied.size, latestVersion: RUNTIME_SCHEMA_VERSION });
      return;
    }

    for (const migration of pending) {
      await applyMigration(client, migration);
    }

    const refreshed = await loadAppliedMigrations(client);
    verifyAppliedHistory(files, refreshed);
    await assertRuntimeContract(client);
    log('migration.complete', {
      appliedNow: pending.length,
      totalApplied: refreshed.size,
      latestVersion: RUNTIME_SCHEMA_VERSION,
      latestMarker: RUNTIME_MIGRATION_MARKER,
    });
  } finally {
    await releaseLock(client).catch(() => undefined);
    client.release();
    await pool.end();
  }
}

async function loadMigrationFiles(): Promise<MigrationFile[]> {
  const filenames = (await readdir(MIGRATIONS_DIR))
    .filter((name) => /^\d{4}_[a-z0-9_]+\.sql$/i.test(name))
    .sort((a, b) => a.localeCompare(b));

  return Promise.all(
    filenames.map(async (filename) => {
      const sql = await readFile(resolve(MIGRATIONS_DIR, filename), 'utf8');
      const version = Number(filename.slice(0, 4));
      return {
        version,
        name: filename.replace(/\.sql$/i, ''),
        filename,
        checksum: createHash('sha256').update(sql, 'utf8').digest('hex'),
        sql,
      };
    }),
  );
}

function validateMigrationSequence(files: readonly MigrationFile[]): void {
  if (files.length === 0) throw new Error(`No migration files found in ${MIGRATIONS_DIR}.`);
  files.forEach((migration, index) => {
    const expected = index + 1;
    if (migration.version !== expected) {
      throw new Error(`Migration sequence is not contiguous: expected ${String(expected).padStart(4, '0')}, found ${migration.filename}.`);
    }
  });
}

function validateRuntimeMarker(files: readonly MigrationFile[]): void {
  const latest = files.at(-1);
  if (!latest) throw new Error('No migrations available.');
  if (latest.version !== RUNTIME_SCHEMA_VERSION || latest.name !== RUNTIME_MIGRATION_MARKER) {
    throw new Error(
      `Runtime schema contract ${RUNTIME_SCHEMA_VERSION}/${RUNTIME_MIGRATION_MARKER} does not match latest migration ${latest.version}/${latest.name}.`,
    );
  }
}

async function ensureHistoryTable(client: PoolClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS platform_schema_migrations (
      version integer PRIMARY KEY CHECK (version > 0),
      name text NOT NULL UNIQUE,
      checksum_sha256 char(64) NOT NULL CHECK (checksum_sha256 ~ '^[0-9a-f]{64}$'),
      applied_at timestamptz NOT NULL DEFAULT now(),
      applied_by text NOT NULL DEFAULT current_user
    )
  `);
}

async function loadAppliedMigrations(client: PoolClient): Promise<Map<number, AppliedMigration>> {
  const result = await client.query<AppliedMigration>(`
    SELECT version, name, checksum_sha256
    FROM platform_schema_migrations
    ORDER BY version
  `);
  return new Map(result.rows.map((row) => [row.version, row]));
}

function verifyAppliedHistory(files: readonly MigrationFile[], applied: ReadonlyMap<number, AppliedMigration>): void {
  for (const row of applied.values()) {
    const migration = files.find((candidate) => candidate.version === row.version);
    if (!migration) throw new Error(`Database contains unknown applied migration version ${row.version}.`);
    if (migration.name !== row.name) {
      throw new Error(`Migration name mismatch at version ${row.version}: database=${row.name}, repository=${migration.name}.`);
    }
    if (migration.checksum !== row.checksum_sha256) {
      throw new Error(`Migration checksum mismatch for ${migration.filename}; applied migrations are immutable.`);
    }
  }
}

async function applyMigration(client: PoolClient, migration: MigrationFile): Promise<void> {
  if (/^\s*--\s*preneura:no-transaction\b/im.test(migration.sql)) {
    throw new Error(
      `${migration.filename} requests no-transaction execution. The current production runner requires atomic migrations; split the migration or extend the reviewed runner deliberately.`,
    );
  }

  log('migration.applying', { version: migration.version, name: migration.name });
  await client.query('BEGIN');
  try {
    await client.query(migration.sql);
    await client.query(
      `INSERT INTO platform_schema_migrations (version, name, checksum_sha256) VALUES ($1, $2, $3)`,
      [migration.version, migration.name, migration.checksum],
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  }
}

async function baselineExistingSchema(client: PoolClient, files: readonly MigrationFile[]): Promise<void> {
  const applied = await loadAppliedMigrations(client);
  if (applied.size > 0) {
    throw new Error('--baseline-existing is permitted only when migration history is empty.');
  }

  await assertRuntimeContract(client);
  await client.query('BEGIN');
  try {
    for (const migration of files) {
      await client.query(
        `INSERT INTO platform_schema_migrations (version, name, checksum_sha256) VALUES ($1, $2, $3)`,
        [migration.version, migration.name, migration.checksum],
      );
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  }
}

async function assertRuntimeContract(client: PoolClient): Promise<void> {
  const result = await client.query<{ schema_version: number; migration_marker: string }>(`
    SELECT schema_version, migration_marker
    FROM platform_runtime_contract
    WHERE singleton_key = 'production'
  `);
  const row = result.rows[0];
  if (!row) throw new Error('Runtime schema contract row is missing after migration.');
  if (row.schema_version !== RUNTIME_SCHEMA_VERSION || row.migration_marker !== RUNTIME_MIGRATION_MARKER) {
    throw new Error(
      `Runtime schema contract mismatch after migration: expected ${RUNTIME_SCHEMA_VERSION}/${RUNTIME_MIGRATION_MARKER}, received ${row.schema_version}/${row.migration_marker}.`,
    );
  }
}

async function acquireLock(client: PoolClient): Promise<void> {
  await client.query(`SELECT pg_advisory_lock(hashtextextended($1, 0))`, [MIGRATION_LOCK_NAME]);
}

async function releaseLock(client: PoolClient): Promise<void> {
  await client.query(`SELECT pg_advisory_unlock(hashtextextended($1, 0))`, [MIGRATION_LOCK_NAME]);
}

function parseMode(args: readonly string[]): Mode {
  const supported = new Set(['--check', '--baseline-existing']);
  const unknown = args.filter((arg) => !supported.has(arg));
  if (unknown.length > 0) throw new Error(`Unknown migration argument(s): ${unknown.join(', ')}`);
  if (args.includes('--check') && args.includes('--baseline-existing')) {
    throw new Error('--check and --baseline-existing cannot be used together.');
  }
  if (args.includes('--check')) return 'check';
  if (args.includes('--baseline-existing')) return 'baseline';
  return 'migrate';
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function log(event: string, details: Record<string, unknown>): void {
  console.log(JSON.stringify({ level: 'info', event, at: new Date().toISOString(), ...details }));
}

void main().catch((error) => {
  console.error(
    JSON.stringify({
      level: 'error',
      event: 'migration.failed',
      at: new Date().toISOString(),
      error: error instanceof Error ? error.message : String(error),
    }),
  );
  process.exitCode = 1;
});
