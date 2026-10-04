import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { sql, type Kysely, type Transaction } from 'kysely';
import type { Database, DocumentCategory, JsonValue, MilestoneCode } from '@preneura/database';
import type {
  CreateDocumentTemplateInput,
  SignerRole,
  SignatureMethod,
  TransactionDocumentSnapshot,
} from '@preneura/contracts/documents';
import { DATABASE } from '../database/database.module.js';

export interface TransactionDocumentContext {
  transactionId: string;
  tenantId: string;
  projectId: string;
  buyerUserId: string;
  transactionStatus: 'IN_PROGRESS' | 'READY_FOR_COMPLETION' | 'COMPLETED' | 'CANCELLED';
}

export interface PendingDocumentUpload {
  documentId: string;
  objectKey: string;
}

@Injectable()
export class DocumentRepository {
  constructor(@Inject(DATABASE) private readonly db: Kysely<Database>) {}

  async getTransactionContext(input: {
    tenantId: string;
    projectId: string;
    transactionId: string;
  }): Promise<TransactionDocumentContext | null> {
    const row = await this.db
      .selectFrom('transactions as t')
      .innerJoin('buyer_profiles as b', (join) =>
        join.onRef('b.id', '=', 't.buyer_profile_id').onRef('b.tenant_id', '=', 't.tenant_id'),
      )
      .select(['t.id', 't.tenant_id', 't.project_id', 't.status', 'b.user_id as buyer_user_id'])
      .where('t.id', '=', input.transactionId)
      .where('t.tenant_id', '=', input.tenantId)
      .where('t.project_id', '=', input.projectId)
      .executeTakeFirst();
    if (!row) return null;
    return {
      transactionId: row.id,
      tenantId: row.tenant_id,
      projectId: row.project_id,
      buyerUserId: row.buyer_user_id,
      transactionStatus: row.status,
    };
  }

  async createTemplate(input: {
    actorUserId: string;
    data: CreateDocumentTemplateInput;
    sha256Hex: string;
    now: Date;
  }): Promise<{ templateId: string; versionNumber: number }> {
    return this.db.transaction().execute(async (trx) => {
      if (input.data.projectId) {
        await trx
          .selectFrom('projects')
          .select('id')
          .where('id', '=', input.data.projectId)
          .where('tenant_id', '=', input.data.tenantId)
          .forUpdate()
          .executeTakeFirstOrThrow();
      } else {
        await trx
          .selectFrom('tenants')
          .select('id')
          .where('id', '=', input.data.tenantId)
          .forUpdate()
          .executeTakeFirstOrThrow();
      }

      let latestQuery = trx
        .selectFrom('document_templates')
        .select((eb) => eb.fn.max<number>('version_number').as('max_version'))
        .where('tenant_id', '=', input.data.tenantId)
        .where('code', '=', input.data.code);
      latestQuery = input.data.projectId
        ? latestQuery.where('project_id', '=', input.data.projectId)
        : latestQuery.where('project_id', 'is', null);
      const latest = await latestQuery.executeTakeFirst();
      const versionNumber = Number(latest?.max_version ?? 0) + 1;

      let retireQuery = trx
        .updateTable('document_templates')
        .set({ status: 'RETIRED', updated_at: input.now })
        .where('tenant_id', '=', input.data.tenantId)
        .where('code', '=', input.data.code)
        .where('status', '=', 'ACTIVE');
      retireQuery = input.data.projectId
        ? retireQuery.where('project_id', '=', input.data.projectId)
        : retireQuery.where('project_id', 'is', null);
      await retireQuery.execute();

      const template = await trx
        .insertInto('document_templates')
        .values({
          tenant_id: input.data.tenantId,
          project_id: input.data.projectId ?? null,
          code: input.data.code,
          name: input.data.name,
          category: input.data.category,
          version_number: versionNumber,
          status: 'ACTIVE',
          storage_object_key: input.data.objectKey,
          sha256_hex: input.sha256Hex,
          mime_type: input.data.file.mimeType,
          requires_signature: input.data.requiresSignature,
          created_by: input.actorUserId,
          activated_at: input.now,
          updated_at: input.now,
        })
        .returning('id')
        .executeTakeFirstOrThrow();

      if (input.data.signerRequirements.length > 0) {
        const unique = new Set(input.data.signerRequirements.map((item) => item.signerRole));
        if (unique.size !== input.data.signerRequirements.length) {
          throw new ConflictException('Each signer role may appear only once per template.');
        }
        await trx
          .insertInto('document_template_signer_requirements')
          .values(
            input.data.signerRequirements.map((item) => ({
              template_id: template.id,
              signer_role: item.signerRole,
              signing_order: item.signingOrder,
              required: item.required,
            })),
          )
          .execute();
      }

      await this.outbox(trx, {
        tenantId: input.data.tenantId,
        projectId: input.data.projectId ?? null,
        aggregateType: 'DOCUMENT_TEMPLATE',
        aggregateId: template.id,
        eventType: 'document.template.activated',
        payload: { code: input.data.code, versionNumber, actorUserId: input.actorUserId },
      });
      return { templateId: template.id, versionNumber };
    });
  }

