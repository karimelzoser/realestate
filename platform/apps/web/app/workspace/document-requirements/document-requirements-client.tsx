'use client';

import {
  roleHasPermission,
  type WorkspaceContextSnapshot,
  type WorkspaceProjectSnapshot,
} from '@preneura/contracts/access';
import type {
  DocumentCategory,
  ProjectDocumentRequirementSnapshot,
} from '@preneura/contracts/documents';
import type { TransactionListItemSnapshot } from '@preneura/contracts/sales';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ApiError, apiFetch } from '../../../lib/api';
import styles from './document-requirements.module.css';

const projectStorageKey = 'preneura:selected-project';

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

type Draft = {
  enabled: boolean;
  requiredCount: number;
  requiredForCompletion: boolean;
};

const categoryDescriptions: Readonly<Record<DocumentCategory, string>> = {
  BUYER_ID: 'National ID or equivalent buyer identity evidence.',
  PASSPORT: 'Passport copy when the buyer identity process requires it.',
  ADDRESS_PROOF: 'Utility bill, residence certificate, or approved address evidence.',
  PAYMENT_RECEIPT: 'Verified payment receipt documents linked to the transaction file.',
  CHEQUE: 'Cheque evidence documents retained with the transaction record.',
  CONTRACT: 'Executed sale or reservation contract document.',
  STAMPED_CONTRACT: 'Officially stamped or registered contract artifact.',
  OTHER: 'Project-specific supporting document not covered by a standard category.',
};

