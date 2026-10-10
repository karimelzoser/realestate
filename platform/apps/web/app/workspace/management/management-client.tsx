'use client';

import {
  roleHasPermission,
  type WorkspaceContextSnapshot,
  type WorkspaceProjectSnapshot,
} from '@preneura/contracts/access';
import type { ManagementProjectOverviewSnapshot } from '@preneura/contracts/management';
import type { RealtimeSignal } from '@preneura/contracts/realtime';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ApiError, apiFetch, eventStreamUrl } from '../../lib/api';
import styles from './management.module.css';

export default function ManagementClient() {
  const [workspace, setWorkspace] = useState<WorkspaceContextSnapshot | null>(null);
  const [projectId, setProjectId] = useState('');
  const [overview, setOverview] = useState<ManagementProjectOverviewSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [live, setLive] = useState<'connecting' | 'live' | 'reconnecting'>('connecting');

  const projects = useMemo(
    () => workspace?.projects.filter((project) =>
      project.roles.some((role) => roleHasPermission(role, 'project.manage')),
    ) ?? [],
    [workspace],
  );
  const project = projects.find((item) => item.projectId === projectId) ?? null;
  const mode = project?.roles.includes('OPERATIONS_DIRECTOR') ? 'Operations Director' : 'Manager';

  const load = useCallback(async (selected: WorkspaceProjectSnapshot) => {
    setLoading(true);
    setError('');
    try {
      setOverview(await apiFetch<ManagementProjectOverviewSnapshot>(
        `/v1/tenants/${selected.tenantId}/projects/${selected.projectId}/management/overview`,
      ));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to load management overview.');
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
          candidate.roles.some((role) => roleHasPermission(role, 'project.manage')),
        );
        if (allowed.length === 0) {
          setError('No Manager or Operations Director project authority is assigned to this account.');
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
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!project) return;
    window.localStorage.setItem('preneura:selected-project', project.projectId);
    void load(project);
  }, [project, load]);

  useEffect(() => {
    if (!project) return;
    const source = new EventSource(
      eventStreamUrl(`/v1/tenants/${project.tenantId}/projects/${project.projectId}/events?after=0`),
      { withCredentials: true },
    );
    setLive('connecting');
    let refreshTimer: number | null = null;

    const refreshSoon = () => {
      if (refreshTimer !== null) return;
      refreshTimer = window.setTimeout(() => {
        refreshTimer = null;
        void load(project);
      }, 300);
    };
    const onSignal = (event: Event) => {
      try {
        const signal = JSON.parse((event as MessageEvent<string>).data) as RealtimeSignal;
        if (['CATALOG', 'INVENTORY', 'PRICING', 'QUEUE', 'TRANSACTION', 'COMMISSION', 'REFUND', 'DOMAIN'].includes(signal.topic)) {
          refreshSoon();
        }
      } catch {
        // Durable resync remains authoritative.
      }
    };
    source.onopen = () => setLive('live');
    source.onerror = () => setLive('reconnecting');
    source.addEventListener('domain_signal', onSignal);
    source.addEventListener('resync_required', refreshSoon);

    return () => {
      if (refreshTimer !== null) window.clearTimeout(refreshTimer);
      source.removeEventListener('domain_signal', onSignal);
      source.removeEventListener('resync_required', refreshSoon);
      source.close();
    };
  }, [project, load]);

  const can = useCallback((permission: Parameters<typeof roleHasPermission>[1]) =>
    Boolean(project?.roles.some((role) => roleHasPermission(role, permission))), [project]);

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <a href="/workspace" className={styles.back}>← Workspace</a>
          <p className={styles.eyebrow}>MANAGEMENT CONTROL ROOM</p>
          <h1>{project?.projectName ?? 'Project operations'}</h1>
          <p>{mode} view of live allocation, transaction completion, receivables, broker exposure and operational exceptions.</p>
        </div>
        <div className={styles.headerControls}>
          <span className={live === 'live' ? styles.live : styles.reconnecting}>{live === 'live' ? '● Live' : '● Reconnecting'}</span>
          {projects.length > 1 ? (
            <select value={projectId} onChange={(event) => setProjectId(event.target.value)}>
              {projects.map((item) => <option key={item.projectId} value={item.projectId}>{item.projectName}</option>)}
            </select>
          ) : null}
          <button onClick={() => project && void load(project)} disabled={!project || loading}>Refresh</button>
        </div>
      </header>

      {error ? <div className={styles.error}>{error}</div> : null}
      {loading && !overview ? <div className={styles.loading}>Loading management control room…</div> : null}

      {overview ? (
        <>
          <section className={styles.primaryMetrics}>
            <Metric label="Available capacity" value={overview.inventory.available} detail={`${overview.inventory.sold} sold · ${overview.inventory.reserved} reserved`} />
            <Metric label="Queue waiting" value={overview.allocation.waiting} detail={`${overview.allocation.called} called · ${overview.allocation.locked} locked`} />
            <Metric label="Open transactions" value={overview.transactions.open} detail={`${overview.transactions.averageCompletionPercent}% avg completion`} />
            <Metric label="Ready to complete" value={overview.transactions.readyForCompletion} detail={overview.transactions.oldestOpenHours === null ? 'No open aging' : `Oldest open ${ageLabel(overview.transactions.oldestOpenHours)}`} />
          </section>

          <section className={styles.riskGrid}>
            <RiskCard
              title="Receivables risk"
              value={money(overview.finance.overdueOutstandingAmount, overview.currency)}
              detail={`${overview.finance.overdueItems} overdue payment item${overview.finance.overdueItems === 1 ? '' : 's'}`}
              href="/workspace/transaction-operations"
              severity={overview.finance.overdueItems > 0 ? 'attention' : 'clear'}
            />
            <RiskCard
              title="Broker commission exposure"
              value={money(overview.commissions.outstandingAmount, overview.currency)}
              detail={`${overview.commissions.overdue} overdue · ${overview.commissions.disputed} disputed`}
              href="/workspace/commissions"
              severity={overview.commissions.overdue + overview.commissions.disputed > 0 ? 'attention' : 'clear'}
            />
            <RiskCard
              title="Refund exposure"
              value={money(overview.refunds.approvedAmount, overview.currency)}
              detail={`${overview.refunds.requested} requested · ${overview.refunds.approved} approved`}
              href="/workspace/refunds"
              severity={overview.refunds.requested + overview.refunds.approved > 0 ? 'attention' : 'clear'}
            />
            <RiskCard
              title="Delivery health"
              value={`${overview.notifications.failed} failed`}
              detail={`${overview.notifications.pending} pending notification job${overview.notifications.pending === 1 ? '' : 's'}`}
              href="/workspace/reminders"
              severity={overview.notifications.failed > 0 ? 'critical' : 'clear'}
            />
          </section>

          <section className={styles.columns}>
            <article className={styles.panel}>
              <div className={styles.panelHead}>
                <div><p className={styles.eyebrow}>COMPLETION BACKLOG</p><h2>Where transactions are blocked</h2></div>
                <a href="/workspace/transaction-operations">Open queue</a>
              </div>
              <div className={styles.backlog}>
                <Backlog label="Documents" value={overview.completionBacklog.NEEDS_DOCUMENTS} />
                <Backlog label="Down payment" value={overview.completionBacklog.NEEDS_PAYMENT} />
                <Backlog label="Cheques" value={overview.completionBacklog.NEEDS_CHEQUES} />
                <Backlog label="Contract generation" value={overview.completionBacklog.NEEDS_CONTRACT} />
                <Backlog label="Buyer signature" value={overview.completionBacklog.NEEDS_BUYER_SIGNATURE} />
                <Backlog label="Company execution" value={overview.completionBacklog.NEEDS_COMPANY_EXECUTION} />
                <Backlog label="Ready to complete" value={overview.completionBacklog.READY_TO_COMPLETE} positive />
              </div>
            </article>

            <article className={styles.panel}>
              <div className={styles.panelHead}><div><p className={styles.eyebrow}>COMMERCIAL CONTROL</p><h2>Inventory and pricing</h2></div></div>
              <dl className={styles.definitionList}>
                <div><dt>Unit types</dt><dd>{overview.inventory.unitTypes}</dd></div>
                <div><dt>Available / reserved / sold</dt><dd>{overview.inventory.available} / {overview.inventory.reserved} / {overview.inventory.sold}</dd></div>
                <div><dt>Scheduled price versions</dt><dd>{overview.inventory.scheduledPriceVersions}</dd></div>
                <div><dt>Next price change</dt><dd>{overview.inventory.nextPriceChangeAt ? new Date(overview.inventory.nextPriceChangeAt).toLocaleString() : 'None scheduled'}</dd></div>
                <div><dt>Commission eligible / due / paid</dt><dd>{overview.commissions.eligible} / {overview.commissions.due} / {overview.commissions.paid}</dd></div>
              </dl>
            </article>
          </section>

          <section className={styles.actions}>
            <p className={styles.eyebrow}>OPERATE</p>
            <div>
              {can('queue.manage') || can('allocation.assist') ? <a href="/workspace/allocation">Live allocation</a> : null}
              {can('transaction.manage') ? <a href="/workspace/transaction-operations">Transaction operations</a> : null}
              {can('buyers.read') ? <a href="/workspace/sales">Buyers & EOIs</a> : null}
              {can('commission.status.read') ? <a href="/workspace/commissions">Commissions</a> : null}
              {can('refund.read') ? <a href="/workspace/refunds">Refunds</a> : null}
              {can('notifications.manage') ? <a href="/workspace/reminders">Reminders</a> : null}
              {can('project.manage') ? <a href="/workspace/project-setup">Project setup</a> : null}
              {can('tenant.users.manage') ? <a href="/workspace/accounts">Accounts</a> : null}
              {can('ai.manager.use') ? <a href="/workspace/ai">Manager AI</a> : null}
            </div>
          </section>

          <p className={styles.generated}>Server snapshot {new Date(overview.generatedAt).toLocaleString()}</p>
        </>
      ) : null}
    </main>
  );
}

function Metric({ label, value, detail }: { label: string; value: number; detail: string }) {
  return <article className={styles.metric}><span>{label}</span><strong>{value}</strong><small>{detail}</small></article>;
}

function RiskCard({ title, value, detail, href, severity }: { title: string; value: string; detail: string; href: string; severity: 'clear' | 'attention' | 'critical' }) {
  return <a href={href} className={`${styles.riskCard} ${severity === 'critical' ? styles.critical : severity === 'attention' ? styles.attention : styles.clear}`}><span>{title}</span><strong>{value}</strong><small>{detail}</small></a>;
}

function Backlog({ label, value, positive = false }: { label: string; value: number; positive?: boolean }) {
  return <div><span>{label}</span><strong className={positive ? styles.positive : undefined}>{value}</strong></div>;
}

function money(value: string, currency: string): string {
  const amount = Number(value);
  return Number.isFinite(amount) ? new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 0 }).format(amount) : `${value} ${currency}`;
}

function ageLabel(hours: number): string {
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}
