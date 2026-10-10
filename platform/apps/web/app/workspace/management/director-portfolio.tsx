'use client';

import type { ManagementTenantOverviewSnapshot } from '@preneura/contracts/management';
import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../../lib/api';
import styles from './director-portfolio.module.css';

export interface DirectorPortfolioProps {
  tenantId: string;
  activeProjectId: string;
  enabled: boolean;
  onSelectProject: (projectId: string) => void;
}

export default function DirectorPortfolio({
  tenantId,
  activeProjectId,
  enabled,
  onSelectProject,
}: DirectorPortfolioProps) {
  const [snapshot, setSnapshot] = useState<ManagementTenantOverviewSnapshot | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!enabled || !tenantId) return;
    try {
      setError('');
      setSnapshot(await apiFetch<ManagementTenantOverviewSnapshot>(
        `/v1/tenants/${tenantId}/management/overview`,
      ));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to load tenant portfolio.');
    }
  }, [enabled, tenantId]);

  useEffect(() => {
    if (!enabled) {
      setSnapshot(null);
      setError('');
      return;
    }
    void load();
    const timer = window.setInterval(() => void load(), 30_000);
    return () => window.clearInterval(timer);
  }, [enabled, load]);

  if (!enabled) return null;

  return (
    <section className={styles.portfolio}>
      <div className={styles.head}>
        <div>
          <p>OPERATIONS DIRECTOR</p>
          <h2>Cross-project governance</h2>
          <span>Tenant-wide operational posture. Monetary exposure remains project/currency specific below.</span>
        </div>
        <button onClick={() => void load()}>Refresh portfolio</button>
      </div>

      {error ? <div className={styles.error}>{error}</div> : null}
      {!snapshot ? <div className={styles.loading}>Loading tenant portfolio…</div> : (
        <>
          <div className={styles.metrics}>
            <Metric label="Projects" value={snapshot.totals.projectCount} detail={`${snapshot.totals.activeProjects} active`} />
            <Metric label="Available capacity" value={snapshot.totals.availableCapacity} detail="Across all projects" />
            <Metric label="Queue waiting" value={snapshot.totals.queueWaiting} detail="Across all projects" />
            <Metric label="Open transactions" value={snapshot.totals.openTransactions} detail={`${snapshot.totals.readyForCompletion} ready to complete`} />
            <Metric label="Overdue items" value={snapshot.totals.overdueItems} detail="Amounts remain per-project/currency" />
            <Metric label="Commission overdue" value={snapshot.totals.commissionOverdueCases} detail="Cases across portfolio" />
            <Metric label="Delivery failures" value={snapshot.totals.failedNotifications} detail="Failed notification jobs" />
          </div>

          <div className={styles.projects}>
            {snapshot.projects.map((project) => (
              <button
                key={project.projectId}
                type="button"
                className={project.projectId === activeProjectId ? styles.activeProject : styles.project}
                onClick={() => onSelectProject(project.projectId)}
              >
                <div>
                  <strong>{project.projectName}</strong>
                  <span>{project.projectCode} · {project.projectStatus}</span>
                </div>
                <dl>
                  <div><dt>Available</dt><dd>{project.overview.inventory.available}</dd></div>
                  <div><dt>Open tx</dt><dd>{project.overview.transactions.open}</dd></div>
                  <div><dt>Overdue items</dt><dd>{project.overview.finance.overdueItems}</dd></div>
                  <div><dt>Commission overdue</dt><dd>{project.overview.commissions.overdue}</dd></div>
                  <div><dt>Delivery failed</dt><dd>{project.overview.notifications.failed}</dd></div>
                </dl>
                <small>Financial values use {project.overview.currency}; open project for exact amounts.</small>
              </button>
            ))}
          </div>

          <small className={styles.generated}>Portfolio snapshot {new Date(snapshot.generatedAt).toLocaleString()}</small>
        </>
      )}
    </section>
  );
}

function Metric({ label, value, detail }: { label: string; value: number; detail: string }) {
  return (
    <article>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </article>
  );
}
