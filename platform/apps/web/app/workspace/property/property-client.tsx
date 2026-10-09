'use client';

import { roleHasPermission, type WorkspaceContextSnapshot } from '@preneura/contracts/access';
import type { BuyerPropertyPortfolioSnapshot, BuyerPropertySnapshot } from '@preneura/contracts/property';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ApiError, apiFetch, eventStreamUrl } from '../../lib/api';
import styles from './property.module.css';

const projectStorageKey = 'preneura:selected-project';

type LiveState = 'connecting' | 'live' | 'reconnecting' | 'offline';

export default function PropertyClient() {
  const [workspace, setWorkspace] = useState<WorkspaceContextSnapshot | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [portfolio, setPortfolio] = useState<BuyerPropertyPortfolioSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [liveState, setLiveState] = useState<LiveState>('connecting');

  const eligibleProjects = useMemo(() => workspace?.projects.filter((project) =>
    project.roles.some((role) => roleHasPermission(role, 'property.read.self')),
  ) ?? [], [workspace]);
  const selectedProject = eligibleProjects.find((project) => project.projectId === selectedProjectId) ?? null;

  const loadPortfolio = useCallback(async (tenantId: string, projectId: string) => {
    const data = await apiFetch<BuyerPropertyPortfolioSnapshot>(
      `/v1/tenants/${tenantId}/projects/${projectId}/me/properties`,
    );
    setPortfolio(data);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void apiFetch<WorkspaceContextSnapshot>('/v1/me/workspace')
      .then((context) => {
        if (cancelled) return;
        const projects = context.projects.filter((project) => project.roles.some((role) =>
          roleHasPermission(role, 'property.read.self'),
        ));
        if (projects.length === 0) {
          setError('My Property is available only for buyer accounts with project access.');
          setWorkspace(context);
          setLoading(false);
          return;
        }
        setWorkspace(context);
        const stored = window.localStorage.getItem(projectStorageKey);
        const initial = projects.some((project) => project.projectId === stored)
          ? stored!
          : projects[0]!.projectId;
        setSelectedProjectId(initial);
      })
      .catch((reason: unknown) => {
        if (cancelled) return;
        if (reason instanceof ApiError && reason.status === 401) {
          window.location.replace('/login');
          return;
        }
        setError(reason instanceof Error ? reason.message : 'Unable to load buyer workspace.');
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!selectedProject) return;
    let cancelled = false;
    window.localStorage.setItem(projectStorageKey, selectedProject.projectId);
    setLoading(true);
    setError('');
    void loadPortfolio(selectedProject.tenantId, selectedProject.projectId)
      .catch((reason: unknown) => {
        if (cancelled) return;
        setError(reason instanceof Error ? reason.message : 'Unable to load property information.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [selectedProject, loadPortfolio]);

  useEffect(() => {
    if (!selectedProject) return;
    const path = `/v1/tenants/${selectedProject.tenantId}/projects/${selectedProject.projectId}/events?after=0`;
    const source = new EventSource(eventStreamUrl(path), { withCredentials: true });
    setLiveState('connecting');

    const refresh = (): void => {
      void loadPortfolio(selectedProject.tenantId, selectedProject.projectId).catch(() => undefined);
    };
    const onSignal = (event: Event): void => {
      try {
        const signal = JSON.parse((event as MessageEvent<string>).data) as { topic?: string };
        if (['TRANSACTION', 'DOMAIN'].includes(signal.topic ?? '')) refresh();
      } catch {
        refresh();
      }
    };
    source.onopen = () => setLiveState('live');
    source.onerror = () => setLiveState(source.readyState === EventSource.CLOSED ? 'offline' : 'reconnecting');
    source.addEventListener('domain_signal', onSignal);
    source.addEventListener('resync_required', refresh);
    return () => {
      source.removeEventListener('domain_signal', onSignal);
      source.removeEventListener('resync_required', refresh);
      source.close();
    };
  }, [selectedProject, loadPortfolio]);

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <a className={styles.back} href="/workspace">← Workspace</a>
          <p className={styles.eyebrow}>BUYER PORTAL</p>
          <h1>My Property</h1>
          <p className={styles.subtitle}>Your purchase, executed contract and installment position from PRENEURA’s authoritative records.</p>
        </div>
        <div className={styles.headerActions}>
          <span className={styles.live} data-state={liveState}>{liveState === 'live' ? 'Live' : liveState}</span>
          {eligibleProjects.length > 1 ? (
            <label className={styles.projectPicker}>
              <span>Project</span>
              <select value={selectedProjectId} onChange={(event) => setSelectedProjectId(event.target.value)}>
                {eligibleProjects.map((project) => (
                  <option key={project.projectId} value={project.projectId}>{project.projectName}</option>
                ))}
              </select>
            </label>
          ) : null}
        </div>
      </header>

      {error ? <div className={styles.error}>{error}</div> : null}
      {loading ? <div className={styles.empty}>Loading your property records…</div> : null}
      {!loading && !error && portfolio?.properties.length === 0 ? (
        <section className={styles.empty}>
          <h2>No property transaction yet</h2>
          <p>Your EOI or queue journey may still be in progress. A property appears here after a reservation opens a transaction.</p>
          <a href="/workspace">Return to purchase workspace</a>
        </section>
      ) : null}

      <section className={styles.propertyGrid}>
        {portfolio?.properties.map((property) => <PropertyCard key={property.transactionId} property={property} />)}
      </section>
    </main>
  );
}

function PropertyCard({ property }: { property: BuyerPropertySnapshot }) {
  const finance = property.finance;
  const nextDue = finance?.nextDueAt ? new Date(finance.nextDueAt) : null;
  return (
    <article className={styles.propertyCard}>
      <div className={styles.propertyHero}>
        <div>
          <div className={styles.badgeRow}>
            <span className={styles.stateBadge}>{property.state === 'PROPERTY_ACTIVE' ? 'Property active' : 'Purchase in progress'}</span>
            <span className={styles.progressBadge}>{Math.round(Number(property.completionPercent))}% complete</span>
          </div>
          <p className={styles.projectName}>{property.projectName}</p>
          <h2>{property.unitTypeName}</h2>
          <p className={styles.unitCode}>{property.unitTypeCode}</p>
        </div>
        <div className={styles.priceBlock}>
          <span>Frozen purchase price</span>
          <strong>{money(property.quotedTotal, property.currency)}</strong>
        </div>
      </div>

      <div className={styles.progressTrack} aria-label={`${property.completionPercent}% purchase completion`}>
        <span style={{ width: `${Math.min(100, Math.max(0, Number(property.completionPercent)))}%` }} />
      </div>

      <div className={styles.summaryGrid}>
        <Summary label="Contract" value={property.contract ? 'Executed' : 'Pending execution'} tone={property.contract ? 'good' : 'neutral'} />
        <Summary label="Paid toward contract" value={finance ? money(finance.paidTowardContract, finance.currency) : 'Not scheduled'} />
        <Summary label="Remaining" value={finance ? money(finance.remainingContractAmount, finance.currency) : '—'} />
        <Summary label="Next due" value={finance?.nextDueAmount ? `${money(finance.nextDueAmount, finance.currency)} · ${date(nextDue)}` : 'No upcoming balance'} />
      </div>

      {finance && finance.overdueItemCount > 0 ? (
        <div className={styles.overdueBanner}>
          <strong>{finance.overdueItemCount} overdue item{finance.overdueItemCount === 1 ? '' : 's'}</strong>
          <span>{money(finance.overdueAmount, finance.currency)} outstanding overdue</span>
        </div>
      ) : null}

      {property.contract ? (
        <section className={styles.contractProof}>
          <div>
            <p className={styles.sectionLabel}>EXECUTED CONTRACT PROOF</p>
            <h3>Immutable execution record</h3>
          </div>
          <dl>
            <div><dt>Executed</dt><dd>{date(new Date(property.contract.executedAt))}</dd></div>
            <div><dt>Trust</dt><dd>{property.contract.objectTrustStatus === 'CLEAN' ? 'Certified clean' : 'Legacy evidence'}</dd></div>
            <div><dt>Template</dt><dd>v{property.contract.templateVersionNumber}</dd></div>
            <div><dt>Manifest hash</dt><dd className={styles.hash}>{property.contract.manifestSha256Hex}</dd></div>
          </dl>
        </section>
      ) : null}

      {finance ? (
        <section className={styles.installments}>
          <div className={styles.sectionHeading}>
            <div>
              <p className={styles.sectionLabel}>PAYMENT PLAN</p>
              <h3>Installments</h3>
            </div>
            <span>{finance.scheduleStatus}</span>
          </div>
          <div className={styles.installmentList}>
            {finance.installments.map((item) => (
              <div className={styles.installmentRow} key={item.paymentItemId}>
                <div className={styles.sequence}>#{item.sequenceNumber}</div>
                <div className={styles.installmentMain}>
                  <strong>{labelItemType(item.itemType)}</strong>
                  <span>Due {date(new Date(item.dueAt))}</span>
                </div>
                <div className={styles.installmentAmount}>
                  <strong>{money(item.remainingAmount, finance.currency)}</strong>
                  <span>of {money(item.amount, finance.currency)}</span>
                </div>
                <span className={styles.status} data-status={item.status}>{humanStatus(item.status)}</span>
              </div>
            ))}
          </div>
        </section>
      ) : (
        <div className={styles.noSchedule}>Payment schedule has not been activated yet.</div>
      )}

      <footer className={styles.cardFooter}>
        <span>Transaction {shortId(property.transactionId)}</span>
        <a href={`/workspace/transactions/${property.transactionId}?tenantId=${property.projectId ? '' : ''}`}>View transaction</a>
      </footer>
    </article>
  );
}

function Summary({ label, value, tone = 'neutral' }: { label: string; value: string; tone?: 'good' | 'neutral' }) {
  return <div className={styles.summary} data-tone={tone}><span>{label}</span><strong>{value}</strong></div>;
}

function money(value: string | null, currency: string): string {
  if (value === null) return 'Not quoted';
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return `${value} ${currency}`;
  return new Intl.NumberFormat('en-EG', { style: 'currency', currency, maximumFractionDigits: 2 }).format(parsed);
}

function date(value: Date | null): string {
  if (!value || Number.isNaN(value.getTime())) return '—';
  return new Intl.DateTimeFormat('en-EG', { day: '2-digit', month: 'short', year: 'numeric' }).format(value);
}

function shortId(value: string): string {
  return value.slice(0, 8).toUpperCase();
}

function labelItemType(value: BuyerPropertySnapshot['finance'] extends infer _T ? 'DOWN_PAYMENT' | 'INSTALLMENT' | 'FEE' : never): string {
  return value === 'DOWN_PAYMENT' ? 'Down payment' : value === 'INSTALLMENT' ? 'Installment' : 'Fee';
}

function humanStatus(value: string): string {
  return value.toLowerCase().replaceAll('_', ' ').replace(/^./, (letter) => letter.toUpperCase());
}