export default function DocumentRequirementsClient() {
  const [workspace, setWorkspace] = useState<WorkspaceContextSnapshot | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [requirements, setRequirements] = useState<ProjectDocumentRequirementSnapshot[]>([]);
  const [drafts, setDrafts] = useState<Record<DocumentCategory, Draft>>(() => buildDrafts([]));
  const [transactionCount, setTransactionCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyCategory, setBusyCategory] = useState<DocumentCategory | ''>('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

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

  const loadProject = useCallback(async (project: WorkspaceProjectSnapshot): Promise<void> => {
    setLoading(true);
    setError('');
    setSuccess('');
    try {
      const base = `/v1/tenants/${project.tenantId}/projects/${project.projectId}`;
      const [nextRequirements, transactions] = await Promise.all([
        apiFetch<ProjectDocumentRequirementSnapshot[]>(`${base}/document-requirements`),
        apiFetch<TransactionListItemSnapshot[]>(`${base}/transactions`),
      ]);
      setRequirements(nextRequirements);
      setDrafts(buildDrafts(nextRequirements));
      setTransactionCount(transactions.length);
    } catch (reason) {
      if (reason instanceof ApiError && reason.status === 401) {
        window.location.replace('/login');
        return;
      }
      setError(reason instanceof Error ? reason.message : 'Unable to load document requirements.');
      setTransactionCount(null);
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
    void loadProject(selectedProject);
  }, [selectedProject, loadProject]);

  async function saveCategory(category: DocumentCategory): Promise<void> {
    if (!selectedProject || transactionCount === null || transactionCount > 0) return;
    const draft = drafts[category];
    const existing = requirements.find((item) => item.category === category) ?? null;
    setBusyCategory(category);
    setError('');
    setSuccess('');
    const base = `/v1/tenants/${selectedProject.tenantId}/projects/${selectedProject.projectId}/document-requirements`;

    try {
      if (!draft.enabled) {
        if (existing) {
          await apiFetch<{ removed: true }>(`${base}/${category}`, { method: 'DELETE' });
          setRequirements((current) => current.filter((item) => item.category !== category));
        }
        setSuccess(`${label(category)} is not required for this project.`);
        return;
      }

      const saved = await apiFetch<ProjectDocumentRequirementSnapshot>(`${base}/${category}`, {
        method: 'PUT',
        body: JSON.stringify({
          requiredCount: Math.max(1, Math.min(20, Math.trunc(draft.requiredCount))),
          requiredForCompletion: draft.requiredForCompletion,
        }),
      });
      setRequirements((current) => [
        ...current.filter((item) => item.category !== category),
        saved,
      ].sort((a, b) => a.category.localeCompare(b.category)));
      setDrafts((current) => ({
        ...current,
        [category]: {
          enabled: true,
          requiredCount: saved.requiredCount,
          requiredForCompletion: saved.requiredForCompletion,
        },
      }));
      setSuccess(`${label(category)} requirement saved.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to save the document requirement.');
      if (reason instanceof ApiError && reason.status === 409) {
        await loadProject(selectedProject);
      }
    } finally {
      setBusyCategory('');
    }
  }

  if (!workspace && loading) {
    return (
      <main className={styles.statePage}>
        <div className={styles.loadingMark}>P</div>
        <p>Loading project document policy…</p>
      </main>
    );
  }

  if (manageableProjects.length === 0) {
    return (
      <main className={styles.statePage}>
        <section className={styles.stateCard}>
          <span className={styles.eyebrow}>Configuration restricted</span>
          <h1>Document requirement management is not available for your role.</h1>
          <p>This surface requires the project document-template management capability.</p>
          <a href="/workspace">Return to workspace</a>
        </section>
      </main>
    );
  }

  if (!selectedProject) return null;

  const locked = transactionCount !== null && transactionCount > 0;
  const configuredCount = requirements.length;
  const completionCount = requirements.filter((item) => item.requiredForCompletion).length;

  return (
    <main className={styles.page}>
      <header className={styles.topbar}>
        <div className={styles.brandLine}>
          <a href="/workspace" className={styles.backButton} aria-label="Back to workspace">←</a>
          <div className={styles.brandMark}>P</div>
          <div>
            <strong>PRENEURA</strong>
            <span>Project document policy</span>
          </div>
        </div>
        <div className={styles.projectPicker}>
          <label htmlFor="requirements-project">Project</label>
          <select
            id="requirements-project"
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
            <span className={styles.eyebrow}>Completion policy</span>
            <h1>Document requirements</h1>
            <p>
              Define which document categories the project expects and which ones must be verified before the buyer-document milestone can complete.
            </p>
          </div>
          <div className={styles.metrics}>
            <Metric label="Configured" value={String(configuredCount)} />
            <Metric label="Completion gates" value={String(completionCount)} />
            <Metric label="Transactions" value={transactionCount === null ? '—' : String(transactionCount)} />
          </div>
        </section>

        {locked ? (
          <section className={styles.lockBanner}>
            <div className={styles.lockIcon}>◆</div>
            <div>
              <strong>Policy locked after transaction activity</strong>
              <p>
                This project already has {transactionCount} transaction{transactionCount === 1 ? '' : 's'}. Requirements remain visible but cannot be changed because the current schema is not versioned. This prevents retroactive completion-policy changes.
              </p>
            </div>
          </section>
        ) : (
          <section className={styles.infoBanner}>
            <strong>Configure before sales activity begins.</strong>
            <span>The policy becomes immutable when the first project transaction is created.</span>
          </section>
        )}

        {error ? <div className={styles.error}>{error}</div> : null}
        {success ? <div className={styles.success}>{success}</div> : null}

        <section className={styles.panel}>
          <div className={styles.panelHeading}>
            <div>
              <span className={styles.eyebrow}>Project · {selectedProject.projectCode}</span>
              <h2>{selectedProject.projectName}</h2>
            </div>
            <div className={styles.policyStatus}>{locked ? 'LOCKED' : 'CONFIGURABLE'}</div>
          </div>

          {loading ? <Skeleton /> : (
            <div className={styles.requirementGrid}>
              {categories.map((category) => {
                const draft = drafts[category];
                const existing = requirements.find((item) => item.category === category) ?? null;
                const saving = busyCategory === category;
                return (
                  <article className={`${styles.requirementCard} ${draft.enabled ? styles.enabledCard : ''}`} key={category}>
                    <div className={styles.cardTop}>
                      <div>
                        <span className={styles.categoryCode}>{category}</span>
                        <h3>{label(category)}</h3>
                      </div>
                      <label className={styles.switch}>
                        <input
                          type="checkbox"
                          checked={draft.enabled}
                          disabled={locked || Boolean(busyCategory)}
                          onChange={(event) => updateDraft(category, { enabled: event.target.checked })}
                        />
                        <span />
                      </label>
                    </div>
                    <p>{categoryDescriptions[category]}</p>

                    <div className={styles.controls}>
                      <label>
                        Required count
                        <input
                          type="number"
                          min={1}
                          max={20}
                          value={draft.requiredCount}
                          disabled={!draft.enabled || locked || Boolean(busyCategory)}
                          onChange={(event) => updateDraft(category, {
                            requiredCount: Math.max(1, Math.min(20, Number(event.target.value) || 1)),
                          })}
                        />
                      </label>
                      <label className={styles.completionToggle}>
                        <input
                          type="checkbox"
                          checked={draft.requiredForCompletion}
                          disabled={!draft.enabled || locked || Boolean(busyCategory)}
                          onChange={(event) => updateDraft(category, { requiredForCompletion: event.target.checked })}
                        />
                        Required to complete buyer documents
                      </label>
                    </div>

                    <div className={styles.cardFoot}>
                      <div>
                        <strong>{existing ? 'Saved policy' : 'Not configured'}</strong>
                        <span>{existing ? `Updated ${formatDateTime(existing.updatedAt)}` : 'No active project requirement'}</span>
                      </div>
                      {!locked ? (
                        <button
                          type="button"
                          disabled={Boolean(busyCategory)}
                          onClick={() => void saveCategory(category)}
                        >
                          {saving ? 'Saving…' : draft.enabled ? 'Save requirement' : existing ? 'Remove requirement' : 'Keep optional'}
                        </button>
                      ) : null}
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>

        <section className={styles.notePanel}>
          <div>
            <span className={styles.eyebrow}>Runtime behavior</span>
            <h2>How this policy affects transactions</h2>
          </div>
          <p>
            A category marked as a completion gate contributes to the <strong>Buyer documents complete</strong> milestone. The milestone can complete only after the configured number of documents in every gated category reaches a verified, signed, or stamped state. Categories that are enabled but not marked for completion remain operational requirements without blocking that milestone.
          </p>
        </section>
      </div>
    </main>
  );

  function updateDraft(category: DocumentCategory, patch: Partial<Draft>): void {
    setDrafts((current) => ({
      ...current,
      [category]: { ...current[category], ...patch },
    }));
  }
}

function buildDrafts(requirements: ProjectDocumentRequirementSnapshot[]): Record<DocumentCategory, Draft> {
  return categories.reduce((result, category) => {
    const existing = requirements.find((item) => item.category === category);
    result[category] = {
      enabled: Boolean(existing),
      requiredCount: existing?.requiredCount ?? 1,
      requiredForCompletion: existing?.requiredForCompletion ?? true,
    };
    return result;
  }, {} as Record<DocumentCategory, Draft>);
}

function Metric({ label: metricLabel, value }: { label: string; value: string }) {
  return (
    <div className={styles.metric}>
      <span>{metricLabel}</span>
      <strong>{value}</strong>
    </div>
  );
}

function Skeleton() {
  return (
    <div className={styles.skeletonGrid} aria-label="Loading document requirements">
      {categories.map((category) => <span key={category} />)}
    </div>
  );
}

function label(category: DocumentCategory): string {
  return category.toLowerCase().split('_').map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ');
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