  async createUploadRecord(input: {
    actorUserId: string;
    tenantId: string;
    projectId: string;
    transactionId: string;
    templateId: string | null;
    category: DocumentCategory;
    dueAt: Date | null;
    objectKey: string;
    filename: string;
    mimeType: string;
    byteSize: number;
    sha256Hex: string;
    now: Date;
  }): Promise<PendingDocumentUpload> {
    return this.db.transaction().execute(async (trx) => {
      const transaction = await trx
        .selectFrom('transactions')
        .select('status')
        .where('id', '=', input.transactionId)
        .where('tenant_id', '=', input.tenantId)
        .where('project_id', '=', input.projectId)
        .forUpdate()
        .executeTakeFirst();
      if (!transaction || transaction.status === 'CANCELLED' || transaction.status === 'COMPLETED') {
        throw new ConflictException('Documents can only be added to an open transaction.');
      }

      if (input.templateId) {
        const template = await trx
          .selectFrom('document_templates')
          .select(['id', 'category'])
          .where('id', '=', input.templateId)
          .where('tenant_id', '=', input.tenantId)
          .where((eb) =>
            eb.or([
              eb('project_id', '=', input.projectId),
              eb('project_id', 'is', null),
            ]),
          )
          .where('status', '=', 'ACTIVE')
          .executeTakeFirst();
        if (!template || template.category !== input.category) {
          throw new ConflictException('Template does not match this document category/project.');
        }
      }

      const latest = await trx
        .selectFrom('transaction_documents')
        .select(['id', 'revision_number', 'status'])
        .where('transaction_id', '=', input.transactionId)
        .where('category', '=', input.category)
        .orderBy('revision_number', 'desc')
        .forUpdate()
        .executeTakeFirst();
      const revisionNumber = (latest?.revision_number ?? 0) + 1;

      if (latest && latest.status !== 'SUPERSEDED') {
        await trx
          .updateTable('transaction_documents')
          .set({ status: 'SUPERSEDED', updated_at: input.now })
          .where('id', '=', latest.id)
          .execute();
      }

      const row = await trx
        .insertInto('transaction_documents')
        .values({
          tenant_id: input.tenantId,
          project_id: input.projectId,
          transaction_id: input.transactionId,
          template_id: input.templateId,
          category: input.category,
          revision_number: revisionNumber,
          supersedes_document_id: latest?.id ?? null,
          status: 'UPLOADING',
          storage_object_key: input.objectKey,
          original_filename: input.filename,
          mime_type: input.mimeType,
          byte_size: input.byteSize,
          sha256_hex: input.sha256Hex,
          due_at: input.dueAt,
          uploaded_by: input.actorUserId,
          uploaded_at: null,
          verified_by: null,
          verified_at: null,
          rejection_reason: null,
          updated_at: input.now,
        })
        .returning('id')
        .executeTakeFirstOrThrow();

      await this.transactionEvent(trx, input.transactionId, input.actorUserId, 'document.upload.requested', {
        documentId: row.id,
        category: input.category,
        revisionNumber,
      });
      return { documentId: row.id, objectKey: input.objectKey };
    });
  }

  async getUploadRecord(input: {
    tenantId: string;
    projectId: string;
    transactionId: string;
    documentId: string;
  }) {
    return this.db
      .selectFrom('transaction_documents')
      .select([
        'id', 'status', 'storage_object_key', 'original_filename', 'mime_type', 'byte_size', 'sha256_hex',
        'category', 'template_id', 'revision_number',
      ])
      .where('id', '=', input.documentId)
      .where('tenant_id', '=', input.tenantId)
      .where('project_id', '=', input.projectId)
      .where('transaction_id', '=', input.transactionId)
      .executeTakeFirst();
  }

