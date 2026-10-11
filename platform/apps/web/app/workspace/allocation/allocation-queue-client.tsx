'use client';

import {
  roleHasPermission,
  type WorkspaceContextSnapshot,
  type WorkspaceProjectSnapshot,
} from '@preneura/contracts/access';
import type { QueueEntrySnapshot } from '@preneura/contracts/sales';
import { useEffect, useMemo, useState } from 'react';
import { ApiError, apiFetch } from '../../../lib/api';
import styles from './allocation-queue.module.css';

const projectStorageKey = 'preneura:selected-project';

export default function AllocationQueueClient() {
  const [workspace, setWorkspace] = useState<WorkspaceContextSnapshot | null>(null);
  const [projectId, setProjectId] = useState('');
  const [queue, setQueue] = useState<QueueEntrySnapshot[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const eligibleProjects = useMemo(
    () => workspace?.projects.filter((project) => canAllocate(project)) ?? [],
    [workspace],
  );
  const project = eligibleProjects.find((item) => item.projectId === projectId) ?? null;

  useEffect(() => {
    let cancelled = false;
    void apiFetch<WorkspaceContextSnapshot>('/v1/me/workspace')
      .then((context) => {
        if (cancelled) return;
        const projects = context.projects.filter(canAllocate);
        if (projects.length === 0) {
          setError('Your current access does not include exact apartment allocation.');
          setWorkspace(context);
          setLoading(false);
          return;
        }
        setWorkspace(context);
        const stored = window.localStorage.getItem(projectStorageKey);
        setProjectId(projects.some((item) => item.projectId === stored) ? stored! : projects[0]!.projectId);
      })
      .catch((cause) => {
        if (cause instanceof ApiError && cause.status === 401) {
          window.location.replace('/login');
          return;
        }
        setError(cause instanceof Error ? cause.message : 'Unable to load allocation access.');
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!project) return;
    window.localStorage.setItem(projectStorageKey, project.projectId);
    setLoading(true);
    setError('');
    void apiFetch<QueueEntrySnapshot[]>(
      `/v1/tenants/${project.tenantId}/projects/${project.projectId}/queue`,
    )
      .then(setQueue)
      .catch((cause) => {
        if (cause instanceof ApiError && cause.status === 401) {
          window.location.replace('/login');
          return;
        }
        setError(cause instanceof Error ? cause.message : 'Unable to load the allocation queue.');
      })
      .finally(() => setLoading(false));
  }, [project]);

  const actionable = queue.filter((entry) => entry.status === 'CALLED' || entry.status === 'LOCKED');

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <a href="/workspace" className={styles.back}>← Project workspace</a>
          <span className={styles.eyebrow}>Allocation control</span>
          <h1>Exact apartment allocation</h1>
          <p>EOI determines the apartment type. Only called buyers can proceed to a specific physical apartment lock.</p>
        </div>
        {eligibleProjects.length > 0 ? (
          <label className={styles.projectPicker}>
            <span>Project</span>
            <select value={projectId} onChange={(event) => setProjectId(event.target.value)}>
              {eligibleProjects.map((item) => (
                <option value={item.projectId} key={item.projectId}>{item.projectName}</option>
              ))}
            </select>
          </label>
        ) : null}
      </header>

      {error ? <div className={styles.error}>{error}</div> : null}

      <section className={styles.panel}>
        <div className={styles.panelHeader}>
          <div>
            <span className={styles.eyebrow}>Ready for selection</span>
            <h2>Called buyers</h2>
          </div>
          {project ? <span className={styles.count}>{actionable.length}</span> : null}
        </div>

        {loading ? <div className={styles.loading}>Loading queue…</div> : null}
        {!loading && actionable.length === 0 ? (
          <div className={styles.empty}>
            <strong>No called buyers are awaiting exact allocation.</strong>
            <span>Use the queue workflow to call the next eligible buyer.</span>
          </div>
        ) : null}

        {!loading && project && actionable.length > 0 ? (
          <div className={styles.rows}>
            {actionable.map((entry, index) => {
              const href = `/workspace/allocation/${entry.queueEntryId}?tenantId=${encodeURIComponent(project.tenantId)}&projectId=${encodeURIComponent(project.projectId)}`;
              return (
                <article className={styles.row} key={entry.queueEntryId}>
                  <div className={styles.position}>{index + 1}</div>
                  <div className={styles.rowMain}>
                    <strong>Buyer {shortId(entry.buyerProfileId)}</strong>
                    <span>{humanize(entry.channel)} · checked in {formatDateTime(entry.checkedInAt)}</span>
                  </div>
                  <div className={styles.priority}>
                    <strong>{humanize(entry.priorityGroup)}</strong>
                    <span>score {entry.priorityScore}</span>
                  </div>
                  <span className={`${styles.status} ${entry.status === 'LOCKED' ? styles.locked : ''}`}>
                    {humanize(entry.status)}
                  </span>
                  <a className={styles.allocate} href={href}>
                    {entry.status === 'LOCKED' ? 'Continue allocation' : 'Choose apartment'}
                  </a>
                </article>
              );
            })}
          </div>
        ) : null}
      </section>
    </main>
  );
}

function canAllocate(project: WorkspaceProjectSnapshot): boolean {
  const assist = project.roles.some((role) => roleHasPermission(role, 'allocation.assist'));
  const lock = project.roles.some((role) => roleHasPermission(role, 'unit.lock'));
  const queue = project.roles.some((role) => roleHasPermission(role, 'queue.read'));
  return assist && lock && queue;
}

function shortId(value: string): string {
  return value.length > 12 ? `${value.slice(0, 6)}…${value.slice(-4)}` : value;
}

function humanize(value: string): string {
  return value.toLowerCase().split('_').map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ');
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat('en-EG', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
  }).format(new Date(value));
}
