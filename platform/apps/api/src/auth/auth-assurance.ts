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

/**
 * PRENEURA treats an IdP session as privileged AAL2 only when the provider has
 * made an explicit multi-factor assertion. A bare `otp`, `hwk` or `swk` AMR
 * value is authentication-method evidence, but it does not by itself prove that
 * two factors were used. Deployments that rely on an IdP-specific MFA flow
 * should map it to one of OIDC_AAL2_ACR_VALUES or emit the standard `mfa` AMR.
 */
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
  const explicitMfaObserved = providerAmr.some(
    (value) => value.toLowerCase() === 'mfa',
  );

  return {
    authMethod: 'OIDC_GOOGLE',
    assuranceLevel: acrApproved || explicitMfaObserved ? 'AAL2' : 'AAL1',
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