  async finalizeUpload(input: {
    actorUserId: string;
    tenantId: string;
    projectId: string;
    transactionId: string;
    documentId: string;
    now: Date;
  }): Promise<void> {
    await this.db.transaction().execute(async (trx) => {
      const row = await trx
        .updateTable('transaction_documents')
        .set({ status: 'UPLOADED', uploaded_at: input.now, uploaded_by: input.actorUserId, updated_at: input.now })
        .where('id', '=', input.documentId)
        .where('tenant_id', '=', input.tenantId)
        .where('project_id', '=', input.projectId)
        .where('transaction_id', '=', input.transactionId)
        .where('status', '=', 'UPLOADING')
        .returning(['id', 'category'])
        .executeTakeFirst();
      if (!row) throw new ConflictException('Document upload is not pending finalization.');

      await this.transactionEvent(trx, input.transactionId, input.actorUserId, 'document.uploaded', {
        documentId: row.id,
        category: row.category,
      });
      await this.outbox(trx, {
        tenantId: input.tenantId,
        projectId: input.projectId,
        aggregateType: 'TRANSACTION_DOCUMENT',
        aggregateId: row.id,
        eventType: 'document.uploaded',
        payload: { transactionId: input.transactionId, category: row.category },
      });
    });
  }

  async reviewDocument(input: {
    actorUserId: string;
    tenantId: string;
    projectId: string;
    transactionId: string;
    documentId: string;
    decision: 'VERIFY' | 'REJECT';
    rejectionReason: string | null;
    now: Date;
  }): Promise<void> {
    await this.db.transaction().execute(async (trx) => {
      const document = await trx
        .selectFrom('transaction_documents')
        .select(['id', 'category', 'status'])
        .where('id', '=', input.documentId)
        .where('tenant_id', '=', input.tenantId)
        .where('project_id', '=', input.projectId)
        .where('transaction_id', '=', input.transactionId)
        .forUpdate()
        .executeTakeFirst();
      if (!document || !['UPLOADED', 'REJECTED'].includes(document.status)) {
        throw new ConflictException('Only an uploaded document can be reviewed.');
      }

      if (input.decision === 'REJECT') {
        await trx
          .updateTable('transaction_documents')
          .set({
            status: 'REJECTED',
            rejection_reason: input.rejectionReason,
            verified_by: input.actorUserId,
            verified_at: input.now,
            updated_at: input.now,
          })
          .where('id', '=', document.id)
          .execute();
      } else {
        await trx
          .updateTable('transaction_documents')
          .set({
            status: 'VERIFIED',
            rejection_reason: null,
            verified_by: input.actorUserId,
            verified_at: input.now,
            updated_at: input.now,
          })
          .where('id', '=', document.id)
          .execute();

        if (document.category === 'CONTRACT') {
          await this.completeMilestone(trx, input.transactionId, 'CONTRACT_GENERATED', input.actorUserId, document.id, input.now);
        }
        await this.refreshDocumentMilestone(trx, input.tenantId, input.projectId, input.transactionId, input.actorUserId, input.now);
      }

      await this.transactionEvent(trx, input.transactionId, input.actorUserId, `document.${input.decision === 'VERIFY' ? 'verified' : 'rejected'}`, {
        documentId: document.id,
        category: document.category,
        rejectionReason: input.rejectionReason,
      });
      await this.outbox(trx, {
        tenantId: input.tenantId,
        projectId: input.projectId,
        aggregateType: 'TRANSACTION_DOCUMENT',
        aggregateId: document.id,
        eventType: input.decision === 'VERIFY' ? 'document.verified' : 'document.rejected',
        payload: { transactionId: input.transactionId, category: document.category },
      });
    });
  }

