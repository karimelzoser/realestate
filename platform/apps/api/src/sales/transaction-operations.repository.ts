import { Inject, Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import type { Database } from '@preneura/database';
import type {
  TransactionOperationBucket,
  TransactionOperationMilestoneCode,
  TransactionOperationMilestoneSnapshot,
  TransactionOperationQueueItemSnapshot,
  TransactionOperationQueueSnapshot,
} from '@preneura/contracts/transaction-operations';
import { DATABASE } from '../database/database.module.js';
import {
  classifyTransactionOperation,
  type TransactionOperationSignerRole,
} from './transaction-operations-classifier.js';

const MILESTONE_ORDER: readonly TransactionOperationMilestoneCode[] = [
  'BUYER_DOCUMENTS_COMPLETE',
  'DOWN_PAYMENT_RECEIVED',
  'CHEQUES_RECEIVED',
  'CONTRACT_GENERATED',
  'CONTRACT_SIGNED',
  'CONTRACT_STAMPED',
];

const BUCKETS: readonly TransactionOperationBucket[] = [
  'NEEDS_DOCUMENTS',
  'NEEDS_PAYMENT',
  'NEEDS_CHEQUES',
  'NEEDS_CONTRACT',
  'NEEDS_BUYER_SIGNATURE',
  'NEEDS_COMPANY_EXECUTION',
  'READY_TO_COMPLETE',
];

@Injectable()
export class TransactionOperationsRepository {
  constructor(@Inject(DATABASE) private readonly db: Kysely<Database>) {}

  async projectExists(tenantId: string, projectId: string): Promise<boolean> {
    const row = await this.db
      .selectFrom('projects')
      .select('id')
      .where('tenant_id', '=', tenantId)
      .where('id', '=', projectId)
      .where('status', 'in', ['DRAFT', 'ACTIVE', 'PAUSED', 'CLOSED'])
      .executeTakeFirst();
    return Boolean(row);
  }

  async queue(input: {
    tenantId: string;
    projectId: string;
    now: Date;
  }): Promise<TransactionOperationQueueSnapshot> {
    const rows = await this.db
      .selectFrom('transactions as t')
      .innerJoin('reservations as r', (join) =>
        join
          .onRef('r.id', '=', 't.reservation_id')
          .onRef('r.tenant_id', '=', 't.tenant_id')
          .onRef('r.project_id', '=', 't.project_id'),
      )
      .innerJoin('buyer_profiles as b', (join) =>
        join.onRef('b.id', '=', 't.buyer_profile_id').onRef('b.tenant_id', '=', 't.tenant_id'),
      )
      .innerJoin('users as buyer', 'buyer.id', 'b.user_id')
      .innerJoin('catalog_unit_types as u', (join) =>
        join
          .onRef('u.id', '=', 'r.unit_type_id')
          .onRef('u.tenant_id', '=', 't.tenant_id')
          .onRef('u.project_id', '=', 't.project_id'),
      )
      .select([
        't.id as transaction_id',
        't.buyer_profile_id',
        'b.user_id as buyer_user_id',
        'buyer.display_name as buyer_display_name',
        't.status as transaction_status',
        't.opened_at',
        'u.id as unit_type_id',
        'u.code as unit_type_code',
        'u.name as unit_type_name',
        sql<string>`COALESCE((
          SELECT SUM(CASE WHEN m.status IN ('COMPLETED','WAIVED') THEN m.weight_percent ELSE 0 END)
          FROM transaction_milestones m
          WHERE m.transaction_id = t.id
        ), 0)::text`.as('completion_percent'),
      ])
      .where('t.tenant_id', '=', input.tenantId)
      .where('t.project_id', '=', input.projectId)
      .where('t.status', 'in', ['IN_PROGRESS', 'READY_FOR_COMPLETION'])
      .orderBy('t.opened_at', 'asc')
      .orderBy('t.id', 'asc')
      .execute();

    if (rows.length === 0) return this.emptySnapshot(input.now);

    const transactionIds = rows.map((row) => row.transaction_id);
    const milestones = await this.db
      .selectFrom('transaction_milestones')
      .select(['transaction_id', 'code', 'label', 'status'])
      .where('transaction_id', 'in', transactionIds)
      .execute();

    const contractDocuments = await this.db
      .selectFrom('transaction_documents')
      .select(['id', 'transaction_id', 'template_id', 'revision_number', 'status'])
      .where('transaction_id', 'in', transactionIds)
      .where('category', '=', 'CONTRACT')
      .where('status', 'not in', ['REJECTED', 'SUPERSEDED'])
      .orderBy('transaction_id', 'asc')
      .orderBy('revision_number', 'desc')
      .execute();

    const latestContractByTransaction = new Map<string, (typeof contractDocuments)[number]>();
    for (const document of contractDocuments) {
      if (!latestContractByTransaction.has(document.transaction_id)) {
        latestContractByTransaction.set(document.transaction_id, document);
      }
    }

    const latestDocuments = [...latestContractByTransaction.values()];
    const templateIds = [...new Set(latestDocuments.flatMap((document) => document.template_id ? [document.template_id] : []))];
    const documentIds = latestDocuments.map((document) => document.id);

    const signerRequirements = templateIds.length === 0 ? [] : await this.db
      .selectFrom('document_template_signer_requirements')
      .select(['template_id', 'signer_role', 'required'])
      .where('template_id', 'in', templateIds)
      .where('required', '=', true)
      .execute();

    const signatures = documentIds.length === 0 ? [] : await this.db
      .selectFrom('document_signatures')
      .select(['document_id', 'signer_role'])
      .where('document_id', 'in', documentIds)
      .execute();

    const milestonesByTransaction = new Map<string, TransactionOperationMilestoneSnapshot[]>();
    for (const milestone of milestones) {
      const list = milestonesByTransaction.get(milestone.transaction_id) ?? [];
      list.push({
        code: milestone.code as TransactionOperationMilestoneCode,
        label: milestone.label,
        status: milestone.status,
      });
      milestonesByTransaction.set(milestone.transaction_id, list);
    }

    const requirementsByTemplate = new Map<string, Set<TransactionOperationSignerRole>>();
    for (const requirement of signerRequirements) {
      const set = requirementsByTemplate.get(requirement.template_id) ?? new Set<TransactionOperationSignerRole>();
      set.add(requirement.signer_role);
      requirementsByTemplate.set(requirement.template_id, set);
    }

    const signaturesByDocument = new Map<string, Set<TransactionOperationSignerRole>>();
    for (const signature of signatures) {
      const set = signaturesByDocument.get(signature.document_id) ?? new Set<TransactionOperationSignerRole>();
      set.add(signature.signer_role);
      signaturesByDocument.set(signature.document_id, set);
    }

    const items = rows.map((row): TransactionOperationQueueItemSnapshot => {
      const allMilestones = this.sortMilestones(milestonesByTransaction.get(row.transaction_id) ?? []);
      const pendingMilestones = allMilestones.filter((milestone) => !this.isDone(milestone));
      const contract = latestContractByTransaction.get(row.transaction_id) ?? null;
      const requiredRoles: Set<TransactionOperationSignerRole> = contract?.template_id
        ? requirementsByTemplate.get(contract.template_id) ?? new Set<TransactionOperationSignerRole>()
        : new Set<TransactionOperationSignerRole>();
      const signedRoles: Set<TransactionOperationSignerRole> = contract
        ? signaturesByDocument.get(contract.id) ?? new Set<TransactionOperationSignerRole>()
        : new Set<TransactionOperationSignerRole>();
      const missingRequiredSignerRoles: TransactionOperationSignerRole[] = [...requiredRoles]
        .filter((role) => !signedRoles.has(role));
      const classification = classifyTransactionOperation({
        milestones: allMilestones,
        contractDocumentId: contract?.id ?? null,
        missingSignerRoles: missingRequiredSignerRoles,
      });

      return {
        transactionId: row.transaction_id,
        buyerProfileId: row.buyer_profile_id,
        buyerUserId: row.buyer_user_id,
        buyerDisplayName: row.buyer_display_name,
        unitTypeId: row.unit_type_id,
        unitTypeCode: row.unit_type_code,
        unitTypeName: row.unit_type_name,
        transactionStatus: row.transaction_status as 'IN_PROGRESS' | 'READY_FOR_COMPLETION',
        completionPercent: Number(row.completion_percent).toFixed(2),
        openedAt: (row.opened_at as Date).toISOString(),
        ageHours: Math.max(0, Math.floor((input.now.getTime() - (row.opened_at as Date).getTime()) / 3_600_000)),
        bucket: classification.bucket,
        nextAction: classification.nextAction,
        pendingMilestoneCount: pendingMilestones.length,
        pendingMilestones,
        contractDocumentId: contract?.id ?? null,
        missingRequiredSignerRoles,
      };
    });

    const counts = Object.fromEntries(BUCKETS.map((bucket) => [bucket, 0])) as Record<TransactionOperationBucket, number>;
    for (const item of items) counts[item.bucket] += 1;

    return {
      generatedAt: input.now.toISOString(),
      counts,
      items,
    };
  }

  private emptySnapshot(now: Date): TransactionOperationQueueSnapshot {
    return {
      generatedAt: now.toISOString(),
      counts: Object.fromEntries(BUCKETS.map((bucket) => [bucket, 0])) as Record<TransactionOperationBucket, number>,
      items: [],
    };
  }

  private sortMilestones(milestones: TransactionOperationMilestoneSnapshot[]): TransactionOperationMilestoneSnapshot[] {
    const order = new Map(MILESTONE_ORDER.map((code, index) => [code, index]));
    return [...milestones].sort((a, b) => (order.get(a.code) ?? 999) - (order.get(b.code) ?? 999));
  }

  private isDone(milestone: TransactionOperationMilestoneSnapshot | undefined): boolean {
    return Boolean(milestone && ['COMPLETED', 'WAIVED'].includes(milestone.status));
  }
}
