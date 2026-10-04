import { ConflictException, Inject, Injectable } from '@nestjs/common';
import type { Kysely, Transaction } from 'kysely';
import type { Database, JsonValue } from '@preneura/database';
import type {
  CommissionCaseSnapshot,
  CreateCommissionPlanInput,
  UpdateCommissionCaseStatusInput,
} from '@preneura/contracts/commissions';
import { DATABASE } from '../database/database.module.js';

interface BrokerTransactionContext {
  transactionId: string;
  tenantId: string;
  projectId: string;
  transactionStatus: 'IN_PROGRESS' | 'READY_FOR_COMPLETION' | 'COMPLETED' | 'CANCELLED';
  openedAt: Date;
  buyerProfileId: string;
  brokerCompanyId: string;
  brokerAgentUserId: string | null;
  basisAmount: string;
}

@Injectable()
export class CommissionRepository {
  constructor(@Inject(DATABASE) private readonly db: Kysely<Database>) {}

  async createPlan(input: {
    actorUserId: string;
    data: CreateCommissionPlanInput;
    now: Date;
  }): Promise<{ commissionPlanId: string; versionNumber: number }> {
    return this.db.transaction().execute(async (trx) => {
      const access = await trx
        .selectFrom('broker_project_access')
        .select(['broker_company_id', 'status', 'effective_from', 'effective_to'])
        .where('tenant_id', '=', input.data.tenantId)
        .where('project_id', '=', input.data.projectId)
        .where('broker_company_id', '=', input.data.brokerCompanyId)
        .forUpdate()
        .executeTakeFirst();
      if (
        !access ||
        access.status !== 'ACTIVE' ||
        (access.effective_from as Date).getTime() > input.now.getTime() ||
        (access.effective_to && (access.effective_to as Date).getTime() <= input.now.getTime())
      ) {
        throw new ConflictException('Broker company does not currently have access to this project.');
      }

      const latest = await trx
        .selectFrom('broker_commission_plans')
        .select((eb) => eb.fn.max<number>('version_number').as('max_version'))
        .where('project_id', '=', input.data.projectId)
        .where('broker_company_id', '=', input.data.brokerCompanyId)
        .executeTakeFirst();
      const versionNumber = Number(latest?.max_version ?? 0) + 1;

      const plan = await trx
        .insertInto('broker_commission_plans')
        .values({
          tenant_id: input.data.tenantId,
          project_id: input.data.projectId,
          broker_company_id: input.data.brokerCompanyId,
          version_number: versionNumber,
          status: 'ACTIVE',
          rate_percent: input.data.ratePercent,
          due_days_after_eligibility: input.data.dueDaysAfterEligibility,
          effective_at: new Date(input.data.effectiveAt),
          activated_at: input.now,
          created_by: input.actorUserId,
          updated_at: input.now,
        })
        .returning('id')
        .executeTakeFirstOrThrow();

      await this.outbox(trx, {
        tenantId: input.data.tenantId,
        projectId: input.data.projectId,
        aggregateType: 'BROKER_COMMISSION_PLAN',
        aggregateId: plan.id,
        eventType: 'commission.plan.published',
        payload: {
          brokerCompanyId: input.data.brokerCompanyId,
          versionNumber,
          effectiveAt: input.data.effectiveAt,
        },
      });
      return { commissionPlanId: plan.id, versionNumber };
    });
  }

  async syncBrokerCases(input: {
    tenantId: string;
    projectId: string;
    brokerCompanyId: string;
    now: Date;
  }): Promise<void> {
    const transactions = await this.db
      .selectFrom('transactions as t')
      .innerJoin('buyer_profiles as b', (join) =>
        join.onRef('b.id', '=', 't.buyer_profile_id').onRef('b.tenant_id', '=', 't.tenant_id'),
      )
      .innerJoin('reservations as r', (join) =>
        join.onRef('r.id', '=', 't.reservation_id').onRef('r.tenant_id', '=', 't.tenant_id').onRef('r.project_id', '=', 't.project_id'),
      )
      .select('t.id')
      .where('t.tenant_id', '=', input.tenantId)
      .where('t.project_id', '=', input.projectId)
      .where('b.source', '=', 'BROKER')
      .where('b.broker_company_id', '=', input.brokerCompanyId)
      .where('r.quoted_total', 'is not', null)
      .execute();
    for (const transaction of transactions) {
      await this.refreshTransactionCase({
        tenantId: input.tenantId,
        projectId: input.projectId,
        transactionId: transaction.id,
        now: input.now,
      });
    }
  }

