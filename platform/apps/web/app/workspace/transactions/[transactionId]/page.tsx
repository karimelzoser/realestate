import ContractExecutionPanel from './contract-execution-panel';
import TransactionDetailClient from './transaction-detail-client';
import TransactionFinanceSetup from './transaction-finance-setup';
import TransactionIdentityPanel from './transaction-identity-panel';
import TransactionPricePanel from './transaction-price-panel';
import TransactionShortcuts from './transaction-shortcuts';
import TransactionTimelinePanel from './transaction-timeline-panel';

type PageProps = {
  params: Promise<{ transactionId: string }>;
  searchParams: Promise<{
    tenantId?: string | string[];
    projectId?: string | string[];
  }>;
};

export default async function TransactionDetailPage({ params, searchParams }: PageProps) {
  const [{ transactionId }, query] = await Promise.all([params, searchParams]);
  const tenantId = Array.isArray(query.tenantId) ? query.tenantId[0] : query.tenantId;
  const projectId = Array.isArray(query.projectId) ? query.projectId[0] : query.projectId;
  const resolvedTenantId = tenantId ?? '';
  const resolvedProjectId = projectId ?? '';

  return (
    <>
      <TransactionDetailClient
        transactionId={transactionId}
        tenantId={resolvedTenantId}
        projectId={resolvedProjectId}
      />
      <TransactionIdentityPanel
        transactionId={transactionId}
        tenantId={resolvedTenantId}
        projectId={resolvedProjectId}
      />
      <TransactionPricePanel
        transactionId={transactionId}
        tenantId={resolvedTenantId}
        projectId={resolvedProjectId}
      />
      <ContractExecutionPanel
        transactionId={transactionId}
        tenantId={resolvedTenantId}
        projectId={resolvedProjectId}
      />
      <TransactionShortcuts
        transactionId={transactionId}
        tenantId={resolvedTenantId}
        projectId={resolvedProjectId}
      />
      <TransactionFinanceSetup
        transactionId={transactionId}
        tenantId={resolvedTenantId}
        projectId={resolvedProjectId}
      />
      <TransactionTimelinePanel
        transactionId={transactionId}
        tenantId={resolvedTenantId}
        projectId={resolvedProjectId}
      />
    </>
  );
}
