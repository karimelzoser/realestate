import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readRuntimeContract } from './runtime-contract.mjs';

function fixture(files, source) {
  const root = mkdtempSync(join(tmpdir(), 'preneura-contract-'));
  mkdirSync(join(root, 'packages/database/migrations'), { recursive: true });
  mkdirSync(join(root, 'packages/database/src'), { recursive: true });
  for (const name of files) writeFileSync(join(root, 'packages/database/migrations', name), '');
  writeFileSync(join(root, 'packages/database/src/runtime-readiness.ts'), source);
  return root;
}

test('schema advances are checked against actual migrations rather than a stale release number', () => {
  const root = fixture(['0001_first.sql', '0002_next.sql'], "export const RUNTIME_SCHEMA_VERSION = 2;\nexport const RUNTIME_MIGRATION_MARKER = '0002_next';");
  try { assert.equal(readRuntimeContract(root).schemaVersion, 2); }
  finally { rmSync(root, { recursive: true }); }
});

test('a runtime missing the latest database contract fails closed', () => {
  const root = fixture(['0001_first.sql', '0002_next.sql'], "export const RUNTIME_SCHEMA_VERSION = 1;\nexport const RUNTIME_MIGRATION_MARKER = '0001_first';");
  try { assert.throws(() => readRuntimeContract(root), /latest migration/); }
  finally { rmSync(root, { recursive: true }); }
});

test('a migration sequence gap cannot be certified as complete', () => {
  const root = fixture(['0001_first.sql', '0003_next.sql'], "export const RUNTIME_SCHEMA_VERSION = 3;\nexport const RUNTIME_MIGRATION_MARKER = '0003_next';");
  try { assert.throws(() => readRuntimeContract(root), /contiguous/); }
  finally { rmSync(root, { recursive: true }); }
});
