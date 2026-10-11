import { access, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = process.cwd();
const mandatoryTests = [
  'apps/api/test/auth-assurance.test.ts',
];

for (const relative of mandatoryTests) {
  try {
    await access(resolve(root, relative));
  } catch {
    throw new Error(`Mandatory test suite is missing: ${relative}`);
  }
}

const rootPackage = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
const apiPackage = JSON.parse(await readFile(resolve(root, 'apps/api/package.json'), 'utf8'));

if (!String(rootPackage.scripts?.test ?? '').includes('verify-quality-contract.mjs')) {
  throw new Error('Root test command must verify the quality contract before Turbo runs.');
}
if (!String(rootPackage.scripts?.lint ?? '').includes('static-policy-lint.mjs')) {
  throw new Error('Root lint command must execute the static policy scanner.');
}
if (!String(apiPackage.scripts?.test ?? '').includes('auth-assurance.test.ts')) {
  throw new Error('API test command must execute the privileged-assurance suite explicitly.');
}

console.log(`QUALITY_CONTRACT_OK mandatoryTests=${mandatoryTests.length}`);
