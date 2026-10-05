'use client';

import {
  roleHasPermission,
  type WorkspaceContextSnapshot,
  type WorkspaceProjectSnapshot,
} from '@preneura/contracts/access';
import type {
  DocumentCategory,
  DocumentTemplateSnapshot,
  UploadIntentResponse,
} from '@preneura/contracts/documents';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { ApiError, apiFetch } from '../../../../../../lib/api';
import styles from './document-upload.module.css';

type Props = {
  transactionId: string;
  tenantId: string;
  projectId: string;
};

const categories: ReadonlyArray<{ value: DocumentCategory; label: string; hint: string }> = [
  { value: 'BUYER_ID', label: 'Buyer ID', hint: 'National ID or identity document.' },
  { value: 'PASSPORT', label: 'Passport', hint: 'Passport identity pages.' },
  { value: 'ADDRESS_PROOF', label: 'Address proof', hint: 'Utility bill or other accepted address evidence.' },
  { value: 'PAYMENT_RECEIPT', label: 'Payment receipt', hint: 'Receipt or transfer evidence.' },
  { value: 'CHEQUE', label: 'Cheque', hint: 'Cheque image or supporting record.' },
  { value: 'CONTRACT', label: 'Contract', hint: 'Contract document prepared for review/signing.' },
  { value: 'STAMPED_CONTRACT', label: 'Stamped contract', hint: 'Final stamped contract evidence.' },
  { value: 'OTHER', label: 'Other', hint: 'Other transaction evidence.' },
];

const maxBytes = 25 * 1024 * 1024;

