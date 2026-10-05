'use client';

import {
  roleHasPermission,
  type WorkspaceContextSnapshot,
  type WorkspaceProjectSnapshot,
} from '@preneura/contracts/access';
import type {
  DocumentCategory,
  DocumentTemplateSnapshot,
  SignerRole,
  UploadIntentResponse,
} from '@preneura/contracts/documents';
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { ApiError, apiFetch } from '../../../lib/api';
import styles from './document-templates.module.css';

const projectStorageKey = 'preneura:selected-project';
const maxBytes = 25 * 1024 * 1024;

const categories = [
  'BUYER_ID',
  'PASSPORT',
  'ADDRESS_PROOF',
  'PAYMENT_RECEIPT',
  'CHEQUE',
  'CONTRACT',
  'STAMPED_CONTRACT',
  'OTHER',
] as const satisfies readonly DocumentCategory[];

const signerRoles = ['BUYER', 'COMPANY', 'WITNESS', 'BROKER'] as const satisfies readonly SignerRole[];

export default function DocumentTemplatesClient() {
  const [workspace, setWorkspace] = useState<WorkspaceContextSnapshot | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [templates, setTemplates] = useState<DocumentTemplateSnapshot[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [category, setCategory] = useState<DocumentCategory>('CONTRACT');
  const [file, setFile] = useState<File | null>(null);
  const [requiresSignature, setRequiresSignature] = useState(true);
  const [selectedSigners, setSelectedSigners] = useState<SignerRole[]>(['BUYER', 'COMPANY']);

  const manageableProjects = useMemo(
    () => workspace?.projects.filter((project) =>
      project.roles.some((role) => roleHasPermission(role, 'documents.templates.manage')),
    ) ?? [],
    [workspace],
  );

  const selectedProject = useMemo(
    () => manageableProjects.find((project) => project.projectId === selectedProjectId) ?? null,
    [manageableProjects, selectedProjectId],
  );

  const loadTemplates = useCallback(async (project: WorkspaceProjectSnapshot): Promise<void> => {
    setLoading(true);
    setError('');
    try {
      const items = await apiFetch<DocumentTemplateSnapshot[]>(
        `/v1/tenants/${project.tenantId}/projects/${project.projectId}/document-templates`,
      );
      setTemplates(items);
    } catch (reason) {
      if (reason instanceof ApiError && reason.status === 401) {
        window.location.replace('/login');
        return;
      }
      setError(reason instanceof Error ? reason.message : 'Unable to load document templates.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void apiFetch<WorkspaceContextSnapshot>('/v1/me/workspace')
      .then((context) => {
        if (cancelled) return;
        setWorkspace(context);
        const projects = context.projects.filter((project) =>
          project.roles.some((role) => roleHasPermission(role, 'documents.templates.manage')),
        );
        const stored = window.localStorage.getItem(projectStorageKey);
        const initial = projects.find((project) => project.projectId === stored) ?? projects[0] ?? null;
        setSelectedProjectId(initial?.projectId ?? '');
        if (!initial) setLoading(false);
      })
      .catch((reason) => {
        if (cancelled) return;
        if (reason instanceof ApiError && reason.status === 401) {
          window.location.replace('/login');
          return;
        }
        setError(reason instanceof Error ? reason.message : 'Unable to load your workspace.');
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!selectedProject) return;
    window.localStorage.setItem(projectStorageKey, selectedProject.projectId);
    void loadTemplates(selectedProject);
  }, [selectedProject, loadTemplates]);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!selectedProject || !file || busy) return;

    const normalizedCode = code.trim();
    const normalizedName = name.trim();
    setError('');
    setSuccess('');

    if (!normalizedCode || !normalizedName) {
      setError('Enter a template code and display name.');
      return;
    }
    if (requiresSignature && selectedSigners.length === 0) {
      setError('Select at least one required signer for a signature-enabled template.');
      return;
    }
    if (file.size < 1 || file.size > maxBytes) {
      setError('Choose a file between 1 byte and 25 MB.');
      return;
    }
    const mimeType = supportedMimeType(file);
    if (!mimeType) {
      setError('Supported formats are PDF, JPEG, PNG and DOCX.');
      return;
    }

    setBusy(true);
    try {
      setStage('Calculating SHA-256 integrity digest…');
      const sha256Base64 = await digestSha256Base64(file);
      const descriptor = {
        filename: file.name,
        mimeType,
        byteSize: file.size,
        sha256Base64,
      } as const;

      setStage('Requesting protected template storage…');
      const intent = await apiFetch<UploadIntentResponse>(
        `/v1/tenants/${selectedProject.tenantId}/document-templates/upload-intent`,
        {
          method: 'POST',
          body: JSON.stringify({
            projectId: selectedProject.projectId,
            code: normalizedCode,
            file: descriptor,
          }),
        },
      );

      setStage('Uploading directly to protected object storage…');
      const upload = await fetch(intent.uploadUrl, {
        method: 'PUT',
        headers: intent.requiredHeaders,
        body: file,
      });
      if (!upload.ok) {
        throw new Error(`Object storage rejected the upload (${upload.status}). Check storage CORS and signed-header configuration.`);
      }

      setStage('Verifying bytes and activating the new template version…');
      const result = await apiFetch<{ templateId: string; versionNumber: number }>(
        `/v1/tenants/${selectedProject.tenantId}/document-templates`,
        {
          method: 'POST',
          body: JSON.stringify({
            projectId: selectedProject.projectId,
            code: normalizedCode,
            name: normalizedName,
            category,
            objectKey: intent.objectKey,
            file: descriptor,
            requiresSignature,
            signerRequirements: requiresSignature
              ? selectedSigners.map((signerRole, index) => ({
                  signerRole,
                  signingOrder: index + 1,
                  required: true,
                }))
              : [],
          }),
        },
      );

      setSuccess(`Version ${result.versionNumber} of ${normalizedCode} is active. The previous active version, if any, was retired atomically.`);
      setStage('');
      setFile(null);
      const input = document.getElementById('template-file') as HTMLInputElement | null;
      if (input) input.value = '';
      await loadTemplates(selectedProject);
    } catch (reason) {
      if (reason instanceof ApiError && reason.status === 401) {
        window.location.replace('/login');
        return;
      }
      setStage('');
      setError(reason instanceof Error ? reason.message : 'Unable to publish the template version.');
    } finally {
      setBusy(false);
    }
  }

  if (!workspace && loading) {
    return (
      <main className={styles.statePage}>
        <div className={styles.loadingMark}>P</div>
        <p>Loading document template inventory…</p>
      </main>
    );
  }

  if (manageableProjects.length === 0) {
    return (
      <main className={styles.statePage}>
        <section className={styles.stateCard}>
          <span className={styles.eyebrow}>Configuration restricted</span>
          <h1>Document template administration is not available for your role.</h1>
          <p>This surface requires the document-template management capability.</p>
          <a href="/workspace">Return to workspace</a>
        </section>
      </main>
    );
  }

  if (!selectedProject) return null;

  const activeProjectTemplates = templates.filter((item) => item.scope === 'PROJECT' && item.status === 'ACTIVE');
  const tenantDefaults = templates.filter((item) => item.scope === 'TENANT_DEFAULT' && item.status === 'ACTIVE');
  const versionCount = templates.filter((item) => item.scope === 'PROJECT').length;
  const groups = groupTemplates(templates);

  return (
    <main className={styles.page}>
      <header className={styles.topbar}>
        <div className={styles.brandLine}>
          <a href="/workspace" className={styles.backButton} aria-label="Back to workspace">←</a>
          <div className={styles.brandMark}>P</div>
          <div>
            <strong>PRENEURA</strong>
            <span>Document template administration</span>
          </div>
        </div>
        <div className={styles.projectPicker}>
          <label htmlFor="template-project">Project</label>
          <select
            id="template-project"
            value={selectedProject.projectId}
            onChange={(event) => setSelectedProjectId(event.target.value)}
          >
            {manageableProjects.map((project) => (
              <option key={project.projectId} value={project.projectId}>
                {project.projectName} · {project.tenantName}
              </option>
            ))}
          </select>
        </div>
      </header>

      <div className={styles.content}>
        <section className={styles.hero}>
          <div>
            <span className={styles.eyebrow}>Verified document source</span>
            <h1>Document templates</h1>
            <p>
              Publish project-specific template versions through the same SHA-256 verified object-storage path used by production transaction documents. Publishing a new version retires the previous active version for the same project/code atomically.
            </p>
          </div>
          <div className={styles.metrics}>
            <Metric label="Project active" value={String(activeProjectTemplates.length)} />
            <Metric label="Tenant defaults" value={String(tenantDefaults.length)} />
            <Metric label="Project versions" value={String(versionCount)} />
          </div>
        </section>

        {error ? <div className={styles.error}>{error}</div> : null}
        {success ? <div className={styles.success}>{success}</div> : null}

        <section className={styles.layout}>
          <form className={styles.publishPanel} onSubmit={submit}>
            <div className={styles.panelHeading}>
              <div>
                <span className={styles.eyebrow}>New project version</span>
                <h2>Publish template</h2>
                <p>Project scope only. Tenant defaults are visible below but are not mutated from this surface.</p>
              </div>
            </div>

            <div className={styles.fieldGrid}>
              <label>
                Template code
                <input value={code} onChange={(event) => setCode(event.target.value)} maxLength={80} placeholder="SALE_CONTRACT" disabled={busy} required />
              </label>
              <label>
                Display name
                <input value={name} onChange={(event) => setName(event.target.value)} maxLength={180} placeholder="Standard sale contract" disabled={busy} required />
              </label>
              <label>
                Category
                <select value={category} onChange={(event) => setCategory(event.target.value as DocumentCategory)} disabled={busy}>
                  {categories.map((item) => <option key={item} value={item}>{formatToken(item)}</option>)}
                </select>
              </label>
              <label>
                Template file
                <input
                  id="template-file"
                  type="file"
                  accept="application/pdf,image/jpeg,image/png,application/vnd.openxmlformats-officedocument.wordprocessingml.document,.pdf,.jpg,.jpeg,.png,.docx"
                  onChange={(event) => setFile(event.target.files?.[0] ?? null)}
                  disabled={busy}
                  required
                />
              </label>
            </div>

            {file ? (
              <div className={styles.fileSummary}>
                <div>
                  <strong>{file.name}</strong>
                  <span>{formatBytes(file.size)} · {supportedMimeType(file) ?? 'Unsupported type'}</span>
                </div>
                <span>{supportedMimeType(file) ? 'Ready' : 'Unsupported'}</span>
              </div>
            ) : null}

            <div className={styles.signatureBox}>
              <label className={styles.signatureToggle}>
                <input
                  type="checkbox"
                  checked={requiresSignature}
                  onChange={(event) => setRequiresSignature(event.target.checked)}
                  disabled={busy}
                />
                <span>
                  <strong>Requires signature workflow</strong>
                  <small>Signer requirements become part of this immutable template version.</small>
                </span>
              </label>
              {requiresSignature ? (
                <div className={styles.signers}>
                  {signerRoles.map((signerRole) => {
                    const selected = selectedSigners.includes(signerRole);
                    const order = selected ? selectedSigners.indexOf(signerRole) + 1 : null;
                    return (
                      <label key={signerRole} className={selected ? styles.signerSelected : ''}>
                        <input
                          type="checkbox"
                          checked={selected}
                          disabled={busy}
                          onChange={(event) => toggleSigner(signerRole, event.target.checked)}
                        />
                        <span>{formatToken(signerRole)}</span>
                        <em>{order ? `Order ${order}` : 'Not required'}</em>
                      </label>
                    );
                  })}
                </div>
              ) : null}
            </div>

            {stage ? <div className={styles.stage}>{stage}</div> : null}

            <button type="submit" className={styles.primaryAction} disabled={busy || !file}>
              {busy ? 'Publishing version…' : 'Upload, verify & publish'}
            </button>
          </form>

          <aside className={styles.integrityPanel}>
            <span className={styles.eyebrow}>Version semantics</span>
            <h2>Safe activation</h2>
            <ol>
              <li><strong>Hash locally.</strong><span>The browser calculates SHA-256 before upload.</span></li>
              <li><strong>Upload direct.</strong><span>Bytes go to short-lived protected object storage, not through the application server.</span></li>
              <li><strong>Verify server-side.</strong><span>Stored size, MIME type and digest must match before a template row is created.</span></li>
              <li><strong>Activate atomically.</strong><span>The repository retires the prior active version of the same code and activates the new version in one database transaction.</span></li>
            </ol>
          </aside>
        </section>

        <section className={styles.inventoryPanel}>
          <div className={styles.panelHeading}>
            <div>
              <span className={styles.eyebrow}>Effective inventory</span>
              <h2>Template versions</h2>
              <p>Project versions and inherited tenant defaults are shown separately so the effective source is explicit.</p>
            </div>
          </div>

          {loading ? <Skeleton /> : groups.length === 0 ? (
            <div className={styles.empty}>No project or tenant-default templates are configured yet.</div>
          ) : (
            <div className={styles.groups}>
              {groups.map((group) => (
                <article className={styles.group} key={group.key}>
                  <div className={styles.groupHeading}>
                    <div>
                      <span className={styles.code}>{group.code}</span>
                      <h3>{group.items[0]?.name ?? group.code}</h3>
                    </div>
                    <span>{formatToken(group.items[0]?.category ?? 'OTHER')}</span>
                  </div>
                  <div className={styles.versionList}>
                    {group.items.map((template) => (
                      <div className={styles.versionRow} key={template.templateId}>
                        <div className={styles.versionIdentity}>
                          <strong>v{template.versionNumber}</strong>
                          <span className={template.scope === 'PROJECT' ? styles.projectScope : styles.tenantScope}>
                            {template.scope === 'PROJECT' ? 'Project' : 'Tenant default'}
                          </span>
                          <span className={template.status === 'ACTIVE' ? styles.activeStatus : styles.retiredStatus}>
                            {formatToken(template.status)}
                          </span>
                        </div>
                        <div className={styles.versionMeta}>
                          <span>{template.mimeType}</span>
                          <span>{template.requiresSignature ? 'Signature workflow' : 'No signature workflow'}</span>
                          <span>{template.activatedAt ? `Activated ${formatDateTime(template.activatedAt)}` : `Created ${formatDateTime(template.createdAt)}`}</span>
                        </div>
                        <div className={styles.signerChips}>
                          {template.signerRequirements.length > 0 ? template.signerRequirements.map((requirement) => (
                            <span key={`${template.templateId}:${requirement.signerRole}`}>
                              {requirement.signingOrder}. {formatToken(requirement.signerRole)}{requirement.required ? '' : ' optional'}
                            </span>
                          )) : <span>No required signers</span>}
                        </div>
                      </div>
                    ))}
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );

  function toggleSigner(signerRole: SignerRole, checked: boolean): void {
    setSelectedSigners((current) => {
      if (checked) return current.includes(signerRole) ? current : [...current, signerRole];
      return current.filter((item) => item !== signerRole);
    });
  }
}

function groupTemplates(templates: DocumentTemplateSnapshot[]): Array<{
  key: string;
  code: string;
  items: DocumentTemplateSnapshot[];
}> {
  const map = new Map<string, DocumentTemplateSnapshot[]>();
  for (const template of templates) {
    const key = template.code;
    map.set(key, [...(map.get(key) ?? []), template]);
  }
  return [...map.entries()]
    .map(([key, items]) => ({
      key,
      code: key,
      items: items.slice().sort((a, b) => {
        if (a.scope !== b.scope) return a.scope === 'PROJECT' ? -1 : 1;
        return b.versionNumber - a.versionNumber;
      }),
    }))
    .sort((a, b) => a.code.localeCompare(b.code));
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.metric}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function Skeleton() {
  return (
    <div className={styles.skeleton} aria-label="Loading templates">
      {[0, 1, 2].map((item) => <span key={item} />)}
    </div>
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

function formatToken(value: string): string {
  return value.toLowerCase().split('_').map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ');
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}
