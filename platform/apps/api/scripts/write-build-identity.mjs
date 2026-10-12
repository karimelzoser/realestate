import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const explicit = process.env.PRENEURA_BUILD_SHA?.trim();
const gitSha = explicit || execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();

if (!/^[0-9a-f]{40,64}$/i.test(gitSha)) {
  throw new Error('PRENEURA_BUILD_SHA/git HEAD must be a 40-64 character hexadecimal commit identity.');
}

const outputDirectory = resolve(process.cwd(), 'dist');
await mkdir(outputDirectory, { recursive: true });
await writeFile(
  resolve(outputDirectory, 'build-identity.json'),
  `${JSON.stringify({ gitSha: gitSha.toLowerCase(), builtAt: new Date().toISOString() }, null, 2)}\n`,
  'utf8',
);

console.log(`BUILD_IDENTITY_WRITTEN ${gitSha.toLowerCase()}`);
