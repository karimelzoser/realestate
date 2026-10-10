'use client';

import {
  roleHasPermission,
  type WorkspaceContextSnapshot,
  type WorkspaceProjectSnapshot,
} from '@preneura/contracts/access';
import type {
  TransactionOperationBucket,
  TransactionOperationQueueSnapshot,
} from '@preneura/contracts/transaction-operations';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ApiError, apiFetch } from '../../lib/api';
import styles from './transaction-operations.module.css';

const BUCKETS: readonly TransactionOperationBucket[] = [
  'NEEDS_DOCUMENTS',
  'NEEDS_PAYMENT',
  'NEEDS_CHEQUES',
  'NEEDS_CONTRACT',
  'NEEDS_BUYER_SIGNATURE',
  'NEEDS_COMPANY_EXECUTION',
  'READY_TO_COMPLETE',
];

export default function TransactionOperationsClient() {
  const [workspace, setWorkspace] = useState<WorkspaceContextSnapshot | null>(null);
  const [projectId, setProjectId] = useState('');
  const [snapshot, setSnapshot] = useState<TransactionOperationQueueSnapshot | null>(null);
  const [filter, setFilter] = useState<TransactionOperationBucket | 'ALL'>('ALL');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const projects = useMemo(
    () => workspace?.projects.filter((project) =>
      project.roles.some((role) => roleHasPermission(role, 'transaction.manage')),
    ) ?? [],
    [workspace],
  );
  const project = projects.find((item) => item.projectId === projectId) ?? null;

  const loadQueue = useCallback(async (selected: WorkspaceProjectSnapshot) => {
    setLoading(true);
    setError('');
    try {
      const next = await apiFetch<TransactionOperationQueueSnapshot>(
        `/v1/tenants/${selected.tenantId}/projects/${selected.projectId}/transaction-operations`,
      );
      setSnapshot(next);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to load transaction operations.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void apiFetch<WorkspaceContextSnapshot>('/v1/me/workspace')
      .then((context) => {
        if (cancelled) return;
        const allowed = context.projects.filter((candidate) =>
          candidate.roles.some((role) => roleHasPermission(role, 'transaction.manage')),
        );
        if (allowed.length === 0) {
          setError('No transaction-management role is assigned to this account.');
          setLoading(false);
          return;
        }
        setWorkspace(context);
        const stored = window.localStorage.getItem('preneura:selected-project');
        setProjectId(allowed.find((item) => item.projectId === stored)?.projectId ?? allowed[0]!.projectId);
      })
      .catch((reason) => {
        if (reason instanceof ApiError && reason.status === 401) {
          window.location.replace('/login');
          return;
        }
        setError(reason instanceof Error ? reason.message : 'Unable to load workspace context.');
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!project) return;
    window.localStorage.setItem('preneura:selected-project', project.projectId);
    void loadQueue(project);
  }, [project, loadQueue]);

  const items = useMemo(
    () => snapshot?.items.filter((item) => filter === 'ALL' || item.bucket === filter) ?? [],
    [snapshot, filter],
  );

  const urgentCount = (snapshot?.counts.NEEDS_PAYMENT ?? 0) +
    (snapshot?.counts.NEEDS_CHEQUES ?? 0) +
    (snapshot?.counts.NEEDS_COMPANY_EXECUTION ?? 0);

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <a href="/workspace" className={styles.back}>← Workspace</a>
          <p className={styles.eyebrow}>TRANSACTION OPERATIONS</p>
          <h1>Completion queue</h1>
          <p>Resume incomplete buyer transactions from authoritative milestone, document, payment, cheque and contract state.</p>
        </div>
        <div className={styles.controls}>
          {projects.length > 1 ? (
            <select value={projectId} onChange={(event) => setProjectId(event.target.value)}>
              {projects.map((item) => <option key={item.projectId} value={item.projectId}>{item.projectName}</option>)}
            </select>
          ) : null}
          <button onClick={() => project && void loadQueue(project)} disabled={!project || loading}>Refresh</button>
        </div>
      </header>

      {error ? <div className={styles.error}>{error}</div> : null}
      {loading ? <div className={styles.loading}>Loading completion queue…</div> : null}

      {!loading && snapshot ? (
        <>
          <section className={styles.metrics}>
            <Metric label="Open transactions" value={snapshot.items.length} />
            <Metric label="Documents" value={snapshot.counts.NEEDS_DOCUMENTS} />
            <Metric label="Financial / execution" value={urgentCount} />
            <Metric label="Ready to complete" value={snapshot.counts.READY_TO_COMPLETE} />
          </section>

          <section className={styles.filters} aria-label="Transaction queue filters">
            <button className={filter === 'ALL' ? styles.activeFilter : undefined} onClick={() => setFilter('ALL')}>
              All <span>{snapshot.items.length}</span>
            </button>
            {BUCKETS.map((bucket) => (
              <button key={bucket} className={filter === bucket ? styles.activeFilter : undefined} onClick={() => setFilter(bucket)}>
                {bucketLabel(bucket)} <span>{snapshot.counts[bucket]}</span>
              </button>
            ))}
          </section>

          <section className={styles.panel}>
            <div className={styles.panelHead}>
              <div>
                <p className={styles.eyebrow}>SERVER-AUTHORITATIVE BACKLOG</p>
                <h2>{filter === 'ALL' ? 'All incomplete transactions' : bucketLabel(filter)}</h2>
              </div>
              <small>Snapshot {new Date(snapshot.generatedAt).toLocaleString()}</small>
            </div>

            <div className={styles.tableWrap}>
              <table>
                <thead>
                  <tr>
                    <th>Buyer</th>
                    <th>Unit</th>
                    <th>Age</th>
                    <th>Completion</th>
                    <th>Queue</th>
                    <th>Next action</th>
                    <th>Pending</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <tr key={item.transactionId}>
                      <td>
                        <strong>{item.buyerDisplayName}</strong>
                        <small>{item.transactionStatus.replaceAll('_', ' ')}</small>
                      </td>
                      <td>{item.unitTypeName}<small>{item.unitTypeCode}</small></td>
                      <td>{ageLabel(item.ageHours)}</td>
                      <td>
                        <div className={styles.progress}><span style={{ width: `${Math.min(100, Math.max(0, Number(item.completionPercent)))}%` }} /></div>
                        <small>{Number(item.completionPercent).toFixed(0)}%</small>
                      </td>
                      <td><span className={`${styles.bucket} ${bucketClassName(item.bucket)}`}>{bucketLabel(item.bucket)}</span></td>
                      <td className={styles.nextAction}>{item.nextAction}</td>
                      <td>
                        <strong>{item.pendingMilestoneCount}</strong>
                        {item.missingRequiredSignerRoles.length > 0 ? <small>Missing: {item.missingRequiredSignerRoles.join(', ')}</small> : null}
                      </td>
                      <td>
                        <a className={styles.open} href={`/workspace/transactions/${item.transactionId}?tenantId=${project?.tenantId ?? ''}&projectId=${project?.projectId ?? ''}`}>
                          Open
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {items.length === 0 ? <p className={styles.empty}>No transactions are currently in this queue.</p> : null}
            </div>
          </section>
        </>
      ) : null}
    </main>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return <article className={styles.metric}><span>{label}</span><strong>{value}</strong></article>;
}

function bucketLabel(bucket: TransactionOperationBucket): string {
  switch (bucket) {
    case 'NEEDS_DOCUMENTS': return 'Needs documents';
    case 'NEEDS_PAYMENT': return 'Needs payment';
    case 'NEEDS_CHEQUES': return 'Needs cheques';
    case 'NEEDS_CONTRACT': return 'Needs contract';
    case 'NEEDS_BUYER_SIGNATURE': return 'Buyer signature';
    case 'NEEDS_COMPANY_EXECUTION': return 'Company execution';
    case 'READY_TO_COMPLETE': return 'Ready to complete';
  }
}

function bucketClassName(bucket: TransactionOperationBucket): string {
  switch (bucket) {
    case 'READY_TO_COMPLETE': return styles.ready;
    case 'NEEDS_PAYMENT':
    case 'NEEDS_CHEQUES': return styles.financial;
    case 'NEEDS_COMPANY_EXECUTION': return styles.execution;
    default: return styles.pending;
  }
}

function ageLabel(hours: number): string {
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}
