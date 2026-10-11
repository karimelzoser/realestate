import type { AccessRoleCode } from '@preneura/database';

export type SessionAuthMethod = 'OTP' | 'OIDC_GOOGLE';
export type AssuranceLevel = 'AAL1' | 'AAL2';

export interface SessionAssuranceEvidence {
  authMethod: SessionAuthMethod;
  assuranceLevel: AssuranceLevel;
  providerAcr?: string | null;
  providerAmr?: readonly string[];
}

export const PRIVILEGED_ROLE_CODES = new Set<AccessRoleCode>([
  'PRENEURA_SUPER_ADMIN',
  'OPERATIONS_DIRECTOR',
  'MANAGER',
  'ALLOCATOR',
  'TRANSACTION_OPERATOR',
  'BROKER_MANAGER',
  'BROKER_FINANCE',
]);

const MFA_AMR_VALUES = new Set(['mfa', 'otp', 'hwk', 'swk']);

export function oidcAssuranceFromClaims(input: {
  acr?: unknown;
  amr?: unknown;
  approvedAcrValues: readonly string[];
}): SessionAssuranceEvidence {
  const providerAcr = typeof input.acr === 'string' ? input.acr : null;
  const providerAmr = Array.isArray(input.amr)
    ? input.amr.filter((value): value is string => typeof value === 'string')
    : [];

  const acrApproved = Boolean(
    providerAcr && input.approvedAcrValues.includes(providerAcr),
  );
  const mfaObserved = providerAmr.some((value) => MFA_AMR_VALUES.has(value.toLowerCase()));

  return {
    authMethod: 'OIDC_GOOGLE',
    assuranceLevel: acrApproved || mfaObserved ? 'AAL2' : 'AAL1',
    providerAcr,
    providerAmr,
  };
}

export function otpAssurance(): SessionAssuranceEvidence {
  return {
    authMethod: 'OTP',
    assuranceLevel: 'AAL1',
    providerAcr: null,
    providerAmr: [],
  };
}
