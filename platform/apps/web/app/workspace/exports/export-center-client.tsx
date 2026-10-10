'use client';

import type { WorkspaceContextSnapshot, WorkspaceProjectSnapshot } from '@preneura/contracts/access';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ApiError, apiBase, apiFetch } from '../../../lib/api';
import styles from './export-center.module.css';

interface ExportDescriptor {
  dataset: string;
  label: string;
}

export default function ExportCenterClient() {
  const [workspace, setWorkspace] = useState<WorkspaceContextSnapshot | null>(null);
  const [projectId, setProjectId] = useState('');
  const [datasets, setDatasets] = useState<ExportDescriptor[]>([]);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const projects = workspace?.projects ?? [];
  const project = useMemo(
    () => projects.find((candidate) => candidate.projectId === projectId) ?? null,
    [projects, projectId],
  );

  useEffect(() => {
    let cancelled = false;
    void apiFetch<WorkspaceContextSnapshot>('/v1/me/workspace')
      .then((context) => {
        if (cancelled) return;
        if (context.projects.length === 0) {
          setError('Your account does not have an operational project workspace.');
          setLoading(false);
          return;
        }
        setWorkspace(context);
        const stored = window.localStorage.getItem('preneura:selected-project');
        const selected = context.projects.find((candidate) => candidate.projectId === stored) ?? context.projects[0]!;
        setProjectId(selected.projectId);
      })
      .catch((reason: unknown) => {
        if (reason instanceof ApiError && reason.status === 401) {
          window.location.replace('/login');
          return;
        }
        setError(reason instanceof Error ? reason.message : 'Unable to load workspace.');
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  const loadDatasets = useCallback(async (selectedProject: WorkspaceProjectSnapshot): Promise<void> => {
    setLoading(true);
    setError('');
    setMessage('');
    try {
      const result = await apiFetch<ExportDescriptor[]>(
        `/v1/tenants/${selectedProject.tenantId}/projects/${selectedProject.projectId}/exports`,
      );
      setDatasets(result);
    } catch (reason: unknown) {
      setDatasets([]);
      setError(reason instanceof Error ? reason.message : 'Unable to load available exports.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!project) return;
    window.localStorage.setItem('preneura:selected-project', project.projectId);
    void loadDatasets(project);
  }, [project, loadDatasets]);

  async function download(dataset: ExportDescriptor): Promise<void> {
    if (!project || downloading) return;
    setDownloading(dataset.dataset);
    setError('');
    setMessage('');
    try {
      const response = await fetch(
        `${apiBase}/v1/tenants/${project.tenantId}/projects/${project.projectId}/exports/${encodeURIComponent(dataset.dataset)}`,
        { credentials: 'include' },
      );
      if (!response.ok) {
        let reason = `Export failed (${response.status}).`;
        try {
          const payload = await response.json() as { message?: string | string[] };
          if (Array.isArray(payload.message)) reason = payload.message.join(' ');
          else if (typeof payload.message === 'string') reason = payload.message;
        } catch { /* status fallback */ }
        throw new Error(reason);
      }
      const blob = await response.blob();
      const disposition = response.headers.get('content-disposition') ?? '';
      const filename = disposition.match(/filename="([^"]+)"/)?.[1] ?? `preneura-${dataset.dataset}.csv`;
      const href = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = href;
      anchor.download = filename;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(href);
      const count = response.headers.get('x-export-row-count');
      setMessage(`${dataset.label} exported${count ? ` (${count} rows)` : ''}.`);
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : 'Unable to download export.');
    } finally {
      setDownloading(null);
    }
  }

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <a className={styles.back} href="/workspace">← Workspace</a>
          <p className={styles.eyebrow}>PRENEURA · governed data access</p>
          <h1>Export Center</h1>
          <p>Download permission-scoped CSV snapshots. Hidden fields remain hidden in the file itself.</p>
        </div>
        <label className={styles.projectPicker}>
          Project
          <select value={projectId} onChange={(event) => setProjectId(event.target.value)} disabled={projects.length < 2}>
            {projects.map((candidate) => <option key={candidate.projectId} value={candidate.projectId}>{candidate.projectName}</option>)}
          </select>
        </label>
      </header>

      {error ? <div className={styles.error} role="alert">{error}</div> : null}
      {message ? <div className={styles.success}>{message}</div> : null}

      <section className={styles.notice}>
        <strong>Server-authoritative export</strong>
        <span>Broker/buyer scopes and commission redaction are applied before rows are generated. Spreadsheet-formula cells are neutralized.</span>
      </section>

      {loading ? <p className={styles.loading}>Loading authorized datasets…</p> : null}
      {!loading && datasets.length === 0 && !error ? <p className={styles.empty}>No exportable datasets are available for this role in the selected project.</p> : null}

      <section className={styles.grid} aria-label="Available exports">
        {datasets.map((dataset) => (
          <article className={styles.card} key={dataset.dataset}>
            <div>
              <span className={styles.code}>{dataset.dataset}</span>
              <h2>{dataset.label}</h2>
              <p>UTF-8 CSV · current authorized project snapshot</p>
            </div>
            <button type="button" onClick={() => void download(dataset)} disabled={Boolean(downloading)}>
              {downloading === dataset.dataset ? 'Preparing…' : 'Download CSV'}
            </button>
          </article>
        ))}
      </section>
    </main>
  );
}