  async refreshTransactionCase(input: {
    tenantId: string;
    projectId: string;
    transactionId: string;
    now: Date;
  }): Promise<string | null> {
    const context = await this.getBrokerTransaction(input);
    if (!context) return null;

    let caseRow = await this.db
      .selectFrom('broker_commission_cases')
      .select('id')
      .where('transaction_id', '=', input.transactionId)
      .executeTakeFirst();

    if (!caseRow) {
      const plan = await this.db
        .selectFrom('broker_commission_plans')
        .select(['id', 'rate_percent', 'due_days_after_eligibility'])
        .where('tenant_id', '=', input.tenantId)
        .where('project_id', '=', input.projectId)
        .where('broker_company_id', '=', context.brokerCompanyId)
        .where('status', '=', 'ACTIVE')
        .where('effective_at', '<=', context.openedAt)
        .orderBy('effective_at', 'desc')
        .orderBy('version_number', 'desc')
        .executeTakeFirst();
      if (!plan) return null;

      const inserted = await this.db
        .insertInto('broker_commission_cases')
        .values({
          tenant_id: input.tenantId,
          project_id: input.projectId,
          transaction_id: input.transactionId,
          broker_company_id: context.brokerCompanyId,
          broker_agent_user_id: context.brokerAgentUserId,
          commission_plan_id: plan.id,
          basis_amount: context.basisAmount,
          rate_percent: plan.rate_percent,
          commission_amount: this.commissionAmount(context.basisAmount, String(plan.rate_percent)),
          status: 'PENDING_PREREQUISITES',
          completion_percent_snapshot: '0',
          eligible_at: null,
          due_at: null,
          invoiced_at: null,
          paid_at: null,
          updated_at: input.now,
        })
        .onConflict((oc) => oc.column('transaction_id').doNothing())
        .returning('id')
        .executeTakeFirst();
      caseRow = inserted ?? await this.db
        .selectFrom('broker_commission_cases')
        .select('id')
        .where('transaction_id', '=', input.transactionId)
        .executeTakeFirst();
      if (!caseRow) return null;
    }

    await this.refreshCase(caseRow.id, context, input.now);
    return caseRow.id;
  }

  async listCases(input: {
    tenantId: string;
    projectId: string;
    brokerCompanyId: string;
    brokerAgentUserId?: string | null;
    now: Date;
  }): Promise<CommissionCaseSnapshot[]> {
    let query = this.db
      .selectFrom('broker_commission_cases as c')
      .innerJoin('transactions as t', 't.id', 'c.transaction_id')
      .select([
        'c.id', 'c.transaction_id', 'c.broker_company_id', 'c.broker_agent_user_id',
        't.buyer_profile_id', 'c.status', 'c.completion_percent_snapshot', 'c.eligible_at',
        'c.due_at', 'c.invoiced_at', 'c.paid_at', 'c.basis_amount', 'c.commission_amount', 'c.rate_percent',
      ])
      .where('c.tenant_id', '=', input.tenantId)
      .where('c.project_id', '=', input.projectId)
      .where('c.broker_company_id', '=', input.brokerCompanyId);
    if (input.brokerAgentUserId) query = query.where('c.broker_agent_user_id', '=', input.brokerAgentUserId);
    const rows = await query.orderBy('c.created_at', 'desc').execute();

    const snapshots: CommissionCaseSnapshot[] = [];
    for (const row of rows) {
      const prerequisitesComplete = await this.prerequisitesComplete(row.transaction_id);
      const dueAt = row.due_at ? row.due_at as Date : null;
      const deltaSeconds = dueAt ? Math.floor((dueAt.getTime() - input.now.getTime()) / 1000) : null;
      snapshots.push({
        commissionCaseId: row.id,
        transactionId: row.transaction_id,
        brokerCompanyId: row.broker_company_id,
        brokerAgentUserId: row.broker_agent_user_id,
        buyerProfileId: row.buyer_profile_id,
        status: row.status,
        completionPercent: String(row.completion_percent_snapshot),
        prerequisitesComplete,
        eligibleAt: row.eligible_at ? (row.eligible_at as Date).toISOString() : null,
        dueAt: dueAt ? dueAt.toISOString() : null,
        dueInSeconds: deltaSeconds !== null && deltaSeconds >= 0 ? deltaSeconds : null,
        overdueSeconds: deltaSeconds !== null && deltaSeconds < 0 ? Math.abs(deltaSeconds) : null,
        invoicedAt: row.invoiced_at ? (row.invoiced_at as Date).toISOString() : null,
        paidAt: row.paid_at ? (row.paid_at as Date).toISOString() : null,
        basisAmount: String(row.basis_amount),
        commissionAmount: String(row.commission_amount),
        ratePercent: String(row.rate_percent),
      });
    }
    return snapshots;
  }

