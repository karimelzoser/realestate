import DocumentUploadClient from './document-upload-client';

type PageProps = {
  params: Promise<{ transactionId: string }>;
  searchParams: Promise<{
    tenantId?: string | string[];
    projectId?: string | string[];
  }>;
};

export default async function TransactionDocumentUploadPage({ params, searchParams }: PageProps) {
  const [{ transactionId }, query] = await Promise.all([params, searchParams]);
  const tenantId = Array.isArray(query.tenantId) ? query.tenantId[0] : query.tenantId;
  const projectId = Array.isArray(query.projectId) ? query.projectId[0] : query.projectId;

  return (
    <DocumentUploadClient
      transactionId={transactionId}
      tenantId={tenantId ?? ''}
      projectId={projectId ?? ''}
    />
  );
}
