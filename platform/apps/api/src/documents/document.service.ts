import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { PermissionCode } from '@preneura/contracts/access';
import type {
  AddTypedSignatureInput,
  CreateDocumentTemplateInput,
  FinalizeObjectSignatureInput,
  FinalizeTransactionDocumentInput,
  ReviewTransactionDocumentInput,
  SignatureUploadIntentInput,
  StampContractInput,
  TemplateUploadIntentInput,
  TransactionDocumentSnapshot,
  TransactionDocumentUploadIntentInput,
  UploadIntentResponse,
  SignerRole,
} from '@preneura/contracts/documents';
import { AccessService } from '../access/access.service.js';
import { CommissionService } from '../commissions/commission.service.js';
import { ObjectStorageService } from '../storage/object-storage.service.js';
import { ObjectTrustService } from '../storage/object-trust.service.js';
import { ContractExecutionRepository } from './contract-execution.repository.js';
import { DocumentRepository, type TransactionDocumentContext } from './document.repository.js';

@Injectable()
export class DocumentService {
  constructor(
    private readonly repository: DocumentRepository,
    private readonly execution: ContractExecutionRepository,
    private readonly access: AccessService,
    private readonly storage: ObjectStorageService,
    private readonly trust: ObjectTrustService,
    private readonly commissions: CommissionService,
  ) {}

  async createTemplateUploadIntent(input: {
    actorUserId: string;
    data: TemplateUploadIntentInput;
  }): Promise<UploadIntentResponse> {
    await this.assertTemplateManagement(input.actorUserId, input.data.tenantId, input.data.projectId ?? null);
    const objectKey = this.storage.templateObjectKey({
      tenantId: input.data.tenantId,
      projectId: input.data.projectId ?? null,
      code: input.data.code,
    });
    return this.storage.createUploadIntent({
      objectKey,
      contentType: input.data.file.mimeType,
      byteSize: input.data.file.byteSize,
      sha256Base64: input.data.file.sha256Base64,
    });
  }

  async createTemplate(input: {
    actorUserId: string;
    data: CreateDocumentTemplateInput;
  }): Promise<{ templateId: string; versionNumber: number }> {
    await this.assertTemplateManagement(input.actorUserId, input.data.tenantId, input.data.projectId ?? null);
    const prefix = input.data.projectId
      ? `tenants/${input.data.tenantId}/projects/${input.data.projectId}/templates`
      : `tenants/${input.data.tenantId}/tenant-defaults/templates`;
    if (!this.storage.ensurePrefix(input.data.objectKey, prefix)) {
      throw new BadRequestException('Template object key is outside the authorized storage scope.');
    }

    const verified = await this.storage.verifyObject({
      objectKey: input.data.objectKey,
      expectedContentType: input.data.file.mimeType,
      expectedByteSize: input.data.file.byteSize,
      expectedSha256Base64: input.data.file.sha256Base64,
    });
    if (!verified) throw new BadRequestException('Uploaded template could not be verified.');

    await this.trust.trustVerifiedObject({
      tenantId: input.data.tenantId,
      projectId: input.data.projectId ?? null,
      purpose: 'DOCUMENT_TEMPLATE',
      verified,
      maxInspectionBytes: 25 * 1024 * 1024,
    });

    return this.repository.createTemplate({
      actorUserId: input.actorUserId,
      data: input.data,
      sha256Hex: verified.sha256Hex,
      now: new Date(),
    });
  }

  async createDocumentUploadIntent(input: {
    actorUserId: string;
    data: TransactionDocumentUploadIntentInput;
  }): Promise<UploadIntentResponse> {
    const transaction = await this.requireTransaction(input.data.tenantId, input.data.projectId, input.data.transactionId);
    await this.assertTransactionPermission({
      actorUserId: input.actorUserId,
      transaction,
      regularPermission: 'documents.upload',
      selfPermission: 'documents.upload.self',
    });

    const objectKey = this.storage.documentObjectKey({
      tenantId: input.data.tenantId,
      projectId: input.data.projectId,
      transactionId: input.data.transactionId,
      category: input.data.category,
    });
    const intent = await this.storage.createUploadIntent({
      objectKey,
      contentType: input.data.file.mimeType,
      byteSize: input.data.file.byteSize,
      sha256Base64: input.data.file.sha256Base64,
    });
    const pending = await this.repository.createUploadRecord({
      actorUserId: input.actorUserId,
      tenantId: input.data.tenantId,
      projectId: input.data.projectId,
      transactionId: input.data.transactionId,
      templateId: input.data.templateId ?? null,
      category: input.data.category,
      dueAt: input.data.dueAt ? new Date(input.data.dueAt) : null,
      objectKey,
      filename: input.data.file.filename,
      mimeType: input.data.file.mimeType,
      byteSize: input.data.file.byteSize,
      sha256Hex: this.sha256Hex(input.data.file.sha256Base64),
      now: new Date(),
    });
    return { ...intent, documentId: pending.documentId };
  }