  async updateCaseStatus(input: {
    actorUserId: string;
    data: UpdateCommissionCaseStatusInput;
    now: Date;
  }): Promise<boolean> {
    return this.db.transaction().execute(async (trx) => {
      const row = await trx
        .selectFrom('broker_commission_cases')
        .select(['id', 'transaction_id', 'status'])
        .where('id', '=', input.data.commissionCaseId)
        .where('tenant_id', '=', input.data.tenantId)
        .where('project_id', '=', input.data.projectId)
        .where('broker_company_id', '=', input.data.brokerCompanyId)
        .forUpdate()
        .executeTakeFirst();
      if (!row) return false;

      let nextStatus = row.status;
      let invoicedAt: Date | null | undefined;
      let paidAt: Date | null | undefined;
      switch (input.data.action) {
        case 'MARK_INVOICED':
          if (!['ELIGIBLE', 'DUE'].includes(row.status)) throw new ConflictException('Only eligible commission can be invoiced.');
          nextStatus = 'INVOICED';
          invoicedAt = input.now;
          break;
        case 'MARK_PAID':
          if (!['INVOICED', 'DUE'].includes(row.status)) throw new ConflictException('Commission must be invoiced or due before payment.');
          nextStatus = 'PAID';
          paidAt = input.now;
          break;
        case 'MARK_DISPUTED':
          if (['PAID', 'CANCELLED'].includes(row.status)) throw new ConflictException('Paid or cancelled commission cannot be disputed.');
          nextStatus = 'DISPUTED';
          break;
      }

      await trx
        .updateTable('broker_commission_cases')
        .set({
          status: nextStatus,
          ...(invoicedAt !== undefined ? { invoiced_at: invoicedAt } : {}),
          ...(paidAt !== undefined ? { paid_at: paidAt } : {}),
          updated_at: input.now,
        })
        .where('id', '=', row.id)
        .execute();
      await this.outbox(trx, {
        tenantId: input.data.tenantId,
        projectId: input.data.projectId,
        aggregateType: 'BROKER_COMMISSION_CASE',
        aggregateId: row.id,
        eventType: `commission.case.${nextStatus.toLowerCase()}`,
        payload: { transactionId: row.transaction_id, actorUserId: input.actorUserId },
      });
      return true;
    });
  }

  private async getBrokerTransaction(input: {
    tenantId: string;
    projectId: string;
    transactionId: string;
  }): Promise<BrokerTransactionContext | null> {
    const row = await this.db
      .selectFrom('transactions as t')
      .innerJoin('buyer_profiles as b', (join) =>
        join.onRef('b.id', '=', 't.buyer_profile_id').onRef('b.tenant_id', '=', 't.tenant_id'),
      )
      .innerJoin('reservations as r', (join) =>
        join.onRef('r.id', '=', 't.reservation_id').onRef('r.tenant_id', '=', 't.tenant_id').onRef('r.project_id', '=', 't.project_id'),
      )
      .select([
        't.id', 't.tenant_id', 't.project_id', 't.status', 't.opened_at', 't.buyer_profile_id',
        'b.broker_company_id', 'b.broker_agent_user_id', 'r.quoted_total',
      ])
      .where('t.id', '=', input.transactionId)
      .where('t.tenant_id', '=', input.tenantId)
      .where('t.project_id', '=', input.projectId)
      .where('b.source', '=', 'BROKER')
      .executeTakeFirst();
    if (!row || !row.broker_company_id || row.quoted_total === null) return null;
    return {
      transactionId: row.id,
      tenantId: row.tenant_id,
      projectId: row.project_id,
      transactionStatus: row.status,
      openedAt: row.opened_at as Date,
      buyerProfileId: row.buyer_profile_id,
      brokerCompanyId: row.broker_company_id,
      brokerAgentUserId: row.broker_agent_user_id,
      basisAmount: String(row.quoted_total),
    };
  }

