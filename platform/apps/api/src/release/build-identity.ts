import { readFileSync } from 'node:fs';

export interface BuildIdentity {
  gitSha: string;
  builtAt: string | null;
  expectedGitSha: string | null;
  matchesExpected: boolean | null;
}

export function readBuildIdentity(): BuildIdentity {
  const fileIdentity = readIdentityFile();
  const configuredSha = normalizeSha(process.env.PRENEURA_BUILD_SHA);
  const gitSha = fileIdentity?.gitSha ?? configuredSha ?? 'development';
  const expectedGitSha = normalizeSha(process.env.PRENEURA_EXPECTED_RELEASE_SHA);

  return {
    gitSha,
    builtAt: fileIdentity?.builtAt ?? null,
    expectedGitSha,
    matchesExpected: expectedGitSha ? gitSha === expectedGitSha : null,
  };
}

export function assertExpectedBuildIdentity(): BuildIdentity {
  const identity = readBuildIdentity();
  if (identity.expectedGitSha && identity.gitSha !== identity.expectedGitSha) {
    throw new Error(
      `Release identity mismatch: running ${identity.gitSha}, expected ${identity.expectedGitSha}.`,
    );
  }
  return identity;
}

function readIdentityFile(): { gitSha: string; builtAt: string | null } | null {
  try {
    const url = new URL('../build-identity.json', import.meta.url);
    const parsed = JSON.parse(readFileSync(url, 'utf8')) as {
      gitSha?: unknown;
      builtAt?: unknown;
    };
    const gitSha = normalizeSha(parsed.gitSha);
    if (!gitSha) return null;
    return {
      gitSha,
      builtAt: typeof parsed.builtAt === 'string' ? parsed.builtAt : null,
    };
  } catch {
    return null;
  }
}

function normalizeSha(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  return /^[0-9a-f]{40,64}$/.test(normalized) ? normalized : null;
}