  async finalizeDocument(input: {
    actorUserId: string;
    data: FinalizeTransactionDocumentInput;
  }): Promise<{ finalized: true }> {
    const transaction = await this.requireTransaction(input.data.tenantId, input.data.projectId, input.data.transactionId);
    await this.assertTransactionPermission({
      actorUserId: input.actorUserId,
      transaction,
      regularPermission: 'documents.upload',
      selfPermission: 'documents.upload.self',
    });

    const pending = await this.repository.getUploadRecord({
      tenantId: input.data.tenantId,
      projectId: input.data.projectId,
      transactionId: input.data.transactionId,
      documentId: input.data.documentId,
    });
    if (!pending) throw new NotFoundException('Document upload record not found.');
    if (pending.status !== 'UPLOADING') throw new BadRequestException('Document upload is not awaiting finalization.');
    if (
      pending.storage_object_key !== input.data.objectKey ||
      pending.original_filename !== input.data.file.filename ||
      pending.mime_type !== input.data.file.mimeType ||
      Number(pending.byte_size) !== input.data.file.byteSize ||
      pending.sha256_hex !== this.sha256Hex(input.data.file.sha256Base64)
    ) {
      throw new BadRequestException('Uploaded object metadata does not match the original upload intent.');
    }

    const verified = await this.storage.verifyObject({
      objectKey: pending.storage_object_key,
      expectedContentType: pending.mime_type!,
      expectedByteSize: Number(pending.byte_size),
      expectedSha256Base64: input.data.file.sha256Base64,
    });
    if (!verified) throw new BadRequestException('Uploaded document could not be verified.');

    await this.trust.trustVerifiedObject({
      tenantId: input.data.tenantId,
      projectId: input.data.projectId,
      purpose: 'TRANSACTION_DOCUMENT',
      verified,
      maxInspectionBytes: 25 * 1024 * 1024,
    });

    await this.repository.finalizeUpload({
      actorUserId: input.actorUserId,
      tenantId: input.data.tenantId,
      projectId: input.data.projectId,
      transactionId: input.data.transactionId,
      documentId: input.data.documentId,
      now: new Date(),
    });
    return { finalized: true };
  }

  async reviewDocument(input: {
    actorUserId: string;
    data: ReviewTransactionDocumentInput;
  }): Promise<{ reviewed: true }> {
    await this.requireTransaction(input.data.tenantId, input.data.projectId, input.data.transactionId);
    await this.access.assert({
      userId: input.actorUserId,
      permission: 'documents.verify',
      context: { tenantId: input.data.tenantId, projectId: input.data.projectId },
    });

    if (input.data.decision === 'VERIFY') {
      await this.ensureDocumentObjectClean({
        tenantId: input.data.tenantId,
        projectId: input.data.projectId,
        transactionId: input.data.transactionId,
        documentId: input.data.documentId,
      });
    }

    await this.repository.reviewDocument({
      actorUserId: input.actorUserId,
      tenantId: input.data.tenantId,
      projectId: input.data.projectId,
      transactionId: input.data.transactionId,
      documentId: input.data.documentId,
      decision: input.data.decision,
      rejectionReason: input.data.rejectionReason ?? null,
      now: new Date(),
    });
    await this.refreshCommission(input.data.tenantId, input.data.projectId, input.data.transactionId);
    return { reviewed: true };
  }

  async listDocuments(input: {
    actorUserId: string;
    tenantId: string;
    projectId: string;
    transactionId: string;
  }): Promise<TransactionDocumentSnapshot[]> {
    const transaction = await this.requireTransaction(input.tenantId, input.projectId, input.transactionId);
    await this.assertTransactionPermission({
      actorUserId: input.actorUserId,
      transaction,
      regularPermission: 'documents.read',
      selfPermission: 'documents.read.self',
    });
    return this.repository.listDocuments(input);
  }

