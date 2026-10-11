import { z } from 'zod';

export const identityDocumentKindSchema = z.enum(['NATIONAL_ID', 'PASSPORT']);
export type IdentityDocumentKind = z.infer<typeof identityDocumentKindSchema>;

export const identityDocumentStatusSchema = z.enum([
  'DECLARED',
  'REVIEWED',
  'EXTERNAL_VERIFIED',
  'REJECTED',
]);
export type IdentityDocumentStatus = z.infer<typeof identityDocumentStatusSchema>;

export const identityConsentPurposeSchema = z.enum([
  'IDENTITY_PROCESSING',
  'ACCOUNT_RECOVERY',
]);
export type IdentityConsentPurpose = z.infer<typeof identityConsentPurposeSchema>;

export const declareIdentityDocumentSchema = z.object({
  kind: identityDocumentKindSchema,
  identifier: z.string().trim().min(5).max(64),
  countryCode: z.string().trim().length(2).regex(/^[A-Za-z]{2}$/).optional(),
  consentPolicyVersion: z.string().trim().min(1).max(80),
});
export type DeclareIdentityDocumentInput = z.infer<typeof declareIdentityDocumentSchema>;

export const identityConsentSchema = z.object({
  purpose: identityConsentPurposeSchema,
  policyVersion: z.string().trim().min(1).max(80),
  action: z.enum(['GRANTED', 'REVOKED']),
});
export type IdentityConsentInput = z.infer<typeof identityConsentSchema>;

export const reviewIdentityDocumentSchema = z.object({
  decision: z.enum(['REVIEWED', 'REJECTED']),
  note: z.string().trim().max(500).optional(),
});
export type ReviewIdentityDocumentInput = z.infer<typeof reviewIdentityDocumentSchema>;

export const identityRecoveryStartSchema = z.object({
  tenantId: z.uuid(),
  kind: identityDocumentKindSchema,
  identifier: z.string().trim().min(5).max(64),
  countryCode: z.string().trim().length(2).regex(/^[A-Za-z]{2}$/).optional(),
  channel: z.enum(['SMS', 'WHATSAPP']).default('SMS'),
});
export type IdentityRecoveryStartInput = z.infer<typeof identityRecoveryStartSchema>;

export const identityRecoveryVerifySchema = z.object({
  challengeId: z.uuid(),
  code: z.string().regex(/^\d{6}$/),
});
export type IdentityRecoveryVerifyInput = z.infer<typeof identityRecoveryVerifySchema>;

export const identityRecoveryStartResponseSchema = z.object({
  challengeId: z.uuid(),
  expiresInSeconds: z.number().int().positive(),
  message: z.string(),
});
export type IdentityRecoveryStartResponse = z.infer<typeof identityRecoveryStartResponseSchema>;

export const genericIdentityRecoveryMessage =
  'If the details match an eligible tenant account, a one-time code will be sent to the verified phone.';

export interface IdentityDocumentSnapshot {
  kind: IdentityDocumentKind;
  countryCode: string;
  displayHint: string;
  status: IdentityDocumentStatus;
  declaredAt: string;
  reviewedAt: string | null;
  verifiedAt: string | null;
}

export interface IdentityConsentSnapshot {
  purpose: IdentityConsentPurpose;
  granted: boolean;
  policyVersion: string | null;
  changedAt: string | null;
}

export interface IdentityProfileSnapshot {
  tenantId: string;
  userId: string;
  phonePossessionVerified: boolean;
  document: IdentityDocumentSnapshot | null;
  consents: IdentityConsentSnapshot[];
  verificationSemantics: {
    phoneOtpProves: 'PHONE_POSSESSION';
    phoneOtpDoesNotProve: 'NATIONAL_ID_OR_PASSPORT_OWNERSHIP';
  };
}
