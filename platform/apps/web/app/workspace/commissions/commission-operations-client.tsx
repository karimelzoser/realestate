'use client';

import {
  roleHasPermission,
  type WorkspaceContextSnapshot,
  type WorkspaceProjectSnapshot,
} from '@preneura/contracts/access';
import type {
  BrokerCommissionContextSnapshot,
  CommissionCaseSnapshot,
} from '@preneura/contracts/commissions';
import type { RealtimeSignal } from '@preneura/contracts/realtime';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ApiError, apiFetch, eventStreamUrl } from '../../lib/api';
import styles from './commission-operations.module.css';

export default function CommissionOperationsClient() {
  const [workspace, setWorkspace] = useState<WorkspaceContextSnapshot | null>(null);
  const [projectId, setProjectId] = useState('');
  const [brokers, setBrokers] = useState<BrokerCommissionContextSnapshot[]>([]);
  const [brokerCompanyId, setBrokerCompanyId] = useState('');
  const [cases, setCases] = useState<CommissionCaseSnapshot[]>([]);
  const [busyCaseId, setBusyCaseId] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [, setClock] = useState(0);

  const eligibleProjects = useMemo(
    () => workspace?.projects.filter((project) =>
      project.roles.some((role) => roleHasPermission(role, 'commission.status.read')),
    ) ?? [],
    [workspace],
  );
  const project = useMemo(
    () => eligibleProjects.find((item) => item.projectId === projectId) ?? null,
    [eligibleProjects, projectId],
  );
  const broker = useMemo(
    () => brokers.find((item) => item.brokerCompanyId === brokerCompanyId) ?? null,
    [brokers, brokerCompanyId],
  );
  const canManagePayment = Boolean(project?.roles.some((role) => roleHasPermission(role, 'commission.payment.manage')));
  const canSeeAmount = cases.some((item) => item.commissionAmount !== undefined);
  const canSeeRate = cases.some((item) => item.ratePercent !== undefined);

  useEffect(() => {
    const timer = window.setInterval(() => setClock((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void apiFetch<WorkspaceContextSnapshot>('/v1/me/workspace')
      .then((context) => {
        if (cancelled) return;
        const allowed = context.projects.filter((candidate) =>
          candidate.roles.some((role) => roleHasPermission(role, 'commission.status.read')),
        );
        if (allowed.length === 0) {
          setError('Your account does not have commission visibility in any project.');
          setLoading(false);
          return;
        }
        setWorkspace(context);
        const stored = window.localStorage.getItem('preneura:selected-project');
        const selected = allowed.find((candidate) => candidate.projectId === stored) ?? allowed[0]!;
        setProjectId(selected.projectId);
      })
      .catch((reason) => {
        if (reason instanceof ApiError && reason.status === 401) {
          window.location.replace('/login');
          return;
        }
        setError(reason instanceof Error ? reason.message : 'Unable to load commission workspace.');
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const loadBrokers = useCallback(async (selectedProject: WorkspaceProjectSnapshot): Promise<void> => {
    setLoading(true);
    setError('');
    try {
      const contexts = await apiFetch<BrokerCommissionContextSnapshot[]>(
        `/v1/tenants/${selectedProject.tenantId}/projects/${selectedProject.projectId}/commission-brokers`,
      );
      setBrokers(contexts);
      setBrokerCompanyId((current) =>
        contexts.some((item) => item.brokerCompanyId === current)
          ? current
          : contexts[0]?.brokerCompanyId ?? '',
      );
      if (contexts.length === 0) setCases([]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to load project brokers.');
      setBrokers([]);
      setBrokerCompanyId('');
      setCases([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadCases = useCallback(async (
    selectedProject: WorkspaceProjectSnapshot,
    selectedBrokerCompanyId: string,
  ): Promise<void> => {
    if (!selectedBrokerCompanyId) {
      setCases([]);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const result = await apiFetch<CommissionCaseSnapshot[]>(
        `/v1/tenants/${selectedProject.tenantId}/projects/${selectedProject.projectId}/brokers/${selectedBrokerCompanyId}/commissions`,
      );
      setCases(result);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to load commission cases.');
      setCases([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!project) return;
    window.localStorage.setItem('preneura:selected-project', project.projectId);
    setBrokers([]);
    setBrokerCompanyId('');
    setCases([]);
    void loadBrokers(project);
  }, [project, loadBrokers]);

  useEffect(() => {
    if (!project || !brokerCompanyId) return;
    void loadCases(project, brokerCompanyId);
  }, [project, brokerCompanyId, loadCases]);

  useEffect(() => {
    if (!project || !brokerCompanyId) return;
    const source = new EventSource(
      eventStreamUrl(`/v1/tenants/${project.tenantId}/projects/${project.projectId}/events?after=0`),
      { withCredentials: true },
    );
    const onSignal = (event: Event): void => {
      try {
        const signal = JSON.parse((event as MessageEvent<string>).data) as RealtimeSignal;
        if (signal.topic === 'COMMISSION' || signal.topic === 'TRANSACTION') {
          void loadCases(project, brokerCompanyId);
        }
      } catch {
        // Durable replay remains authoritative.
      }
    };
    const onResync = (): void => {
      void loadCases(project, brokerCompanyId);
    };
    source.addEventListener('domain_signal', onSignal);
    source.addEventListener('resync_required', onResync);
    return () => {
      source.removeEventListener('domain_signal', onSignal);
      source.removeEventListener('resync_required', onResync);
      source.close();
    };
  }, [project, brokerCompanyId, loadCases]);

  async function updateStatus(item: CommissionCaseSnapshot, action: 'MARK_INVOICED' | 'MARK_PAID' | 'MARK_DISPUTED'): Promise<void> {
    if (!project || !brokerCompanyId || busyCaseId) return;
    setBusyCaseId(item.commissionCaseId);
    setError('');
    try {
      await apiFetch<{ updated: true }>(
        `/v1/tenants/${project.tenantId}/projects/${project.projectId}/brokers/${brokerCompanyId}/commissions/${item.commissionCaseId}/status`,
        { method: 'POST', body: JSON.stringify({ action }) },
      );
      await loadCases(project, brokerCompanyId);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to update commission status.');
    } finally {
      setBusyCaseId('');
    }
  }

  function exportCsv(): void {
    if (!project || !broker) return;
    const headers = [
      'Commission Case ID', 'Transaction ID', 'Broker Company', 'Status', 'Completion %',
      'Prerequisites Complete', 'Eligible At', 'Due At', 'Countdown',
      ...(canSeeAmount ? ['Basis Amount', 'Commission Amount'] : []),
      ...(canSeeRate ? ['Rate %'] : []),
    ];
    const rows = cases.map((item) => [
      item.commissionCaseId,
      item.transactionId,
      broker.name,
      item.status,
      item.completionPercent,
      item.prerequisitesComplete ? 'Yes' : 'No',
      item.eligibleAt ?? '',
      item.dueAt ?? '',
      countdownLabel(item),
      ...(canSeeAmount ? [item.basisAmount ?? '', item.commissionAmount ?? ''] : []),
      ...(canSeeRate ? [item.ratePercent ?? ''] : []),
    ]);
    const csv = [headers, ...rows].map((row) => row.map(csvCell).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${project.projectCode}-${broker.code}-commissions.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  if (!workspace && loading) {
    return <main className={styles.statePage}><div className={styles.loadingMark}>P</div><p>Loading commission operations…</p></main>;
  }

  const statusCounts = countStatuses(cases);
  const visibleAmountTotal = canSeeAmount
    ? cases.reduce((sum, item) => sum + Number(item.commissionAmount ?? 0), 0)
    : null;
  const overdueCount = cases.filter((item) => item.dueAt && new Date(item.dueAt).getTime() < Date.now() && item.status !== 'PAID').length;

  return (
    <main className={styles.page}>
      <header className={styles.topbar}>
        <a href="/workspace" className={styles.backButton}>←</a>
        <div className={styles.brandMark}>P</div>
        <div className={styles.brandText}><strong>PRENEURA</strong><span>Broker commission operations</span></div>
        <div className={styles.topControls}>
          <select value={projectId} onChange={(event) => setProjectId(event.target.value)} aria-label="Project">
            {eligibleProjects.map((item) => <option key={item.projectId} value={item.projectId}>{item.projectName}</option>)}
          </select>
          <select value={brokerCompanyId} onChange={(event) => setBrokerCompanyId(event.target.value)} aria-label="Broker company" disabled={brokers.length === 0}>
            {brokers.length === 0 ? <option value="">No active brokers</option> : null}
            {brokers.map((item) => <option key={item.brokerCompanyId} value={item.brokerCompanyId}>{item.name}</option>)}
          </select>
          <button type="button" onClick={exportCsv} disabled={!broker || cases.length === 0}>Export CSV</button>
        </div>
      </header>

      <section className={styles.content}>
        <div className={styles.heading}>
          <div>
            <span className={styles.eyebrow}>Commission control</span>
            <h1>{broker?.name ?? 'Broker commissions'}</h1>
            <p>
              Eligibility is derived from down payment, all cheque receipt, signed contract and stamped contract.
              Countdown begins only after those prerequisites are valid.
            </p>
          </div>
          <div className={styles.privacyNote}>
            <strong>Field-level privacy</strong>
            <span>{canSeeAmount || canSeeRate ? 'Financial fields follow your role capabilities.' : 'Your role exposes status and timing only.'}</span>
          </div>
        </div>

        {error ? <div className={styles.error}>{error}</div> : null}

        <section className={styles.metrics}>
          <Metric label="Cases" value={String(cases.length)} hint={`${statusCounts.PENDING_PREREQUISITES} awaiting prerequisites`} />
          <Metric label="Eligible / Due" value={String(statusCounts.ELIGIBLE + statusCounts.DUE + statusCounts.INVOICED)} hint={`${overdueCount} overdue`} />
          <Metric label="Paid" value={String(statusCounts.PAID)} hint={`${statusCounts.DISPUTED} disputed`} />
          {visibleAmountTotal !== null ? (
            <Metric label="Visible commission" value={money(visibleAmountTotal, project?.currency ?? 'EGP')} hint="role-authorized total" />
          ) : (
            <Metric label="Financials" value="Restricted" hint="status-only visibility" />
          )}
        </section>

        <section className={styles.panel}>
          <div className={styles.panelHeading}>
            <div><span className={styles.eyebrow}>Live queue</span><h2>Commission cases</h2></div>
            <span>{loading ? 'Refreshing…' : `${cases.length} case${cases.length === 1 ? '' : 's'}`}</span>
          </div>

          {cases.length === 0 && !loading ? <div className={styles.empty}>No commission cases are available for this broker/project scope.</div> : null}
          <div className={styles.caseGrid}>
            {cases.map((item) => (
              <article className={styles.caseCard} key={item.commissionCaseId}>
                <div className={styles.caseTop}>
                  <div>
                    <span className={styles.caseId}>Transaction {shortId(item.transactionId)}</span>
                    <h3>{formatStatus(item.status)}</h3>
                  </div>
                  <span className={`${styles.status} ${statusClass(item.status, styles)}`}>{formatStatus(item.status)}</span>
                </div>

                <div className={styles.progressBlock}>
                  <div><span>Completion</span><strong>{Number(item.completionPercent).toFixed(0)}%</strong></div>
                  <div className={styles.progressTrack}><span style={{ width: `${Math.max(0, Math.min(100, Number(item.completionPercent)))}%` }} /></div>
                  <small>{item.prerequisitesComplete ? 'Commission prerequisites complete.' : 'Waiting for required finance/contract milestones.'}</small>
                </div>

                <div className={styles.countdown}>
                  <span>{countdownLabel(item)}</span>
                  <small>{item.dueAt ? `Due ${formatDateTime(item.dueAt)}` : 'Timer starts after eligibility'}</small>
                </div>

                {(item.commissionAmount !== undefined || item.ratePercent !== undefined) ? (
                  <div className={styles.financials}>
                    {item.commissionAmount !== undefined ? <Data label="Commission" value={money(Number(item.commissionAmount), project?.currency ?? 'EGP')} /> : null}
                    {item.basisAmount !== undefined ? <Data label="Basis" value={money(Number(item.basisAmount), project?.currency ?? 'EGP')} /> : null}
                    {item.ratePercent !== undefined ? <Data label="Rate" value={`${Number(item.ratePercent).toFixed(2)}%`} /> : null}
                  </div>
                ) : null}

                <div className={styles.caseFooter}>
                  <a href={`/workspace/transactions/${item.transactionId}?tenantId=${encodeURIComponent(project?.tenantId ?? '')}&projectId=${encodeURIComponent(project?.projectId ?? '')}`}>Open transaction</a>
                  {canManagePayment ? (
                    <div className={styles.actions}>
                      {['ELIGIBLE', 'DUE'].includes(item.status) ? <button type="button" disabled={busyCaseId === item.commissionCaseId} onClick={() => void updateStatus(item, 'MARK_INVOICED')}>Mark invoiced</button> : null}
                      {['INVOICED', 'DUE'].includes(item.status) ? <button type="button" disabled={busyCaseId === item.commissionCaseId} onClick={() => void updateStatus(item, 'MARK_PAID')}>Mark paid</button> : null}
                      {!['PAID', 'CANCELLED', 'DISPUTED'].includes(item.status) ? <button type="button" className={styles.danger} disabled={busyCaseId === item.commissionCaseId} onClick={() => void updateStatus(item, 'MARK_DISPUTED')}>Dispute</button> : null}
                    </div>
                  ) : null}
                </div>
              </article>
            ))}
          </div>
        </section>
      </section>
    </main>
  );
}

function Metric(props: { label: string; value: string; hint: string }) {
  return <article className={styles.metric}><span>{props.label}</span><strong>{props.value}</strong><small>{props.hint}</small></article>;
}

function Data(props: { label: string; value: string }) {
  return <div><span>{props.label}</span><strong>{props.value}</strong></div>;
}

function countStatuses(items: CommissionCaseSnapshot[]) {
  const initial: Record<CommissionCaseSnapshot['status'], number> = {
    PENDING_PREREQUISITES: 0,
    ELIGIBLE: 0,
    INVOICED: 0,
    DUE: 0,
    PAID: 0,
    DISPUTED: 0,
    CANCELLED: 0,
  };
  for (const item of items) initial[item.status] += 1;
  return initial;
}

function countdownLabel(item: CommissionCaseSnapshot): string {
  if (item.status === 'PAID') return 'Paid';
  if (!item.dueAt) return item.prerequisitesComplete ? 'Eligibility processing' : 'Not eligible yet';
  const delta = new Date(item.dueAt).getTime() - Date.now();
  const overdue = delta < 0;
  const totalSeconds = Math.max(0, Math.floor(Math.abs(delta) / 1000));
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const clock = days > 0 ? `${days}d ${hours}h ${minutes}m` : `${hours}h ${minutes}m ${seconds}s`;
  return overdue ? `Overdue by ${clock}` : `Due in ${clock}`;
}

function formatStatus(value: CommissionCaseSnapshot['status']): string {
  return value.toLowerCase().split('_').map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ');
}

function statusClass(status: CommissionCaseSnapshot['status'], styleMap: typeof styles): string {
  switch (status) {
    case 'PENDING_PREREQUISITES': return styleMap.pending;
    case 'ELIGIBLE': return styleMap.eligible;
    case 'INVOICED': return styleMap.invoiced;
    case 'DUE': return styleMap.due;
    case 'PAID': return styleMap.paid;
    case 'DISPUTED': return styleMap.disputed;
    case 'CANCELLED': return styleMap.cancelled;
  }
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value));
}

function money(value: number, currency: string): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 0 }).format(value);
}

function shortId(value: string): string {
  return value.length > 12 ? `${value.slice(0, 6)}…${value.slice(-4)}` : value;
}

function csvCell(value: unknown): string {
  const text = String(value ?? '');
  return `"${text.replaceAll('"', '""')}"`;
}
