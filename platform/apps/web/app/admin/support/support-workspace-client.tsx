'use client';

import type { UnitTypeCommercialSnapshot } from '@preneura/contracts/catalog';
import type { PlatformControlPlaneSnapshot, SupportAccessSessionSnapshot } from '@preneura/contracts/platform-admin';
import type { TransactionListItemSnapshot } from '@preneura/contracts/sales';
import { useEffect, useMemo, useState } from 'react';
import { ApiError, apiFetch } from '../../lib/api';
import styles from './support-workspace.module.css';

type Props = { tenantId: string; projectId: string };

export default function SupportWorkspaceClient({ tenantId, projectId }: Props) {
  const [catalog, setCatalog] = useState<UnitTypeCommercialSnapshot[]>([]);
  const [transactions, setTransactions] = useState<TransactionListItemSnapshot[]>([]);
  const [sessions, setSessions] = useState<SupportAccessSessionSnapshot[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');

    if (!tenantId || !projectId) {
      void apiFetch<PlatformControlPlaneSnapshot>('/v1/platform/control-plane')
        .then((snapshot) => {
          if (cancelled) return;
          setSessions(snapshot.activeSupportSessions.filter((session) => session.projectId !== null));
        })
        .catch((reason) => {
          if (cancelled) return;
          if (reason instanceof ApiError && reason.status === 401) {
            window.location.replace('/login');
            return;
          }
          setError(reason instanceof Error ? reason.message : 'Unable to load support sessions.');
        })
        .finally(() => { if (!cancelled) setLoading(false); });
      return () => { cancelled = true; };
    }

    Promise.all([
      apiFetch<UnitTypeCommercialSnapshot[]>(`/v1/tenants/${tenantId}/projects/${projectId}/catalog`),
      apiFetch<TransactionListItemSnapshot[]>(`/v1/tenants/${tenantId}/projects/${projectId}/transactions`),
    ])
      .then(([nextCatalog, nextTransactions]) => {
        if (cancelled) return;
        setCatalog(nextCatalog);
        setTransactions(nextTransactions);
      })
      .catch((reason) => {
        if (cancelled) return;
        if (reason instanceof ApiError && reason.status === 401) {
          window.location.replace('/login');
          return;
        }
        setError(reason instanceof ApiError && reason.status === 403
          ? 'This support scope is not active. Open a project-scoped or tenant-wide support session from Platform Admin.'
          : reason instanceof Error ? reason.message : 'Unable to load support workspace.');
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [tenantId, projectId]);

  const metrics = useMemo(() => ({
    available: catalog.reduce((sum, row) => sum + row.availableQuantity, 0),
    reserved: catalog.reduce((sum, row) => sum + row.reservedQuantity, 0),
    sold: catalog.reduce((sum, row) => sum + row.soldQuantity, 0),
    openTransactions: transactions.filter((row) => row.status === 'IN_PROGRESS' || row.status === 'READY_FOR_COMPLETION').length,
  }), [catalog, transactions]);

  const selectingSession = !tenantId || !projectId;
  return (
    <main className={styles.page}>
      <header className={styles.topbar}>
        <a href="/admin">← Platform Admin</a>
        <div><strong>PRENEURA Support</strong><span>Read-only tenant operations</span></div>
        <span className={styles.readOnly}>READ ONLY</span>
      </header>
      <section className={styles.content}>
        <div className={styles.hero}>
          <div><span className={styles.eyebrow}>Break-glass support workspace</span><h1>{selectingSession ? 'Select active support scope' : 'Operational inspection'}</h1><p>{selectingSession ? 'Only currently active, audited project support sessions can be opened here.' : 'This view is available only while your audited support session covers this tenant/project. All mutations remain denied by the server.'}</p></div>
          {!selectingSession ? <div className={styles.scope}><span>Tenant</span><code>{shortId(tenantId)}</code><span>Project</span><code>{shortId(projectId)}</code></div> : null}
        </div>
        {error ? <div className={styles.error}>{error}</div> : null}
        {loading ? <div className={styles.loading}>Loading support state…</div> : null}

        {!loading && !error && selectingSession ? <section className={styles.panel}>
          <div className={styles.panelHeading}><div><span className={styles.eyebrow}>Active access</span><h2>Project support sessions</h2></div><span>{sessions.length}</span></div>
          <div className={styles.sessionGrid}>
            {sessions.map((session) => <a className={styles.sessionCard} key={session.sessionId} href={`/admin/support?tenantId=${encodeURIComponent(session.tenantId)}&projectId=${encodeURIComponent(session.projectId!)}`}>
              <strong>{session.tenantName}</strong><span>{session.projectName ?? 'Project'}</span><small>{session.reason}</small><small>Expires {new Date(session.expiresAt).toLocaleString()}</small>
            </a>)}
          </div>
          {sessions.length === 0 ? <div className={styles.empty}>No active project-scoped support session. Open one from <a href="/admin">Platform Admin</a>.</div> : null}
        </section> : null}

        {!loading && !error && !selectingSession ? <>
          <section className={styles.metrics}>
            <Metric label="Available" value={metrics.available} />
            <Metric label="Reserved" value={metrics.reserved} />
            <Metric label="Sold" value={metrics.sold} />
            <Metric label="Open transactions" value={metrics.openTransactions} />
          </section>

          <section className={styles.panel}>
            <div className={styles.panelHeading}><div><span className={styles.eyebrow}>Inventory & pricing</span><h2>Commercial catalog</h2></div><span>{catalog.length} unit types</span></div>
            <div className={styles.catalogGrid}>
              {catalog.map((item) => <article key={item.unitTypeId} className={styles.catalogCard}>
                <div><strong>{item.name}</strong><span>{item.code} · {item.indoorAreaSqm} m² indoor</span></div>
                <div className={styles.catalogStats}><span>{item.availableQuantity} available</span><span>{item.reservedQuantity} reserved</span><span>{item.soldQuantity} sold</span></div>
                <div className={styles.price}><span>Current</span><strong>{money(item.currentTotalPrice, item.currency)}</strong></div>
                {item.nextTotalPrice ? <small>Next {money(item.nextTotalPrice, item.currency)} · {item.nextPriceChangePercent ?? '—'}%</small> : <small>No scheduled price change</small>}
              </article>)}
            </div>
          </section>

          <section className={styles.panel}>
            <div className={styles.panelHeading}><div><span className={styles.eyebrow}>Transactions</span><h2>Buyer pipeline</h2></div><span>{transactions.length} records</span></div>
            <div className={styles.tableWrap}><table><thead><tr><th>Buyer</th><th>Unit type</th><th>Status</th><th>Progress</th><th>Value</th><th>Opened</th><th></th></tr></thead><tbody>
              {transactions.map((transaction) => <tr key={transaction.transactionId}>
                <td><strong>{transaction.buyerDisplayName}</strong><small>{transaction.buyerSource}{transaction.brokerCompanyName ? ` · ${transaction.brokerCompanyName}` : ''}</small></td>
                <td>{transaction.unitTypeName}<small>{transaction.unitTypeCode}</small></td>
                <td>{transaction.status.replaceAll('_', ' ')}</td>
                <td>{Number(transaction.completionPercent).toFixed(0)}%</td>
                <td>{money(transaction.quotedTotal, transaction.currency)}</td>
                <td>{new Date(transaction.openedAt).toLocaleDateString()}</td>
                <td><a href={`/workspace/transactions/${transaction.transactionId}?tenantId=${encodeURIComponent(tenantId)}&projectId=${encodeURIComponent(projectId)}`}>Inspect</a></td>
              </tr>)}
            </tbody></table></div>
            {transactions.length === 0 ? <div className={styles.empty}>No transactions in this project.</div> : null}
          </section>
        </> : null}
      </section>
    </main>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return <article className={styles.metric}><span>{label}</span><strong>{value}</strong></article>;
}

function shortId(value: string): string { return value ? `${value.slice(0, 8)}…` : '—'; }
function money(value: string | null, currency: string): string {
  if (value === null) return 'Not priced';
  const number = Number(value);
  return Number.isFinite(number) ? `${new Intl.NumberFormat().format(number)} ${currency}` : `${value} ${currency}`;
}
