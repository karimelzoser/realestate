export type ContractExecutionPriceComponent = 'INDOOR' | 'ROOF' | 'GARDEN';
export type ContractExecutionSignerRole = 'BUYER' | 'COMPANY' | 'WITNESS' | 'BROKER';
export type ContractExecutionSignatureMethod = 'DRAWN' | 'TYPED' | 'UPLOAD' | 'EXTERNAL_PROVIDER';

export interface ContractExecutionSnapshot {
  snapshotId: string;
  transactionId: string;
  reservationId: string;
  documentId: string;
  documentSha256Hex: string;
  objectTrustStatus: 'CLEAN' | 'LEGACY_UNSCANNED';
  templateId: string;
  templateVersionNumber: number;
  templateSha256Hex: string;
  pricingVersionId: string;
  quotedTotal: string;
  currency: string;
  priceComponents: Array<{
    component: ContractExecutionPriceComponent;
    areaSqm: string;
    ratePerSqm: string;
    amount: string;
  }>;
  signatures: Array<{
    signerRole: ContractExecutionSignerRole;
    signerUserId: string | null;
    method: ContractExecutionSignatureMethod;
    typedName: string | null;
    signatureSha256Hex: string | null;
    provider: string | null;
    providerEnvelopeId: string | null;
    signedAt: string;
  }>;
  manifest: Record<string, unknown>;
  manifestSha256Hex: string;
  executedAt: string;
  executedBy: string | null;
}
