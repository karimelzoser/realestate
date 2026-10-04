import { z } from 'zod';

export const documentCategorySchema = z.enum([
  'BUYER_ID',
  'PASSPORT',
  'ADDRESS_PROOF',
  'PAYMENT_RECEIPT',
  'CHEQUE',
  'CONTRACT',
  'STAMPED_CONTRACT',
  'OTHER',
]);
export type DocumentCategory = z.infer<typeof documentCategorySchema>;

export const documentStatusSchema = z.enum([
  'REQUESTED',
  'UPLOADING',
  'UPLOADED',
  'VERIFIED',
  'REJECTED',
  'SIGNED',
  'STAMPED',
  'SUPERSEDED',
]);
export type DocumentStatus = z.infer<typeof documentStatusSchema>;

export const signatureMethodSchema = z.enum(['DRAWN', 'TYPED', 'UPLOAD', 'EXTERNAL_PROVIDER']);
export type SignatureMethod = z.infer<typeof signatureMethodSchema>;

export const signerRoleSchema = z.enum(['BUYER', 'COMPANY', 'WITNESS', 'BROKER']);
export type SignerRole = z.infer<typeof signerRoleSchema>;

export const sha256Base64Schema = z.string().regex(/^[A-Za-z0-9+/]{43}=$/);

export const documentMimeTypeSchema = z.enum([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);

export const documentUploadDescriptorSchema = z.object({
  filename: z.string().trim().min(1).max(255),
  mimeType: documentMimeTypeSchema,
  byteSize: z.number().int().min(1).max(25 * 1024 * 1024),
  sha256Base64: sha256Base64Schema,
});

export const templateUploadIntentSchema = z.object({
  tenantId: z.uuid(),
  projectId: z.uuid().nullable().optional(),
  code: z.string().trim().min(1).max(80),
  file: documentUploadDescriptorSchema,
});
export type TemplateUploadIntentInput = z.infer<typeof templateUploadIntentSchema>;

export const createDocumentTemplateSchema = z.object({
  tenantId: z.uuid(),
  projectId: z.uuid().nullable().optional(),
  code: z.string().trim().min(1).max(80),
  name: z.string().trim().min(1).max(180),
  category: documentCategorySchema,
  objectKey: z.string().min(1).max(1024),
  file: documentUploadDescriptorSchema,
  requiresSignature: z.boolean().default(false),
  signerRequirements: z
    .array(
      z.object({
        signerRole: signerRoleSchema,
        signingOrder: z.number().int().min(1).max(20).default(1),
        required: z.boolean().default(true),
      }),
    )
    .max(10)
    .default([]),
});
export type CreateDocumentTemplateInput = z.infer<typeof createDocumentTemplateSchema>;

export const transactionDocumentUploadIntentSchema = z.object({
  tenantId: z.uuid(),
  projectId: z.uuid(),
  transactionId: z.uuid(),
  category: documentCategorySchema,
  templateId: z.uuid().nullable().optional(),
  dueAt: z.iso.datetime({ offset: true }).nullable().optional(),
  file: documentUploadDescriptorSchema,
});
export type TransactionDocumentUploadIntentInput = z.infer<typeof transactionDocumentUploadIntentSchema>;

export const finalizeTransactionDocumentSchema = z.object({
  tenantId: z.uuid(),
  projectId: z.uuid(),
  transactionId: z.uuid(),
  documentId: z.uuid(),
  objectKey: z.string().min(1).max(1024),
  file: documentUploadDescriptorSchema,
});
export type FinalizeTransactionDocumentInput = z.infer<typeof finalizeTransactionDocumentSchema>;

export const reviewTransactionDocumentSchema = z.object({
  tenantId: z.uuid(),
  projectId: z.uuid(),
  transactionId: z.uuid(),
  documentId: z.uuid(),
  decision: z.enum(['VERIFY', 'REJECT']),
  rejectionReason: z.string().trim().min(1).max(2000).optional(),
}).superRefine((value, ctx) => {
  if (value.decision === 'REJECT' && !value.rejectionReason) {
    ctx.addIssue({ code: 'custom', message: 'Rejection reason is required.' });
  }
});
export type ReviewTransactionDocumentInput = z.infer<typeof reviewTransactionDocumentSchema>;

export const signatureUploadIntentSchema = z.object({
  tenantId: z.uuid(),
  projectId: z.uuid(),
  transactionId: z.uuid(),
  documentId: z.uuid(),
  signerRole: signerRoleSchema,
  method: z.enum(['DRAWN', 'UPLOAD']),
  file: z.object({
    filename: z.string().trim().min(1).max(255),
    mimeType: z.enum(['image/png', 'image/jpeg']),
    byteSize: z.number().int().min(1).max(5 * 1024 * 1024),
    sha256Base64: sha256Base64Schema,
  }),
});
export type SignatureUploadIntentInput = z.infer<typeof signatureUploadIntentSchema>;

export const addTypedSignatureSchema = z.object({
  tenantId: z.uuid(),
  projectId: z.uuid(),
  transactionId: z.uuid(),
  documentId: z.uuid(),
  signerRole: signerRoleSchema,
  typedName: z.string().trim().min(2).max(200),
});
export type AddTypedSignatureInput = z.infer<typeof addTypedSignatureSchema>;

export const finalizeObjectSignatureSchema = z.object({
  tenantId: z.uuid(),
  projectId: z.uuid(),
  transactionId: z.uuid(),
  documentId: z.uuid(),
  signerRole: signerRoleSchema,
  method: z.enum(['DRAWN', 'UPLOAD']),
  objectKey: z.string().min(1).max(1024),
  file: z.object({
    filename: z.string().trim().min(1).max(255),
    mimeType: z.enum(['image/png', 'image/jpeg']),
    byteSize: z.number().int().min(1).max(5 * 1024 * 1024),
    sha256Base64: sha256Base64Schema,
  }),
});
export type FinalizeObjectSignatureInput = z.infer<typeof finalizeObjectSignatureSchema>;

export const stampContractSchema = z.object({
  tenantId: z.uuid(),
  projectId: z.uuid(),
  transactionId: z.uuid(),
  documentId: z.uuid(),
});
export type StampContractInput = z.infer<typeof stampContractSchema>;

export interface UploadIntentResponse {
  objectKey: string;
  uploadUrl: string;
  expiresAt: string;
  requiredHeaders: Readonly<Record<string, string>>;
  documentId?: string;
}

export interface TransactionDocumentSnapshot {
  documentId: string;
  category: DocumentCategory;
  revisionNumber: number;
  status: DocumentStatus;
  filename: string | null;
  mimeType: string | null;
  byteSize: number | null;
  dueAt: string | null;
  uploadedAt: string | null;
  verifiedAt: string | null;
  signatures: Array<{
    signerRole: SignerRole;
    method: SignatureMethod;
    signedAt: string;
  }>;
}