  async createSignatureUploadIntent(input: {
    actorUserId: string;
    data: SignatureUploadIntentInput;
  }): Promise<UploadIntentResponse> {
    const transaction = await this.requireTransaction(input.data.tenantId, input.data.projectId, input.data.transactionId);
    await this.assertSigner(input.actorUserId, transaction, input.data.signerRole);
    await this.requireSignableContract(input.data.tenantId, input.data.projectId, input.data.transactionId, input.data.documentId);

    const objectKey = this.storage.signatureObjectKey({
      tenantId: input.data.tenantId,
      projectId: input.data.projectId,
      transactionId: input.data.transactionId,
      documentId: input.data.documentId,
      signerRole: input.data.signerRole,
    });
    return this.storage.createUploadIntent({
      objectKey,
      contentType: input.data.file.mimeType,
      byteSize: input.data.file.byteSize,
      sha256Base64: input.data.file.sha256Base64,
    });
  }

  async addTypedSignature(input: {
    actorUserId: string;
    data: AddTypedSignatureInput;
  }): Promise<{ signed: true }> {
    const transaction = await this.requireTransaction(input.data.tenantId, input.data.projectId, input.data.transactionId);
    await this.assertSigner(input.actorUserId, transaction, input.data.signerRole);
    await this.requireSignableContract(input.data.tenantId, input.data.projectId, input.data.transactionId, input.data.documentId);
    await this.repository.addSignature({
      actorUserId: input.actorUserId,
      tenantId: input.data.tenantId,
      projectId: input.data.projectId,
      transactionId: input.data.transactionId,
      documentId: input.data.documentId,
      signerRole: input.data.signerRole,
      method: 'TYPED',
      typedName: input.data.typedName,
      signatureObjectKey: null,
      signatureSha256Hex: null,
      metadata: {},
      now: new Date(),
    });
    await this.refreshCommission(input.data.tenantId, input.data.projectId, input.data.transactionId);
    return { signed: true };
  }

  async finalizeObjectSignature(input: {
    actorUserId: string;
    data: FinalizeObjectSignatureInput;
  }): Promise<{ signed: true }> {
    const transaction = await this.requireTransaction(input.data.tenantId, input.data.projectId, input.data.transactionId);
    await this.assertSigner(input.actorUserId, transaction, input.data.signerRole);
    await this.requireSignableContract(input.data.tenantId, input.data.projectId, input.data.transactionId, input.data.documentId);

    const prefix = `tenants/${input.data.tenantId}/projects/${input.data.projectId}/transactions/${input.data.transactionId}/documents/${input.data.documentId}/signatures`;
    if (!this.storage.ensurePrefix(input.data.objectKey, prefix)) {
      throw new BadRequestException('Signature object key is outside the authorized storage scope.');
    }
    const verified = await this.storage.verifyObject({
      objectKey: input.data.objectKey,
      expectedContentType: input.data.file.mimeType,
      expectedByteSize: input.data.file.byteSize,
      expectedSha256Base64: input.data.file.sha256Base64,
    });
    if (!verified) throw new BadRequestException('Uploaded signature could not be verified.');

    await this.trust.trustVerifiedObject({
      tenantId: input.data.tenantId,
      projectId: input.data.projectId,
      purpose: 'SIGNATURE',
      verified,
      maxInspectionBytes: 5 * 1024 * 1024,
    });

    await this.repository.addSignature({
      actorUserId: input.actorUserId,
      tenantId: input.data.tenantId,
      projectId: input.data.projectId,
      transactionId: input.data.transactionId,
      documentId: input.data.documentId,
      signerRole: input.data.signerRole,
      method: input.data.method,
      typedName: null,
      signatureObjectKey: input.data.objectKey,
      signatureSha256Hex: verified.sha256Hex,
      metadata: { filename: input.data.file.filename, mimeType: input.data.file.mimeType },
      now: new Date(),
    });
    await this.refreshCommission(input.data.tenantId, input.data.projectId, input.data.transactionId);
    return { signed: true };
  }

  async stampContract(input: {
    actorUserId: string;
    data: StampContractInput;
  }): Promise<{ stamped: true }> {
    await this.requireTransaction(input.data.tenantId, input.data.projectId, input.data.transactionId);
    await this.access.assert({
      userId: input.actorUserId,
      permission: 'contract.execute',
      context: { tenantId: input.data.tenantId, projectId: input.data.projectId },
    });
    await this.execution.stampContract({
      actorUserId: input.actorUserId,
      tenantId: input.data.tenantId,
      projectId: input.data.projectId,
      transactionId: input.data.transactionId,
      documentId: input.data.documentId,
      now: new Date(),
    });
    await this.refreshCommission(input.data.tenantId, input.data.projectId, input.data.transactionId);
    return { stamped: true };
  }

  private async refreshCommission(tenantId: string, projectId: string, transactionId: string): Promise<void> {
    await this.commissions.refreshTransactionCase({ tenantId, projectId, transactionId });
  }

