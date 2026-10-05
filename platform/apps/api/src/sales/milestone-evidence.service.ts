import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import type { Database } from '@preneura/database';
import type { TransactionMilestoneCode } from '@preneura/contracts/sales';
import { DATABASE } from '../database/database.module.js';

@Injectable()
export class MilestoneEvidenceService {
  constructor(@Inject(DATABASE) private readonly db: Kysely<Database>) {}

  async assertReady(input: {
    tenantId: string;
    projectId: string;
    transactionId: string;
    milestoneCode: TransactionMilestoneCode;
    evidenceDocumentId?: string | null;
  }): Promise<void> {
    const transaction = await this.db
      .selectFrom('transactions')
      .select('id')
      .where('id', '=', input.transactionId)
      .where('tenant_id', '=', input.tenantId)
      .where('project_id', '=', input.projectId)
      .executeTakeFirst();
    if (!transaction) throw new NotFoundException('Transaction not found.');

    const ready = await this.isReady(input);
    if (!ready) {
      throw new ConflictException(this.message(input.milestoneCode));
    }
  }

  private async isReady(input: {
    tenantId: string;
    projectId: string;
    transactionId: string;
    milestoneCode: TransactionMilestoneCode;
    evidenceDocumentId?: string | null;
  }): Promise<boolean> {
    switch (input.milestoneCode) {
      case 'BUYER_DOCUMENTS_COMPLETE':
        return this.requiredDocumentsComplete(input);
      case 'DOWN_PAYMENT_RECEIVED':
        return this.downPaymentComplete(input.transactionId);
      case 'CHEQUES_RECEIVED':
        return this.chequesComplete(input.transactionId);
      case 'CONTRACT_GENERATED':
        return this.contractStatusReady(input, ['VERIFIED', 'SIGNED', 'STAMPED']);
      case 'CONTRACT_SIGNED':
        return this.contractStatusReady(input, ['SIGNED', 'STAMPED']);
      case 'CONTRACT_STAMPED':
        return this.contractStatusReady(input, ['STAMPED']);
    }
  }

  private async requiredDocumentsComplete(input: {
    tenantId: string;
    projectId: string;
    transactionId: string;
  }): Promise<boolean> {
    const requirements = await this.db
      .selectFrom('project_document_requirements')
      .select((eb) => eb.fn.countAll<number>().as('count'))
      .where('tenant_id', '=', input.tenantId)
      .where('project_id', '=', input.projectId)
      .where('required_for_completion', '=', true)
      .executeTakeFirstOrThrow();
    if (Number(requirements.count) === 0) return false;

    const missing = await sql<{ missing: number }>`
      SELECT count(*)::int AS missing
      FROM project_document_requirements r
      WHERE r.tenant_id = ${input.tenantId}
        AND r.project_id = ${input.projectId}
        AND r.required_for_completion = true
        AND (
          SELECT count(*)
          FROM transaction_documents d
          WHERE d.transaction_id = ${input.transactionId}
            AND d.category = r.category
            AND d.status IN ('VERIFIED','SIGNED','STAMPED')
        ) < r.required_count
    `.execute(this.db);

    return Number(missing.rows[0]?.missing ?? 1) === 0;
  }

  private async downPaymentComplete(transactionId: string): Promise<boolean> {
    const rows = await this.db
      .selectFrom('payment_schedule_items as item')
      .innerJoin('payment_schedules as schedule', 'schedule.id', 'item.payment_schedule_id')
      .select(['item.id', 'item.status'])
      .where('schedule.transaction_id', '=', transactionId)
      .where('item.item_type', '=', 'DOWN_PAYMENT')
      .execute();
    return rows.length > 0 && rows.every((row) => ['PAID', 'WAIVED', 'CANCELLED'].includes(row.status));
  }

  private async chequesComplete(transactionId: string): Promise<boolean> {
    const rows = await this.db
      .selectFrom('transaction_cheques')
      .select(['id', 'status'])
      .where('transaction_id', '=', transactionId)
      .execute();
    return rows.length > 0 && rows.every((row) => ['RECEIVED', 'DEPOSITED', 'CLEARED'].includes(row.status));
  }

  private async contractStatusReady(
    input: {
      tenantId: string;
      projectId: string;
      transactionId: string;
      evidenceDocumentId?: string | null;
    },
    statuses: Array<'VERIFIED' | 'SIGNED' | 'STAMPED'>,
  ): Promise<boolean> {
    let query = this.db
      .selectFrom('transaction_documents')
      .select('id')
      .where('tenant_id', '=', input.tenantId)
      .where('project_id', '=', input.projectId)
      .where('transaction_id', '=', input.transactionId)
      .where('category', '=', 'CONTRACT')
      .where('status', 'in', statuses);
    if (input.evidenceDocumentId) query = query.where('id', '=', input.evidenceDocumentId);
    return Boolean(await query.executeTakeFirst());
  }

  private message(code: TransactionMilestoneCode): string {
    switch (code) {
      case 'BUYER_DOCUMENTS_COMPLETE':
        return 'Required buyer documents must be verified before this milestone can complete.';
      case 'DOWN_PAYMENT_RECEIVED':
        return 'All down-payment items must be paid, waived or cancelled before this milestone can complete.';
      case 'CHEQUES_RECEIVED':
        return 'All expected cheques must be received, deposited or cleared before this milestone can complete.';
      case 'CONTRACT_GENERATED':
        return 'A verified contract is required before this milestone can complete.';
      case 'CONTRACT_SIGNED':
        return 'A fully signed contract is required before this milestone can complete.';
      case 'CONTRACT_STAMPED':
        return 'A stamped contract is required before this milestone can complete.';
    }
  }
}
