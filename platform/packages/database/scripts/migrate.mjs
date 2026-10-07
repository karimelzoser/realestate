import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const { Client } = pg;
const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL is required');

const scriptDir = dirname(fileURLToPath(import.meta.url));
const defaultMigrationsDir = resolve(scriptDir, '..', 'migrations');
const migrationsDir = resolve(process.env.MIGRATIONS_DIR ?? defaultMigrationsDir);
const adoptExisting = process.env.MIGRATION_ADOPT_EXISTING === 'true';
const actor = process.env.MIGRATION_ACTOR ?? process.env.RAILWAY_SERVICE_NAME ?? 'manual-release';
const lockKey = 'preneura_schema_migrations_v1';

function log(event, details = {}) {
  console.log(JSON.stringify({ event, at: new Date().toISOString(), ...details }));
}

function sha256(content) {
  return createHash('sha256').update(content).digest('hex');
}

function migrationBody(sql, filename) {
  const beginPattern = /^\s*BEGIN\s*;\s*/i;
  const commitPattern = /\s*COMMIT\s*;\s*$/i;
  const hasBegin = beginPattern.test(sql);
  const hasCommit = commitPattern.test(sql);

  if (hasBegin !== hasCommit) {
    throw new Error(`Migration ${filename} must contain both outer BEGIN and COMMIT, or neither.`);
  }

  if (!hasBegin) return sql;
  return sql.replace(beginPattern, '').replace(commitPattern, '');
}

async function loadMigrations() {
  const filenames = (await readdir(migrationsDir))
    .filter((name) => /^\d{4}_[a-z0-9_]+\.sql$/i.test(name))
    .sort((a, b) => a.localeCompare(b));

  if (filenames.length === 0) throw new Error(`No SQL migrations found in ${migrationsDir}`);

  const seenVersions = new Set();
  const migrations = [];
  for (const filename of filenames) {
    const version = Number(filename.slice(0, 4));
    if (!Number.isInteger(version) || version <= 0) throw new Error(`Invalid migration version: ${filename}`);
    if (seenVersions.has(version)) throw new Error(`Duplicate migration version ${version}`);
    seenVersions.add(version);
    const sql = await readFile(join(migrationsDir, filename), 'utf8');
    migrations.push({
      filename,
      version,
      executionSql: migrationBody(sql, filename),
      checksum: sha256(sql),
    });
  }

  for (let index = 0; index < migrations.length; index += 1) {
    const expected = index + 1;
    if (migrations[index].version !== expected) {
      throw new Error(`Migration sequence gap: expected ${String(expected).padStart(4, '0')} but found ${migrations[index].filename}`);
    }
  }

  return migrations;
}

async function ensureLedger(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS platform_schema_migrations (
      version INTEGER PRIMARY KEY CHECK (version > 0),
      filename TEXT NOT NULL UNIQUE,
      checksum_sha256 TEXT NOT NULL CHECK (checksum_sha256 ~ '^[0-9a-f]{64}$'),
      apply_mode TEXT NOT NULL CHECK (apply_mode IN ('APPLIED', 'ADOPTED')),
      applied_by TEXT NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
      duration_ms INTEGER NOT NULL CHECK (duration_ms >= 0)
    )
  `);
}

async function verifyExistingRows(client, migrations) {
  const result = await client.query(
    'SELECT version, filename, checksum_sha256 FROM platform_schema_migrations ORDER BY version',
  );
  const migrationByVersion = new Map(migrations.map((migration) => [migration.version, migration]));

  for (const row of result.rows) {
    const migration = migrationByVersion.get(Number(row.version));
    if (!migration) throw new Error(`Database contains unknown migration version ${row.version}`);
    if (row.filename !== migration.filename) {
      throw new Error(`Migration filename mismatch for version ${row.version}: database=${row.filename}, code=${migration.filename}`);
    }
    if (row.checksum_sha256 !== migration.checksum) {
      throw new Error(`Migration checksum mismatch for ${migration.filename}; applied migrations are immutable`);
    }
  }

  return result.rows.length;
}

async function adoptCurrentSchema(client, migrations) {
  const latest = migrations.at(-1);
  const marker = latest.filename.replace(/\.sql$/i, '');
  const contract = await client.query(
    `SELECT schema_version, migration_marker
       FROM platform_runtime_contract
      WHERE singleton_key = 'production'`,
  ).catch(() => ({ rows: [] }));
  const row = contract.rows[0];

  if (!row || Number(row.schema_version) !== latest.version || row.migration_marker !== marker) {
    throw new Error(
      `Cannot adopt existing schema: expected runtime contract ${latest.version}/${marker}. Apply and verify the full schema first.`,
    );
  }

  await client.query('BEGIN');
  try {
    for (const migration of migrations) {
      await client.query(
        `INSERT INTO platform_schema_migrations
           (version, filename, checksum_sha256, apply_mode, applied_by, duration_ms)
         VALUES ($1, $2, $3, 'ADOPTED', $4, 0)`,
        [migration.version, migration.filename, migration.checksum, actor],
      );
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
  log('migrations.adopted', { count: migrations.length, latest: latest.filename });
}

async function applyPending(client, migrations) {
  const applied = await client.query('SELECT version FROM platform_schema_migrations ORDER BY version');
  const appliedVersions = new Set(applied.rows.map((row) => Number(row.version)));
  let appliedCount = 0;

  for (const migration of migrations) {
    if (appliedVersions.has(migration.version)) continue;
    const startedAt = Date.now();
    log('migration.applying', { version: migration.version, filename: migration.filename });
    await client.query('BEGIN');
    try {
      await client.query(migration.executionSql);
      await client.query(
        `INSERT INTO platform_schema_migrations
           (version, filename, checksum_sha256, apply_mode, applied_by, duration_ms)
         VALUES ($1, $2, $3, 'APPLIED', $4, $5)`,
        [migration.version, migration.filename, migration.checksum, actor, Math.max(0, Date.now() - startedAt)],
      );
      await client.query('COMMIT');
      appliedCount += 1;
      log('migration.applied', {
        version: migration.version,
        filename: migration.filename,
        durationMs: Math.max(0, Date.now() - startedAt),
      });
    } catch (error) {
      await client.query('ROLLBACK');
      throw new Error(`Migration failed: ${migration.filename}`, { cause: error });
    }
  }

  return appliedCount;
}

const client = new Client({ connectionString, connectionTimeoutMillis: 5000 });
let connected = false;
let lockAcquired = false;
try {
  const migrations = await loadMigrations();
  await client.connect();
  connected = true;
  await client.query('SELECT pg_advisory_lock(hashtext($1))', [lockKey]);
  lockAcquired = true;
  log('migrations.lock_acquired', { count: migrations.length });

  await ensureLedger(client);
  const existingCount = await verifyExistingRows(client, migrations);

  if (existingCount === 0 && adoptExisting) {
    await adoptCurrentSchema(client, migrations);
  } else {
    const appliedCount = await applyPending(client, migrations);
    await verifyExistingRows(client, migrations);
    log('migrations.complete', { appliedCount, total: migrations.length });
  }
} finally {
  if (connected && lockAcquired) {
    await client.query('SELECT pg_advisory_unlock(hashtext($1))', [lockKey]).catch(() => undefined);
  }
  if (connected) await client.end().catch(() => undefined);
}