  private async requireTransaction(
    tenantId: string,
    projectId: string,
    transactionId: string,
  ): Promise<TransactionDocumentContext> {
    const transaction = await this.repository.getTransactionContext({ tenantId, projectId, transactionId });
    if (!transaction) throw new NotFoundException('Transaction not found.');
    if (transaction.transactionStatus === 'CANCELLED') {
      throw new BadRequestException('Cancelled transactions cannot accept document actions.');
    }
    return transaction;
  }

  private async assertTemplateManagement(actorUserId: string, tenantId: string, projectId: string | null): Promise<void> {
    await this.access.assert({
      userId: actorUserId,
      permission: 'documents.templates.manage',
      context: projectId ? { tenantId, projectId } : { tenantId },
    });
  }

  private async assertTransactionPermission(input: {
    actorUserId: string;
    transaction: TransactionDocumentContext;
    regularPermission: PermissionCode;
    selfPermission: PermissionCode;
  }): Promise<void> {
    const regular = await this.access.can({
      userId: input.actorUserId,
      permission: input.regularPermission,
      context: { tenantId: input.transaction.tenantId, projectId: input.transaction.projectId },
    });
    if (regular.allowed) return;
    await this.access.assert({
      userId: input.actorUserId,
      permission: input.selfPermission,
      context: {
        tenantId: input.transaction.tenantId,
        projectId: input.transaction.projectId,
        resourceOwnerUserId: input.transaction.buyerUserId,
      },
    });
  }

  private async assertSigner(
    actorUserId: string,
    transaction: TransactionDocumentContext,
    signerRole: SignerRole,
  ): Promise<void> {
    if (signerRole === 'BUYER') {
      if (actorUserId !== transaction.buyerUserId) {
        throw new ForbiddenException('Only the transaction buyer may sign as BUYER.');
      }
      await this.access.assert({
        userId: actorUserId,
        permission: 'contract.sign.self',
        context: {
          tenantId: transaction.tenantId,
          projectId: transaction.projectId,
          resourceOwnerUserId: transaction.buyerUserId,
        },
      });
      return;
    }

    if (signerRole === 'COMPANY') {
      await this.access.assert({
        userId: actorUserId,
        permission: 'contract.sign.company',
        context: { tenantId: transaction.tenantId, projectId: transaction.projectId },
      });
      return;
    }

    await this.access.assert({
      userId: actorUserId,
      permission: 'contract.execute',
      context: { tenantId: transaction.tenantId, projectId: transaction.projectId },
    });
  }

  private async requireSignableContract(
    tenantId: string,
    projectId: string,
    transactionId: string,
    documentId: string,
  ): Promise<void> {
    const document = await this.repository.getUploadRecord({ tenantId, projectId, transactionId, documentId });
    if (!document || document.category !== 'CONTRACT' || !['VERIFIED', 'SIGNED'].includes(document.status)) {
      throw new BadRequestException('A verified contract is required before signing.');
    }
    await this.ensureDocumentObjectClean({ tenantId, projectId, transactionId, documentId });
  }

  private async ensureDocumentObjectClean(input: {
    tenantId: string;
    projectId: string;
    transactionId: string;
    documentId: string;
  }): Promise<void> {
    const document = await this.repository.getUploadRecord(input);
    if (
      !document ||
      !document.storage_object_key ||
      !document.mime_type ||
      document.byte_size === null ||
      !document.sha256_hex
    ) {
      throw new BadRequestException('Document object metadata is incomplete and cannot be trusted.');
    }

    const digest = Buffer.from(document.sha256_hex, 'hex');
    if (digest.length !== 32) throw new BadRequestException('Document SHA-256 evidence is invalid.');
    const verified = await this.storage.verifyObject({
      objectKey: document.storage_object_key,
      expectedContentType: document.mime_type,
      expectedByteSize: Number(document.byte_size),
      expectedSha256Base64: digest.toString('base64'),
    });
    if (!verified) throw new BadRequestException('Stored document no longer matches its recorded integrity evidence.');

    await this.trust.trustVerifiedObject({
      tenantId: input.tenantId,
      projectId: input.projectId,
      purpose: 'TRANSACTION_DOCUMENT',
      verified,
      maxInspectionBytes: 25 * 1024 * 1024,
    });
  }

  private sha256Hex(base64Digest: string): string {
    const digest = Buffer.from(base64Digest, 'base64');
    if (digest.length !== 32) throw new BadRequestException('Invalid SHA-256 digest.');
    return digest.toString('hex');
  }
}