  async addSignature(input: {
    actorUserId: string;
    tenantId: string;
    projectId: string;
    transactionId: string;
    documentId: string;
    signerRole: SignerRole;
    method: SignatureMethod;
    typedName: string | null;
    signatureObjectKey: string | null;
    signatureSha256Hex: string | null;
    metadata?: Record<string, JsonValue>;
    now: Date;
  }): Promise<void> {
    await this.db.transaction().execute(async (trx) => {
      const document = await trx
        .selectFrom('transaction_documents')
        .select(['id', 'category', 'status', 'template_id'])
        .where('id', '=', input.documentId)
        .where('tenant_id', '=', input.tenantId)
        .where('project_id', '=', input.projectId)
        .where('transaction_id', '=', input.transactionId)
        .forUpdate()
        .executeTakeFirst();
      if (!document || document.category !== 'CONTRACT' || !['VERIFIED', 'SIGNED'].includes(document.status)) {
        throw new ConflictException('A verified contract is required before signing.');
      }

      if (document.template_id) {
        const req = await trx
          .selectFrom('document_template_signer_requirements')
          .select(['signer_role', 'required'])
          .where('template_id', '=', document.template_id)
          .where('signer_role', '=', input.signerRole)
          .executeTakeFirst();
        if (!req) throw new ConflictException('This signer role is not permitted by the contract template.');
      }

      await trx
        .insertInto('document_signatures')
        .values({
          document_id: document.id,
          signer_role: input.signerRole,
          signer_user_id: input.actorUserId,
          method: input.method,
          typed_name: input.typedName,
          signature_object_key: input.signatureObjectKey,
          signature_sha256_hex: input.signatureSha256Hex,
          provider: null,
          provider_envelope_id: null,
          signed_at: input.now,
          metadata: input.metadata ?? {},
        })
        .executeTakeFirstOrThrow();

      const allSigned = await this.allRequiredSignersPresent(trx, document.id, document.template_id);
      if (allSigned) {
        await trx
          .updateTable('transaction_documents')
          .set({ status: 'SIGNED', updated_at: input.now })
          .where('id', '=', document.id)
          .execute();
        await this.completeMilestone(trx, input.transactionId, 'CONTRACT_SIGNED', input.actorUserId, document.id, input.now);
      }

      await this.transactionEvent(trx, input.transactionId, input.actorUserId, 'contract.signature.added', {
        documentId: document.id,
        signerRole: input.signerRole,
        method: input.method,
        allRequiredSignersPresent: allSigned,
      });
    });
  }

  async stampContract(input: {
    actorUserId: string;
    tenantId: string;
    projectId: string;
    transactionId: string;
    documentId: string;
    now: Date;
  }): Promise<void> {
    await this.db.transaction().execute(async (trx) => {
      const document = await trx
        .updateTable('transaction_documents')
        .set({ status: 'STAMPED', updated_at: input.now })
        .where('id', '=', input.documentId)
        .where('tenant_id', '=', input.tenantId)
        .where('project_id', '=', input.projectId)
        .where('transaction_id', '=', input.transactionId)
        .where('category', '=', 'CONTRACT')
        .where('status', '=', 'SIGNED')
        .returning('id')
        .executeTakeFirst();
      if (!document) throw new ConflictException('Only a fully signed contract can be stamped.');

      await this.completeMilestone(trx, input.transactionId, 'CONTRACT_STAMPED', input.actorUserId, document.id, input.now);
      await this.transactionEvent(trx, input.transactionId, input.actorUserId, 'contract.stamped', { documentId: document.id });
      await this.outbox(trx, {
        tenantId: input.tenantId,
        projectId: input.projectId,
        aggregateType: 'TRANSACTION',
        aggregateId: input.transactionId,
        eventType: 'contract.stamped',
        payload: { documentId: document.id },
      });
    });
  }

  async listDocuments(input: {
    tenantId: string;
    projectId: string;
    transactionId: string;
  }): Promise<TransactionDocumentSnapshot[]> {
    const docs = await this.db
      .selectFrom('transaction_documents')
      .select(['id', 'category', 'revision_number', 'status', 'original_filename', 'mime_type', 'byte_size', 'due_at', 'uploaded_at', 'verified_at'])
      .where('tenant_id', '=', input.tenantId)
      .where('project_id', '=', input.projectId)
      .where('transaction_id', '=', input.transactionId)
      .where('status', '<>', 'SUPERSEDED')
      .orderBy('category', 'asc')
      .orderBy('revision_number', 'desc')
      .execute();

    if (docs.length === 0) return [];
    const signatures = await this.db
      .selectFrom('document_signatures')
      .select(['document_id', 'signer_role', 'method', 'signed_at'])
      .where('document_id', 'in', docs.map((doc) => doc.id))
      .orderBy('signed_at', 'asc')
      .execute();

    return docs.map((doc) => ({
      documentId: doc.id,
      category: doc.category,
      revisionNumber: doc.revision_number,
      status: doc.status,
      filename: doc.original_filename,
      mimeType: doc.mime_type,
      byteSize: doc.byte_size === null ? null : Number(doc.byte_size),
      dueAt: doc.due_at ? (doc.due_at as Date).toISOString() : null,
      uploadedAt: doc.uploaded_at ? (doc.uploaded_at as Date).toISOString() : null,
      verifiedAt: doc.verified_at ? (doc.verified_at as Date).toISOString() : null,
      signatures: signatures
        .filter((signature) => signature.document_id === doc.id)
        .map((signature) => ({
          signerRole: signature.signer_role,
          method: signature.method,
          signedAt: (signature.signed_at as Date).toISOString(),
        })),
    }));
  }

