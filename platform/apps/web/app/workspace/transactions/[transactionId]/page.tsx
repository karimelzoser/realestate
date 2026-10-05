import TransactionDetailClient from './transaction-detail-client';
import TransactionFinanceSetup from './transaction-finance-setup';
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