  private async refreshCase(caseId: string, context: BrokerTransactionContext, now: Date): Promise<void> {
    await this.db.transaction().execute(async (trx) => {
      const row = await trx
        .selectFrom('broker_commission_cases as c')
        .innerJoin('broker_commission_plans as p', 'p.id', 'c.commission_plan_id')
        .select(['c.status', 'c.eligible_at', 'c.due_at', 'p.due_days_after_eligibility'])
        .where('c.id', '=', caseId)
        .forUpdate()
        .executeTakeFirstOrThrow();
      const milestones = await trx
        .selectFrom('transaction_milestones')
        .select(['code', 'status', 'weight_percent'])
        .where('transaction_id', '=', context.transactionId)
        .execute();
      const completion = milestones
        .filter((milestone) => ['COMPLETED', 'WAIVED'].includes(milestone.status))
        .reduce((sum, milestone) => sum + Number(milestone.weight_percent), 0);
      const requiredCodes = ['DOWN_PAYMENT_RECEIVED', 'CHEQUES_RECEIVED', 'CONTRACT_SIGNED', 'CONTRACT_STAMPED'] as const;
      const prerequisites = requiredCodes.every((code) =>
        milestones.some((milestone) => milestone.code === code && milestone.status === 'COMPLETED'),
      );

      let status = row.status;
      let eligibleAt = row.eligible_at as Date | null;
      let dueAt = row.due_at as Date | null;
      if (context.transactionStatus === 'CANCELLED') {
        status = 'CANCELLED';
      } else if (prerequisites) {
        if (status === 'PENDING_PREREQUISITES') {
          status = 'ELIGIBLE';
          eligibleAt = now;
          dueAt = new Date(now.getTime() + row.due_days_after_eligibility * 24 * 60 * 60 * 1000);
        }
        if (dueAt && dueAt.getTime() <= now.getTime() && ['ELIGIBLE', 'INVOICED'].includes(status)) {
          status = 'DUE';
        }
      } else if (status === 'ELIGIBLE') {
        status = 'PENDING_PREREQUISITES';
        eligibleAt = null;
        dueAt = null;
      } else if (['INVOICED', 'DUE'].includes(status)) {
        status = 'DISPUTED';
      }

      await trx
        .updateTable('broker_commission_cases')
        .set({
          status,
          completion_percent_snapshot: completion.toFixed(2),
          eligible_at: eligibleAt,
          due_at: dueAt,
          broker_agent_user_id: context.brokerAgentUserId,
          updated_at: now,
        })
        .where('id', '=', caseId)
        .execute();
    });
  }

  private async prerequisitesComplete(transactionId: string): Promise<boolean> {
    const rows = await this.db
      .selectFrom('transaction_milestones')
      .select(['code', 'status'])
      .where('transaction_id', '=', transactionId)
      .where('code', 'in', ['DOWN_PAYMENT_RECEIVED', 'CHEQUES_RECEIVED', 'CONTRACT_SIGNED', 'CONTRACT_STAMPED'])
      .execute();
    const required = ['DOWN_PAYMENT_RECEIVED', 'CHEQUES_RECEIVED', 'CONTRACT_SIGNED', 'CONTRACT_STAMPED'] as const;
    return required.every((code) => rows.some((row) => row.code === code && row.status === 'COMPLETED'));
  }

  private commissionAmount(basisAmount: string, ratePercent: string): string {
    const basisCents = this.moneyCents(basisAmount);
    const rateScaled = this.decimalScaled(ratePercent, 4);
    const divisor = 100n * 10_000n;
    const numerator = basisCents * rateScaled;
    const roundedCents = (numerator + divisor / 2n) / divisor;
    return `${roundedCents / 100n}.${String(roundedCents % 100n).padStart(2, '0')}`;
  }

  private moneyCents(value: string): bigint {
    const [whole = '0', fraction = ''] = value.split('.');
    return BigInt(whole) * 100n + BigInt(`${fraction}00`.slice(0, 2));
  }

  private decimalScaled(value: string, digits: number): bigint {
    const [whole = '0', fraction = ''] = value.split('.');
    return BigInt(whole) * (10n ** BigInt(digits)) + BigInt(`${fraction}${'0'.repeat(digits)}`.slice(0, digits));
  }

  private async outbox(
    trx: Transaction<Database>,
    input: {
      tenantId: string;
      projectId: string;
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
