import { readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function readRuntimeContract(platform = resolve(dirname(fileURLToPath(import.meta.url)), '..')) {
  const source = readFileSync(resolve(platform, 'packages/database/src/runtime-readiness.ts'), 'utf8');
  const version = Number(source.match(/export const RUNTIME_SCHEMA_VERSION = (\d+);/)?.[1]);
  const marker = source.match(/export const RUNTIME_MIGRATION_MARKER = '([a-z0-9_]+)';/)?.[1];
  const migrations = readdirSync(resolve(platform, 'packages/database/migrations'))
    .filter((name) => /^\d{4}_[a-z0-9_]+\.sql$/.test(name)).sort();
  for (const [index, name] of migrations.entries()) {
    if (Number(name.slice(0, 4)) !== index + 1) throw new Error(`Migration sequence is not contiguous at ${name}.`);
  }
  if (!Number.isInteger(version) || !marker || migrations.at(-1) !== `${marker}.sql`
      || Number(marker.slice(0, 4)) !== version) {
    throw new Error('Runtime schema/marker must match the complete latest migration sequence.');
  }
  return { schemaVersion: version, migrationMarker: marker, migrationFile: `${marker}.sql` };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const contract = readRuntimeContract();
  const field = process.argv[2];
  if (field && !Object.hasOwn(contract, field)) throw new Error('Unknown runtime contract field.');
  console.log(field ? contract[field] : JSON.stringify(contract));
}
