'use client';

import {
  roleHasPermission,
  type PermissionCode,
  type WorkspaceContextSnapshot,
  type WorkspaceProjectSnapshot,
} from '@preneura/contracts/access';
import type { RealtimeSignal } from '@preneura/contracts/realtime';
import type {
  EoiListItemSnapshot,
  EoiRefundQuote,
  EoiRefundRequestSnapshot,
} from '@preneura/contracts/sales';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ApiError, apiFetch, eventStreamUrl } from '../../../lib/api';
import styles from './refunds.module.css';

const projectStorageKey = 'preneura:selected-project';

type ReviewDecision = 'APPROVE' | 'REJECT';

export default function RefundsClient() {
  const [workspace, setWorkspace] = useState<WorkspaceContextSnapshot | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [eois, setEois] = useState<EoiListItemSnapshot[]>([]);
  const [refunds, setRefunds] = useState<EoiRefundRequestSnapshot[]>([]);
  const [quotes, setQuotes] = useState<Record<string, EoiRefundQuote>>({});
  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [liveState, setLiveState] = useState<'connecting' | 'live' | 'reconnecting' | 'offline'>('connecting');

  const projects = useMemo(
    () => workspace?.projects.filter((project) =>
      project.roles.some((role) =>
        roleHasPermission(role, 'refund.read') || roleHasPermission(role, 'refund.request'),
      ),
    ) ?? [],
    [workspace],
  );

  const selectedProject = useMemo(
    () => projects.find((project) => project.projectId === selectedProjectId) ?? null,
    [projects, selectedProjectId],
  );

  const can = useCallback((permission: PermissionCode): boolean => {
    if (!selectedProject) return false;
    return selectedProject.roles.some((role) => roleHasPermission(role, permission));
  }, [selectedProject]);

  useEffect(() => {
    let cancelled = false;
    void apiFetch<WorkspaceContextSnapshot>('/v1/me/workspace')
      .then((context) => {
        if (cancelled) return;
        const eligible = context.projects.filter((project) =>
          project.roles.some((role) =>
            roleHasPermission(role, 'refund.read') || roleHasPermission(role, 'refund.request'),
          ),
        );
        if (eligible.length === 0) {
          setError('Your current roles do not include EOI refund access.');
          setLoading(false);
          return;
        }
        setWorkspace(context);
        const stored = window.localStorage.getItem(projectStorageKey);
        const initial = eligible.some((project) => project.projectId === stored)
          ? stored!
          : eligible[0]!.projectId;
        setSelectedProjectId(initial);
      })
      .catch((reason) => {
        if (reason instanceof ApiError && reason.status === 401) {
          window.location.replace('/login');
          return;
        }
        setError(reason instanceof Error ? reason.message : 'Unable to load refund access.');
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const loadProject = useCallback(async (project: WorkspaceProjectSnapshot, background = false): Promise<void> => {
    if (background) setRefreshing(true);
    else setLoading(true);
    setError('');
    try {
      const [nextEois, nextRefunds] = await Promise.all([
        apiFetch<EoiListItemSnapshot[]>(
          `/v1/tenants/${project.tenantId}/projects/${project.projectId}/eois`,
        ),
        apiFetch<EoiRefundRequestSnapshot[]>(
          `/v1/tenants/${project.tenantId}/projects/${project.projectId}/refund-requests`,
        ),
      ]);
      setEois(nextEois);
      setRefunds(nextRefunds);
    } catch (reason) {
      if (reason instanceof ApiError && reason.status === 401) {
        window.location.replace('/login');
        return;
      }
      setError(reason instanceof Error ? reason.message : 'Unable to load EOI refund operations.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    if (!selectedProject) return;
    window.localStorage.setItem(projectStorageKey, selectedProject.projectId);
    setEois([]);
    setRefunds([]);
    setQuotes({});
    setSuccess('');
    void loadProject(selectedProject);
  }, [loadProject, selectedProject]);

  useEffect(() => {
    if (!selectedProject) return;
    const source = new EventSource(
      eventStreamUrl(`/v1/tenants/${selectedProject.tenantId}/projects/${selectedProject.projectId}/events?after=0`),
      { withCredentials: true },
    );
    setLiveState('connecting');

    const onSignal = (event: Event): void => {
      try {
        const signal = JSON.parse((event as MessageEvent<string>).data) as RealtimeSignal;
        if (['REFUND', 'TRANSACTION', 'DOMAIN'].includes(signal.topic)) {
          void loadProject(selectedProject, true);
        }
      } catch {
        // Durable replay remains authoritative.
      }
    };
    const onResync = (): void => {
      void loadProject(selectedProject, true);
    };

    source.onopen = () => setLiveState('live');
    source.onerror = () => setLiveState(source.readyState === EventSource.CLOSED ? 'offline' : 'reconnecting');
    source.addEventListener('domain_signal', onSignal);
    source.addEventListener('resync_required', onResync);

    return () => {
      source.removeEventListener('domain_signal', onSignal);
      source.removeEventListener('resync_required', onResync);
      source.close();
    };
  }, [loadProject, selectedProject]);

  async function previewRefund(eoiId: string): Promise<void> {
    if (!selectedProject) return;
    setBusy(`quote:${eoiId}`);
    setError('');
    setSuccess('');
    try {
      const quote = await apiFetch<EoiRefundQuote>(
        `/v1/tenants/${selectedProject.tenantId}/projects/${selectedProject.projectId}/eois/${eoiId}/refund-quote`,
      );
      setQuotes((current) => ({ ...current, [eoiId]: quote }));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to calculate the refund quote.');
    } finally {
      setBusy('');
    }
  }

  async function requestRefund(eoiId: string): Promise<void> {
    if (!selectedProject) return;
    setBusy(`request:${eoiId}`);
    setError('');
    setSuccess('');
    try {
      await apiFetch(
        `/v1/tenants/${selectedProject.tenantId}/projects/${selectedProject.projectId}/eois/${eoiId}/refund-requests`,
        { method: 'POST' },
      );
      setSuccess('Refund request submitted using the current policy snapshot.');
      setQuotes((current) => {
        const next = { ...current };
        delete next[eoiId];
        return next;
      });
      await loadProject(selectedProject, true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to submit the refund request.');
    } finally {
      setBusy('');
    }
  }

  async function reviewRefund(request: EoiRefundRequestSnapshot, decision: ReviewDecision): Promise<void> {
    if (!selectedProject) return;
    const note = reviewNotes[request.refundRequestId]?.trim();
    if (decision === 'REJECT' && !note) {
      setError('Enter a review note before rejecting a refund request.');
      return;
    }

    setBusy(`review:${request.refundRequestId}:${decision}`);
    setError('');
    setSuccess('');
    try {
      await apiFetch(
        `/v1/tenants/${selectedProject.tenantId}/projects/${selectedProject.projectId}/refund-requests/${request.refundRequestId}/review`,
        {
          method: 'POST',
          body: JSON.stringify({ decision, ...(note ? { note } : {}) }),
        },
      );
      setSuccess(decision === 'APPROVE' ? 'Refund request approved.' : 'Refund request rejected.');
      await loadProject(selectedProject, true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to review the refund request.');
    } finally {
      setBusy('');
    }
  }

  if (!workspace && loading && !error) {
    return (
      <main className={styles.statePage}>
        <div className={styles.loadingMark}>P</div>
        <p>Loading EOI refund operations…</p>
      </main>
    );
  }

  if (!workspace || projects.length === 0) {
    return (
      <main className={styles.statePage}>
        <section className={styles.stateCard}>
          <span className={styles.eyebrow}>Refunds unavailable</span>
          <h1>PRENEURA could not open refund operations.</h1>
          <p>{error || 'Your current roles do not include this workspace.'}</p>
          <a href="/workspace">Return to workspace</a>
        </section>
      </main>
    );
  }

  return (
    <main className={styles.page}>
      <header className={styles.topbar}>
        <div className={styles.brandLine}>
          <a href="/workspace" className={styles.backButton} aria-label="Back to workspace">←</a>
          <div className={styles.brandMark}>P</div>
          <div>
            <strong>PRENEURA</strong>
            <span>EOI Refund Operations</span>
          </div>
        </div>
        <div className={styles.topControls}>
          <div className={styles.liveBlock}>
            <i className={`${styles.liveDot} ${styles[liveState]}`} />
            <span>{refreshing ? 'Refreshing' : liveLabel(liveState)}</span>
          </div>
          <select value={selectedProjectId} onChange={(event) => setSelectedProjectId(event.target.value)}>
            {projects.map((project) => (
              <option key={project.projectId} value={project.projectId}>{project.projectName}</option>
            ))}
          </select>
        </div>
      </header>

      <div className={styles.content}>
        <section className={styles.hero}>
          <div>
            <span className={styles.eyebrow}>Policy-driven refunds</span>
            <h1>{selectedProject?.projectName ?? 'EOI refunds'}</h1>
            <p>Refund amounts are quoted from the policy version captured by each EOI and its current reservation/contract stage.</p>
          </div>
          <div className={styles.heroStats}>
            <Metric label="EOIs" value={String(eois.length)} />
            <Metric label="Open requests" value={String(refunds.filter((item) => item.status === 'REQUESTED').length)} />
            <Metric label="Approved" value={String(refunds.filter((item) => item.status === 'APPROVED').length)} />
          </div>
        </section>

        {error ? <div className={styles.error}>{error}</div> : null}
        {success ? <div className={styles.success}>{success}</div> : null}

        <section className={styles.panel}>
          <div className={styles.panelHeading}>
            <div>
              <span className={styles.eyebrow}>Buyer funds</span>
              <h2>Expressions of interest</h2>
              <p>Only EOIs visible to your server-side scope are returned.</p>
            </div>
            <button type="button" onClick={() => exportEois(eois)}>Export CSV</button>
          </div>

          {loading && eois.length === 0 ? <Skeleton /> : eois.length === 0 ? (
            <Empty text="No EOIs are visible in this project scope." />
          ) : (
            <div className={styles.tableWrap}>
              <table>
                <thead>
                  <tr>
                    <th>Buyer</th>
                    <th>EOI</th>
                    <th>Amount</th>
                    <th>Status</th>
                    <th>Paid</th>
                    <th>Refund action</th>
                  </tr>
                </thead>
                <tbody>
                  {eois.map((eoi) => {
                    const quote = quotes[eoi.eoiId];
                    const refundable = ['PAID', 'APPLIED'].includes(eoi.status);
                    return (
                      <tr key={eoi.eoiId}>
                        <td>
                          <strong>{eoi.buyerDisplayName}</strong>
                          <span>{formatToken(eoi.buyerSource)} · {shortId(eoi.buyerProfileId)}</span>
                        </td>
                        <td><code>{shortId(eoi.eoiId)}</code></td>
                        <td>{money(eoi.amount, eoi.currency)}</td>
                        <td><Status value={eoi.status} /></td>
                        <td>{eoi.paidAt ? formatDate(eoi.paidAt) : '—'}</td>
                        <td>
                          {can('refund.request') && refundable ? (
                            <div className={styles.refundAction}>
                              {!quote ? (
                                <button
                                  type="button"
                                  disabled={Boolean(busy)}
                                  onClick={() => void previewRefund(eoi.eoiId)}
                                >
                                  {busy === `quote:${eoi.eoiId}` ? 'Calculating…' : 'Preview refund'}
                                </button>
                              ) : (
                                <div className={styles.quoteCard}>
                                  <div>
                                    <span>{formatToken(quote.stage)}</span>
                                    <strong>{money(quote.refundableAmount, quote.currency)}</strong>
                                    <small>{quote.refundPercent}% less {money(quote.processingFee, quote.currency)} fee</small>
                                  </div>
                                  <button
                                    type="button"
                                    disabled={Boolean(busy)}
                                    onClick={() => void requestRefund(eoi.eoiId)}
                                  >
                                    {busy === `request:${eoi.eoiId}` ? 'Submitting…' : 'Request refund'}
                                  </button>
                                </div>
                              )}
                            </div>
                          ) : <span className={styles.muted}>—</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className={styles.panel}>
          <div className={styles.panelHeading}>
            <div>
              <span className={styles.eyebrow}>Workflow queue</span>
              <h2>Refund requests</h2>
              <p>Approval changes the request state only. Payment execution is intentionally separate from approval.</p>
            </div>
            <button type="button" onClick={() => exportRefunds(refunds)}>Export CSV</button>
          </div>

          {loading && refunds.length === 0 ? <Skeleton /> : refunds.length === 0 ? (
            <Empty text="No refund requests are visible in this project scope." />
          ) : (
            <div className={styles.cards}>
              {refunds.map((request) => (
                <article className={styles.requestCard} key={request.refundRequestId}>
                  <div className={styles.requestTop}>
                    <div>
                      <span className={styles.eyebrow}>{formatToken(request.stage)}</span>
                      <h3>{request.buyerDisplayName}</h3>
                      <small>Requested {formatDateTime(request.requestedAt)} · EOI {shortId(request.eoiId)}</small>
                    </div>
                    <Status value={request.status} />
                  </div>

                  <div className={styles.requestAmounts}>
                    <Metric label="Original EOI" value={money(request.originalAmount, request.currency)} />
                    <Metric label="Refund rate" value={`${request.refundPercent}%`} />
                    <Metric label="Fee" value={money(request.processingFee, request.currency)} />
                    <Metric label="Requested" value={money(request.requestedAmount, request.currency)} />
                  </div>

                  {request.decisionNote ? <div className={styles.decisionNote}>{request.decisionNote}</div> : null}

                  {can('refund.approve') && request.status === 'REQUESTED' ? (
                    <div className={styles.reviewBox}>
                      <textarea
                        placeholder="Review note (required to reject)"
                        value={reviewNotes[request.refundRequestId] ?? ''}
                        onChange={(event) => setReviewNotes((current) => ({
                          ...current,
                          [request.refundRequestId]: event.target.value,
                        }))}
                      />
                      <div>
                        <button
                          type="button"
                          disabled={Boolean(busy)}
                          onClick={() => void reviewRefund(request, 'APPROVE')}
                        >
                          Approve
                        </button>
                        <button
                          type="button"
                          className={styles.danger}
                          disabled={Boolean(busy)}
                          onClick={() => void reviewRefund(request, 'REJECT')}
                        >
                          Reject
                        </button>
                      </div>
                    </div>
                  ) : null}
                </article>
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.metric}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function Status({ value }: { value: string }) {
  return <span className={styles.status}>{formatToken(value)}</span>;
}

function Empty({ text }: { text: string }) {
  return <div className={styles.empty}>{text}</div>;
}

function Skeleton() {
  return (
    <div className={styles.skeleton} aria-label="Loading">
      <span />
      <span />
      <span />
    </div>
  );
}

function exportEois(items: EoiListItemSnapshot[]): void {
  exportCsv('preneura-eois.csv', [
    ['EOI ID', 'Buyer', 'Buyer Profile ID', 'Source', 'Amount', 'Currency', 'Status', 'Payment Reference', 'Paid At', 'Applied At', 'Refund Requested At', 'Created At'],
    ...items.map((item) => [
      item.eoiId,
      item.buyerDisplayName,
      item.buyerProfileId,
      item.buyerSource,
      item.amount,
      item.currency,
      item.status,
      item.paymentReference ?? '',
      item.paidAt ?? '',
      item.appliedAt ?? '',
      item.refundRequestedAt ?? '',
      item.createdAt,
    ]),
  ]);
}

function exportRefunds(items: EoiRefundRequestSnapshot[]): void {
  exportCsv('preneura-eoi-refunds.csv', [
    ['Refund Request ID', 'EOI ID', 'Buyer', 'Buyer Profile ID', 'Stage', 'Original Amount', 'Refund %', 'Processing Fee', 'Requested Amount', 'Currency', 'Status', 'Requested At', 'Reviewed At', 'Paid At', 'Decision Note'],
    ...items.map((item) => [
      item.refundRequestId,
      item.eoiId,
      item.buyerDisplayName,
      item.buyerProfileId,
      item.stage,
      item.originalAmount,
      item.refundPercent,
      item.processingFee,
      item.requestedAmount,
      item.currency,
      item.status,
      item.requestedAt,
      item.reviewedAt ?? '',
      item.paidAt ?? '',
      item.decisionNote ?? '',
    ]),
  ]);
}

function exportCsv(filename: string, rows: Array<Array<string>>): void {
  const body = rows.map((row) => row.map(csvCell).join(',')).join('\r\n');
  const blob = new Blob([`\uFEFF${body}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function csvCell(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function money(value: string, currency: string): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    maximumFractionDigits: 2,
  }).format(Number(value));
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(value));
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

function formatToken(value: string): string {
  return value
    .split(/[_\-.\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');
}

function shortId(value: string): string {
  return value.length > 12 ? `${value.slice(0, 6)}…${value.slice(-4)}` : value;
}

function liveLabel(state: 'connecting' | 'live' | 'reconnecting' | 'offline'): string {
  switch (state) {
    case 'live': return 'Live';
    case 'connecting': return 'Connecting';
    case 'reconnecting': return 'Reconnecting';
    case 'offline': return 'Replay available';
  }
}
