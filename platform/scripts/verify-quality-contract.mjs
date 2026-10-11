import { access, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = process.cwd();
const mandatoryTests = [
  {
    path: 'apps/api/test/auth-assurance.test.ts',
    minimumDeclaredTests: 4,
  },
];
const workspaceManifests = [
  'apps/api/package.json',
  'apps/notification-gateway/package.json',
  'apps/web/package.json',
  'apps/worker/package.json',
  'packages/contracts/package.json',
  'packages/database/package.json',
  'packages/observability/package.json',
  'packages/security/package.json',
];

let declaredTests = 0;
for (const suite of mandatoryTests) {
  const absolute = resolve(root, suite.path);
  try {
    await access(absolute);
  } catch {
    throw new Error(`Mandatory test suite is missing: ${suite.path}`);
  }

  const source = await readFile(absolute, 'utf8');
  const count = [...source.matchAll(/\btest\s*\(/g)].length;
  if (count < suite.minimumDeclaredTests) {
    throw new Error(
      `Mandatory test suite ${suite.path} declares ${count} tests; expected at least ${suite.minimumDeclaredTests}.`,
    );
  }
  declaredTests += count;
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

for (const relative of workspaceManifests) {
  const manifest = JSON.parse(await readFile(resolve(root, relative), 'utf8'));
  const testCommand = String(manifest.scripts?.test ?? '').trim();
  if (testCommand === 'node --test') {
    throw new Error(
      `${relative} advertises a bare node --test command that can pass with zero tests. Remove it or point it at a real suite.`,
    );
  }
}

console.log(
  `QUALITY_CONTRACT_OK mandatorySuites=${mandatoryTests.length} declaredTests=${declaredTests}`,
);
