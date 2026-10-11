import ExactAllocationClient from './exact-allocation-client';

type PageProps = {
  params: Promise<{ queueEntryId: string }>;
  searchParams: Promise<{
    tenantId?: string | string[];
    projectId?: string | string[];
  }>;
};

export default async function ExactAllocationPage({ params, searchParams }: PageProps) {
  const [{ queueEntryId }, query] = await Promise.all([params, searchParams]);
  const tenantId = Array.isArray(query.tenantId) ? query.tenantId[0] : query.tenantId;
  const projectId = Array.isArray(query.projectId) ? query.projectId[0] : query.projectId;

  return (
    <ExactAllocationClient
      queueEntryId={queueEntryId}
      tenantId={tenantId ?? ''}
      projectId={projectId ?? ''}
    />
  );
}