  private async allRequiredSignersPresent(
    trx: Transaction<Database>,
    documentId: string,
    templateId: string | null,
  ): Promise<boolean> {
    if (!templateId) return false;
    const result = await sql<{ missing: number }>`
      SELECT count(*)::int AS missing
      FROM document_template_signer_requirements r
      WHERE r.template_id = ${templateId}
        AND r.required = true
        AND NOT EXISTS (
          SELECT 1 FROM document_signatures s
          WHERE s.document_id = ${documentId}
            AND s.signer_role = r.signer_role
        )
    `.execute(trx);
    const requirementCount = await trx
      .selectFrom('document_template_signer_requirements')
      .select((eb) => eb.fn.countAll<number>().as('count'))
      .where('template_id', '=', templateId)
      .where('required', '=', true)
      .executeTakeFirstOrThrow();
    return Number(requirementCount.count) > 0 && Number(result.rows[0]?.missing ?? 1) === 0;
  }

  private async refreshDocumentMilestone(
    trx: Transaction<Database>,
    tenantId: string,
    projectId: string,
    transactionId: string,
    actorUserId: string,
    now: Date,
  ): Promise<void> {
    const result = await sql<{ missing: number }>`
      SELECT count(*)::int AS missing
      FROM project_document_requirements r
      WHERE r.tenant_id = ${tenantId}
        AND r.project_id = ${projectId}
        AND r.required_for_completion = true
        AND (
          SELECT count(*)
          FROM transaction_documents d
          WHERE d.transaction_id = ${transactionId}
            AND d.category = r.category
            AND d.status IN ('VERIFIED','SIGNED','STAMPED')
        ) < r.required_count
    `.execute(trx);
    const requirements = await trx
      .selectFrom('project_document_requirements')
      .select((eb) => eb.fn.countAll<number>().as('count'))
      .where('tenant_id', '=', tenantId)
      .where('project_id', '=', projectId)
      .where('required_for_completion', '=', true)
      .executeTakeFirstOrThrow();
    if (Number(requirements.count) > 0 && Number(result.rows[0]?.missing ?? 1) === 0) {
      await this.completeMilestone(trx, transactionId, 'BUYER_DOCUMENTS_COMPLETE', actorUserId, null, now);
    }
  }

  private async completeMilestone(
    trx: Transaction<Database>,
    transactionId: string,
    code: MilestoneCode,
    actorUserId: string,
    evidenceDocumentId: string | null,
    now: Date,
  ): Promise<void> {
    await trx
      .updateTable('transaction_milestones')
      .set({
        status: 'COMPLETED',
        completed_at: now,
        completed_by: actorUserId,
        evidence_document_id: evidenceDocumentId,
        updated_at: now,
      })
      .where('transaction_id', '=', transactionId)
      .where('code', '=', code)
      .where('status', 'in', ['PENDING', 'BLOCKED'])
      .execute();
  }

  private async transactionEvent(
    trx: Transaction<Database>,
    transactionId: string,
    actorUserId: string,
    eventType: string,
    metadata: Record<string, JsonValue>,
  ): Promise<void> {
    await trx.insertInto('transaction_events').values({
      transaction_id: transactionId,
      actor_user_id: actorUserId,
      event_type: eventType,
      metadata,
    }).execute();
  }

  private async outbox(
    trx: Transaction<Database>,
    input: {
      tenantId: string;
      projectId: string | null;
      aggregateType: string;
      aggregateId: string;
      eventType: string;
      payload: Record<string, JsonValue>;
    },
  ): Promise<void> {
    await trx.insertInto('domain_outbox_events').values({
      tenant_id: input.tenantId,
      project_id: input.projectId,
      aggregate_type: input.aggregateType,
      aggregate_id: input.aggregateId,
      event_type: input.eventType,
      payload: input.payload,
      published_at: null,
      attempts: 0,
    }).execute();
  }
}
