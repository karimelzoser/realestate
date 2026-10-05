import SupportWorkspaceClient from './support-workspace-client';

type PageProps = {
  searchParams: Promise<{
    tenantId?: string | string[];
    projectId?: string | string[];
  }>;
};

export default async function SupportWorkspacePage({ searchParams }: PageProps) {
  const query = await searchParams;
  const tenantId = Array.isArray(query.tenantId) ? query.tenantId[0] : query.tenantId;
  const projectId = Array.isArray(query.projectId) ? query.projectId[0] : query.projectId;
  return <SupportWorkspaceClient tenantId={tenantId ?? ''} projectId={projectId ?? ''} />;
}
