import { createDatabase } from '@preneura/database';
import type { AccessService } from '../access/access.service.js';
import { CommissionRepository } from '../commissions/commission.repository.js';
import { CommissionService } from '../commissions/commission.service.js';
import { EoiRefundRepository } from '../sales/eoi-refund.repository.js';

const IDS = {
  tenant: '40000000-0000-0000-0000-000000000100',
  project: '40000000-0000-0000-0000-000000000101',
  broker: '40000000-0000-0000-0000-000000000102',
  agentOne: '40000000-0000-0000-0000-000000000002',
  agentTwo: '40000000-0000-0000-0000-000000000003',
  buyerOne: '40000000-0000-0000-0000-000000000004',
  transactionOne: '40000000-0000-0000-0000-000000001000',
  transactionTwo: '40000000-0000-0000-0000-000000001001',
  historicalCommissionPlan: '40000000-0000-0000-0000-000000001100',
  historicalRefundPolicy: '40000000-0000-0000-0000-000000000300',
  eoiOne: '40000000-0000-0000-0000-000000000500',
} as const;

function expect(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function mockAccess(input: {
  role: 'BROKER_AGENT' | 'BROKER_MANAGER';
  economicsAllowed: boolean;
}): AccessService {
  return {
    assert: async () => ({ allowed: true, role: input.role }),
    can: async ({ permission }: { permission: string }) => ({
      allowed:
        input.economicsAllowed &&
        (permission === 'commission.amount.read' || permission === 'commission.rate.read'),
      role: input.role,
    }),
  } as unknown as AccessService;
}

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is required');

  const db = createDatabase(connectionString);
  try {
    const repository = new CommissionRepository(db);

    // A sale opened in January must bind to the January agreement even though
    // a higher-rate February agreement is already present when the case is created.
    await repository.refreshTransactionCase({
      tenantId: IDS.tenant,
      projectId: IDS.project,
      transactionId: IDS.transactionOne,
      now: new Date('2026-01-15T00:00:00Z'),
    });
    await repository.refreshTransactionCase({
      tenantId: IDS.tenant,
      projectId: IDS.project,
      transactionId: IDS.transactionTwo,
      now: new Date('2026-01-15T00:00:00Z'),
    });

    const historicalCase = await db
      .selectFrom('broker_commission_cases')
      .select([
        'commission_plan_id',
        'rate_percent',
        'commission_amount',
        'status',
        'eligible_at',
        'due_at',
      ])
      .where('transaction_id', '=', IDS.transactionOne)
      .executeTakeFirstOrThrow();

    expect(
      historicalCase.commission_plan_id === IDS.historicalCommissionPlan,
      'commission case did not bind to the agreement effective when the transaction opened',
    );
    expect(Number(historicalCase.rate_percent) === 4, 'historical commission rate was not snapshotted');
    expect(Number(historicalCase.commission_amount) === 12, 'historical commission amount is incorrect');
    expect(historicalCase.status === 'ELIGIBLE', 'completed prerequisites did not make commission eligible');
    expect(historicalCase.eligible_at !== null && historicalCase.due_at !== null, 'eligible/due timestamps were not captured');

    // Due state is based on the snapshotted plan's five-day term, not the newer 30-day plan.
    await repository.refreshTransactionCase({
      tenantId: IDS.tenant,
      projectId: IDS.project,
      transactionId: IDS.transactionOne,
      now: new Date('2026-01-21T00:00:00Z'),
    });
    const dueCase = await db
      .selectFrom('broker_commission_cases')
      .select(['status', 'commission_plan_id', 'rate_percent', 'commission_amount'])
      .where('transaction_id', '=', IDS.transactionOne)
      .executeTakeFirstOrThrow();
    expect(dueCase.status === 'DUE', 'commission did not transition to DUE after its historical term');
    expect(dueCase.commission_plan_id === IDS.historicalCommissionPlan, 'due refresh changed historical plan');
    expect(Number(dueCase.rate_percent) === 4 && Number(dueCase.commission_amount) === 12, 'due refresh changed historical economics');

    // Broker Agent is both attribution-scoped and economics-redacted.
    const agentService = new CommissionService(repository, mockAccess({ role: 'BROKER_AGENT', economicsAllowed: false }));
    const agentCases = await agentService.listCases({
      actorUserId: IDS.agentOne,
      tenantId: IDS.tenant,
      projectId: IDS.project,
      brokerCompanyId: IDS.broker,
    });
    expect(agentCases.length === 1, 'broker agent received another agent commission case');
    expect(agentCases[0]?.transactionId === IDS.transactionOne, 'broker agent did not receive only the attributed case');
    expect(!('basisAmount' in agentCases[0]!), 'broker agent response leaked commission basis amount');
    expect(!('commissionAmount' in agentCases[0]!), 'broker agent response leaked commission amount');
    expect(!('ratePercent' in agentCases[0]!), 'broker agent response leaked commission rate');

    // Broker management projection may contain economics while keeping the same authoritative case rows.
    const managerService = new CommissionService(repository, mockAccess({ role: 'BROKER_MANAGER', economicsAllowed: true }));
    const managerCases = await managerService.listCases({
      actorUserId: IDS.agentOne,
      tenantId: IDS.tenant,
      projectId: IDS.project,
      brokerCompanyId: IDS.broker,
    });
    expect(managerCases.length === 2, 'broker manager did not receive company-wide commission cases');
    expect(managerCases.every((item) => 'basisAmount' in item && 'commissionAmount' in item && 'ratePercent' in item), 'broker manager economics projection is incomplete');

    // Refund authority is the policy snapshotted on the EOI, not the currently active policy.
    const refunds = new EoiRefundRepository(db);
    const quote = await refunds.quote({ tenantId: IDS.tenant, projectId: IDS.project, eoiId: IDS.eoiOne });
    expect(quote !== null, 'historical EOI refund quote was not resolved');
    expect(quote.policyId === IDS.historicalRefundPolicy, 'refund quote switched to the current policy');
    expect(quote.stage === 'AFTER_CONTRACT', 'refund stage did not reflect authoritative transaction progress');
    expect(Number(quote.refundPercent) === 25, 'historical after-contract refund percentage changed');
    expect(Number(quote.processingFee) === 50, 'historical processing fee changed');
    expect(Number(quote.refundableAmount) === 200, 'historical refund amount is incorrect');

    const request = await refunds.request({
      tenantId: IDS.tenant,
      projectId: IDS.project,
      eoiId: IDS.eoiOne,
      actorUserId: IDS.buyerOne,
      now: new Date('2026-03-01T00:00:00Z'),
    });
    expect(request.quote.policyId === IDS.historicalRefundPolicy, 'refund request changed the historical policy');
    expect(Number(request.quote.refundableAmount) === 200, 'refund request changed the historical amount');

    const approved = await refunds.review({
      tenantId: IDS.tenant,
      projectId: IDS.project,
      refundRequestId: request.refundRequestId,
      actorUserId: '40000000-0000-0000-0000-000000000001',
      decision: 'APPROVE',
      note: 'Gate 4 approval separation test',
      now: new Date('2026-03-01T01:00:00Z'),
    });
    expect(approved.status === 'APPROVED', 'refund approval did not persist');

    const persistedRefund = await db
      .selectFrom('eoi_refund_requests')
      .select(['refund_policy_id', 'requested_amount', 'status', 'paid_at'])
      .where('id', '=', request.refundRequestId)
      .executeTakeFirstOrThrow();
    expect(persistedRefund.refund_policy_id === IDS.historicalRefundPolicy, 'refund request lost policy lineage');
    expect(Number(persistedRefund.requested_amount) === 200, 'refund request amount mutated after approval');
    expect(persistedRefund.status === 'APPROVED' && persistedRefund.paid_at === null, 'refund approval was incorrectly treated as payout');

    console.log('Gate 4 API certification passed.');
  } finally {
    await db.destroy();
  }
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
