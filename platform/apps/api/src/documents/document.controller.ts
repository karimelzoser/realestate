import { BadRequestException, Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import {
  addTypedSignatureSchema,
  createDocumentTemplateSchema,
  finalizeObjectSignatureSchema,
  finalizeTransactionDocumentSchema,
  reviewTransactionDocumentSchema,
  signatureUploadIntentSchema,
  stampContractSchema,
  templateUploadIntentSchema,
  transactionDocumentUploadIntentSchema,
  type TransactionDocumentSnapshot,
  type UploadIntentResponse,
} from '@preneura/contracts/documents';
import type { ResolvedSession } from '../auth/auth.repository.js';
import { CurrentSession, SessionAuthGuard } from '../auth/session-auth.guard.js';
import { DocumentService } from './document.service.js';

@UseGuards(SessionAuthGuard)
@Controller('tenants/:tenantId/document-templates')
export class DocumentTemplateController {
  constructor(private readonly documents: DocumentService) {}

  @Post('upload-intent')
  uploadIntent(
    @Param('tenantId') tenantId: string,
    @Body() body: unknown,
    @CurrentSession() session: ResolvedSession,
  ): Promise<UploadIntentResponse> {
    const parsed = templateUploadIntentSchema.safeParse({ ...this.objectBody(body), tenantId });
    if (!parsed.success) throw new BadRequestException('Invalid document template upload request.');
    return this.documents.createTemplateUploadIntent({ actorUserId: session.userId, data: parsed.data });
  }

  @Post()
  createTemplate(
    @Param('tenantId') tenantId: string,
    @Body() body: unknown,
    @CurrentSession() session: ResolvedSession,
  ): Promise<{ templateId: string; versionNumber: number }> {
    const parsed = createDocumentTemplateSchema.safeParse({ ...this.objectBody(body), tenantId });
    if (!parsed.success) throw new BadRequestException('Invalid document template data.');
    return this.documents.createTemplate({ actorUserId: session.userId, data: parsed.data });
  }

  private objectBody(body: unknown): Record<string, unknown> {
    return body && typeof body === 'object' && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : {};
  }
}

@UseGuards(SessionAuthGuard)
@Controller('tenants/:tenantId/projects/:projectId/transactions/:transactionId/documents')
export class TransactionDocumentController {
  constructor(private readonly documents: DocumentService) {}

  @Get()
  list(
    @Param('tenantId') tenantId: string,
    @Param('projectId') projectId: string,
    @Param('transactionId') transactionId: string,
    @CurrentSession() session: ResolvedSession,
  ): Promise<TransactionDocumentSnapshot[]> {
    this.assertUuid(tenantId, 'tenantId');
    this.assertUuid(projectId, 'projectId');
    this.assertUuid(transactionId, 'transactionId');
    return this.documents.listDocuments({ actorUserId: session.userId, tenantId, projectId, transactionId });
  }

  @Post('upload-intent')
  uploadIntent(
    @Param('tenantId') tenantId: string,
    @Param('projectId') projectId: string,
    @Param('transactionId') transactionId: string,
    @Body() body: unknown,
    @CurrentSession() session: ResolvedSession,
  ): Promise<UploadIntentResponse> {
    const parsed = transactionDocumentUploadIntentSchema.safeParse({
      ...this.objectBody(body), tenantId, projectId, transactionId,
    });
    if (!parsed.success) throw new BadRequestException('Invalid transaction document upload request.');
    return this.documents.createDocumentUploadIntent({ actorUserId: session.userId, data: parsed.data });
  }

  @Post(':documentId/finalize')
  finalize(
    @Param('tenantId') tenantId: string,
    @Param('projectId') projectId: string,
    @Param('transactionId') transactionId: string,
    @Param('documentId') documentId: string,
    @Body() body: unknown,
    @CurrentSession() session: ResolvedSession,
  ): Promise<{ finalized: true }> {
    const parsed = finalizeTransactionDocumentSchema.safeParse({
      ...this.objectBody(body), tenantId, projectId, transactionId, documentId,
    });
    if (!parsed.success) throw new BadRequestException('Invalid document finalization request.');
    return this.documents.finalizeDocument({ actorUserId: session.userId, data: parsed.data });
  }

  @Post(':documentId/review')
  review(
    @Param('tenantId') tenantId: string,
    @Param('projectId') projectId: string,
    @Param('transactionId') transactionId: string,
    @Param('documentId') documentId: string,
    @Body() body: unknown,
    @CurrentSession() session: ResolvedSession,
  ): Promise<{ reviewed: true }> {
    const parsed = reviewTransactionDocumentSchema.safeParse({
      ...this.objectBody(body), tenantId, projectId, transactionId, documentId,
    });
    if (!parsed.success) throw new BadRequestException('Invalid document review request.');
    return this.documents.reviewDocument({ actorUserId: session.userId, data: parsed.data });
  }

  @Post(':documentId/signatures/upload-intent')
  signatureUploadIntent(
    @Param('tenantId') tenantId: string,
    @Param('projectId') projectId: string,
    @Param('transactionId') transactionId: string,
    @Param('documentId') documentId: string,
    @Body() body: unknown,
    @CurrentSession() session: ResolvedSession,
  ): Promise<UploadIntentResponse> {
    const parsed = signatureUploadIntentSchema.safeParse({
      ...this.objectBody(body), tenantId, projectId, transactionId, documentId,
    });
    if (!parsed.success) throw new BadRequestException('Invalid signature upload request.');
    return this.documents.createSignatureUploadIntent({ actorUserId: session.userId, data: parsed.data });
  }

  @Post(':documentId/signatures/typed')
  typedSignature(
    @Param('tenantId') tenantId: string,
    @Param('projectId') projectId: string,
    @Param('transactionId') transactionId: string,
    @Param('documentId') documentId: string,
    @Body() body: unknown,
    @CurrentSession() session: ResolvedSession,
  ): Promise<{ signed: true }> {
    const parsed = addTypedSignatureSchema.safeParse({
      ...this.objectBody(body), tenantId, projectId, transactionId, documentId,
    });
    if (!parsed.success) throw new BadRequestException('Invalid typed signature request.');
    return this.documents.addTypedSignature({ actorUserId: session.userId, data: parsed.data });
  }

  @Post(':documentId/signatures/finalize')
  finalizeSignature(
    @Param('tenantId') tenantId: string,
    @Param('projectId') projectId: string,
    @Param('transactionId') transactionId: string,
    @Param('documentId') documentId: string,
    @Body() body: unknown,
    @CurrentSession() session: ResolvedSession,
  ): Promise<{ signed: true }> {
    const parsed = finalizeObjectSignatureSchema.safeParse({
      ...this.objectBody(body), tenantId, projectId, transactionId, documentId,
    });
    if (!parsed.success) throw new BadRequestException('Invalid signature finalization request.');
    return this.documents.finalizeObjectSignature({ actorUserId: session.userId, data: parsed.data });
  }

  @Post(':documentId/stamp')
  stamp(
    @Param('tenantId') tenantId: string,
    @Param('projectId') projectId: string,
    @Param('transactionId') transactionId: string,
    @Param('documentId') documentId: string,
    @CurrentSession() session: ResolvedSession,
  ): Promise<{ stamped: true }> {
    const parsed = stampContractSchema.safeParse({ tenantId, projectId, transactionId, documentId });
    if (!parsed.success) throw new BadRequestException('Invalid contract stamping request.');
    return this.documents.stampContract({ actorUserId: session.userId, data: parsed.data });
  }

  private objectBody(body: unknown): Record<string, unknown> {
    return body && typeof body === 'object' && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : {};
  }

  private assertUuid(value: string, field: string): void {
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!uuid.test(value)) throw new BadRequestException(`Invalid ${field}.`);
  }
}