export default function DocumentUploadTemplateClient({ transactionId, tenantId, projectId }: Props) {
  const [project, setProject] = useState<WorkspaceProjectSnapshot | null>(null);
  const [templates, setTemplates] = useState<DocumentTemplateSnapshot[]>([]);
  const [canUseTemplates, setCanUseTemplates] = useState(false);
  const [category, setCategory] = useState<DocumentCategory>('BUYER_ID');
  const [templateId, setTemplateId] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [dueAt, setDueAt] = useState('');
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  const detailHref = useMemo(
    () => `/workspace/transactions/${transactionId}?tenantId=${encodeURIComponent(tenantId)}&projectId=${encodeURIComponent(projectId)}`,
    [projectId, tenantId, transactionId],
  );
  const matchingTemplates = useMemo(
    () => templates.filter((template) => template.category === category),
    [category, templates],
  );
  const selectedTemplate = useMemo(
    () => matchingTemplates.find((template) => template.templateId === templateId) ?? null,
    [matchingTemplates, templateId],
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const context = await apiFetch<WorkspaceContextSnapshot>('/v1/me/workspace');
        if (cancelled) return;
        const nextProject = context.projects.find(
          (candidate) => candidate.tenantId === tenantId && candidate.projectId === projectId,
        );
        if (!nextProject) {
          setError('This project is not in your current workspace scope.');
          return;
        }
        const regularUpload = nextProject.roles.some((role) => roleHasPermission(role, 'documents.upload'));
        const selfUpload = nextProject.roles.some((role) => roleHasPermission(role, 'documents.upload.self'));
        if (!regularUpload && !selfUpload) {
          setError('Your current role does not include document upload permission.');
          return;
        }
        setProject(nextProject);
        setCanUseTemplates(regularUpload);
        if (regularUpload) {
          const active = await apiFetch<DocumentTemplateSnapshot[]>(
            `/v1/tenants/${tenantId}/projects/${projectId}/document-templates/active`,
          );
          if (!cancelled) setTemplates(active);
        }
      } catch (reason) {
        if (reason instanceof ApiError && reason.status === 401) {
          window.location.replace('/login');
          return;
        }
        if (!cancelled) setError(reason instanceof Error ? reason.message : 'Unable to verify upload access.');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId, tenantId]);

  useEffect(() => {
    if (!canUseTemplates) {
      setTemplateId('');
      return;
    }
    if (templateId && matchingTemplates.some((template) => template.templateId === templateId)) return;
    setTemplateId(matchingTemplates[0]?.templateId ?? '');
  }, [canUseTemplates, matchingTemplates, templateId]);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!project || !file || busy) return;
    setBusy(true);
    setError('');
    setSuccess(false);

    try {
      if (file.size < 1 || file.size > maxBytes) throw new Error('Choose a file between 1 byte and 25 MB.');
      const mimeType = supportedMimeType(file);
      if (!mimeType) throw new Error('Supported formats are PDF, JPEG, PNG and DOCX.');

      setStage('Calculating SHA-256 integrity digest…');
      const sha256Base64 = await digestSha256Base64(file);
      const descriptor = { filename: file.name, mimeType, byteSize: file.size, sha256Base64 } as const;

      setStage('Requesting a secure upload slot…');
      const intent = await apiFetch<UploadIntentResponse>(
        `/v1/tenants/${tenantId}/projects/${projectId}/transactions/${transactionId}/documents/upload-intent`,
        {
          method: 'POST',
          body: JSON.stringify({
            category,
            ...(templateId ? { templateId } : {}),
            ...(dueAt ? { dueAt: new Date(dueAt).toISOString() } : {}),
            file: descriptor,
          }),
        },
      );
      if (!intent.documentId) throw new Error('The upload intent did not include a document identifier.');

      setStage('Uploading directly to protected object storage…');
      const upload = await fetch(intent.uploadUrl, {
        method: 'PUT',
        headers: intent.requiredHeaders,
        body: file,
      });
      if (!upload.ok) {
        throw new Error(`Object storage rejected the upload (${upload.status}). Check storage CORS and signed-header configuration.`);
      }

      setStage('Verifying stored bytes and finalizing the document…');
      await apiFetch<{ finalized: true }>(
        `/v1/tenants/${tenantId}/projects/${projectId}/transactions/${transactionId}/documents/${intent.documentId}/finalize`,
        {
          method: 'POST',
          body: JSON.stringify({ objectKey: intent.objectKey, file: descriptor }),
        },
      );

      setSuccess(true);
      setStage(selectedTemplate
        ? `Document verified and attached using ${selectedTemplate.name} v${selectedTemplate.versionNumber}.`
        : 'Document verified and attached as ad-hoc evidence.');
      setFile(null);
      const input = document.getElementById('transaction-document-file') as HTMLInputElement | null;
      if (input) input.value = '';
    } catch (reason) {
      if (reason instanceof ApiError && reason.status === 401) {
        window.location.replace('/login');
        return;
      }
      setStage('');
      setError(reason instanceof Error ? reason.message : 'Unable to upload the document.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className={styles.page}>
      <header className={styles.topbar}>
        <a href={detailHref} className={styles.backButton}>←</a>
        <div className={styles.brandMark}>P</div>
        <div><strong>PRENEURA</strong><span>{project?.projectName ?? 'Transaction documents'}</span></div>
      </header>

      <section className={styles.content}>
        <div className={styles.heading}>
          <span className={styles.eyebrow}>Verified document intake</span>
          <h1>Upload transaction document</h1>
          <p>
            Internal uploads can bind to the project&apos;s effective active template version. PRENEURA hashes the file locally,
            uploads directly to protected object storage, and verifies the stored bytes before accepting the business record.
          </p>
        </div>

        <div className={styles.layout}>
          <form className={styles.card} onSubmit={submit}>
            <div className={styles.field}>
              <label htmlFor="document-category">Document category</label>
              <select id="document-category" value={category} onChange={(event) => setCategory(event.target.value as DocumentCategory)} disabled={busy}>
                {categories.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
              </select>
              <small>{categories.find((item) => item.value === category)?.hint}</small>
            </div>

            {canUseTemplates ? (
              <div className={styles.field}>
                <label htmlFor="document-template">Active template <span>optional for evidence uploads</span></label>
                <select id="document-template" value={templateId} onChange={(event) => setTemplateId(event.target.value)} disabled={busy}>
                  <option value="">No template — ad-hoc evidence</option>
                  {matchingTemplates.map((template) => (
                    <option key={template.templateId} value={template.templateId}>
                      {template.name} · {template.code} · v{template.versionNumber} · {template.scope === 'PROJECT' ? 'Project' : 'Tenant default'}
                    </option>
                  ))}
                </select>
                <small>
                  {selectedTemplate
                    ? `${selectedTemplate.requiresSignature ? 'Signature workflow enabled' : 'No signature workflow'} · ${selectedTemplate.signerRequirements.length} signer rule(s).`
                    : category === 'CONTRACT'
                      ? 'No template selected. This contract can be stored and reviewed, but template-driven signing will not complete.'
                      : matchingTemplates.length === 0
                        ? 'No active template exists for this category; the upload remains valid operational evidence.'
                        : 'Choose an active template when this document should inherit its version and signer rules.'}
                </small>
              </div>
            ) : null}

            <div className={styles.field}>
              <label htmlFor="transaction-document-file">File</label>
              <input
                id="transaction-document-file"
                type="file"
                accept="application/pdf,image/jpeg,image/png,application/vnd.openxmlformats-officedocument.wordprocessingml.document,.pdf,.jpg,.jpeg,.png,.docx"
                onChange={(event) => setFile(event.target.files?.[0] ?? null)}
                disabled={busy}
                required
              />
              <small>PDF, JPEG, PNG or DOCX · maximum 25 MB.</small>
            </div>

            <div className={styles.field}>
              <label htmlFor="document-due-at">Due date <span>optional</span></label>
              <input id="document-due-at" type="datetime-local" value={dueAt} onChange={(event) => setDueAt(event.target.value)} disabled={busy} />
            </div>

            {file ? (
              <div className={styles.fileSummary}>
                <div><strong>{file.name}</strong><span>{formatBytes(file.size)}</span></div>
                <span>{supportedMimeType(file) ? 'Supported' : 'Unsupported'}</span>
              </div>
            ) : null}

            {error ? <div className={styles.error}>{error}</div> : null}
            {success ? <div className={styles.success}>{stage}</div> : null}
            {!success && stage ? <div className={styles.stage}>{stage}</div> : null}

            <button type="submit" disabled={busy || !project || !file}>{busy ? 'Processing…' : 'Upload and verify'}</button>
          </form>

          <aside className={styles.infoCard}>
            <span className={styles.eyebrow}>Integrity controls</span>
            <h2>What happens to the file</h2>
            <ol>
              <li><strong>Resolve policy.</strong><span>Internal operators may bind the effective project or tenant-default template version.</span></li>
              <li><strong>Hash locally.</strong><span>The browser computes SHA-256 before any upload begins.</span></li>
              <li><strong>Upload direct.</strong><span>Bytes go to scoped object storage rather than through the API process.</span></li>
              <li><strong>Verify server-side.</strong><span>Size, MIME type and SHA-256 must match before the record is finalized.</span></li>
            </ol>
            <div className={styles.contextBox}>
              <span>Transaction</span><code>{shortId(transactionId)}</code>
              <span>Project</span><strong>{project?.projectName ?? shortId(projectId)}</strong>
              <span>Template</span><strong>{selectedTemplate ? `${selectedTemplate.code} v${selectedTemplate.versionNumber}` : 'Ad-hoc'}</strong>
            </div>
          </aside>
        </div>
      </section>
    </main>
  );
}

function supportedMimeType(file: File):
  | 'application/pdf'
  | 'image/jpeg'
  | 'image/png'
  | 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  | null {
  const allowed = new Set([
    'application/pdf',
    'image/jpeg',
    'image/png',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  ]);
  if (allowed.has(file.type)) return file.type as ReturnType<typeof supportedMimeType>;
  const extension = file.name.split('.').pop()?.toLowerCase();
  if (extension === 'pdf') return 'application/pdf';
  if (extension === 'jpg' || extension === 'jpeg') return 'image/jpeg';
  if (extension === 'png') return 'image/png';
  if (extension === 'docx') return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  return null;
}

async function digestSha256Base64(file: File): Promise<string> {
  const bytes = await file.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const view = new Uint8Array(digest);
  let binary = '';
  for (const value of view) binary += String.fromCharCode(value);
  return btoa(binary);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function shortId(value: string): string {
  return value.length > 12 ? `${value.slice(0, 6)}…${value.slice(-4)}` : value;
}
