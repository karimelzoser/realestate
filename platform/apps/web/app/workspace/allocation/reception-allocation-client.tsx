'use client';

import { roleHasPermission, type WorkspaceContextSnapshot } from '@preneura/contracts/access';
import type { AllocationSessionSnapshot, AssignedAllocationLockSnapshot } from '@preneura/contracts/allocation';
import type { UnitTypeCommercialSnapshot } from '@preneura/contracts/catalog';
import type { EoiListItemSnapshot, QueueEntrySnapshot, ReservationResult } from '@preneura/contracts/sales';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ApiError, apiFetch } from '../../lib/api';
import styles from './allocation.module.css';

const projectStorageKey = 'preneura:selected-project';

type ActiveRole = 'RECEPTION' | 'ALLOCATOR';

export default function ReceptionAllocationClient() {
  const [workspace, setWorkspace] = useState<WorkspaceContextSnapshot | null>(null);
  const [projectId, setProjectId] = useState('');
  const [role, setRole] = useState<ActiveRole>('RECEPTION');
  const [queue, setQueue] = useState<QueueEntrySnapshot[]>([]);
  const [eois, setEois] = useState<EoiListItemSnapshot[]>([]);
  const [catalog, setCatalog] = useState<UnitTypeCommercialSnapshot[]>([]);
  const [allocation, setAllocation] = useState<AllocationSessionSnapshot | null>(null);
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const eligibleProjects = useMemo(() => workspace?.projects.filter((project) =>
    project.roles.some((projectRole) =>
      roleHasPermission(projectRole, 'queue.manage') || roleHasPermission(projectRole, 'allocation.assist'),
    ),
  ) ?? [], [workspace]);
  const project = eligibleProjects.find((candidate) => candidate.projectId === projectId) ?? null;
  const canReception = Boolean(project?.roles.some((projectRole) => roleHasPermission(projectRole, 'queue.manage')));
  const canAllocate = Boolean(project?.roles.some((projectRole) => roleHasPermission(projectRole, 'allocation.assist')));

  const buyerName = useCallback((buyerProfileId: string) =>
    eois.find((eoi) => eoi.buyerProfileId === buyerProfileId)?.buyerDisplayName ?? 'Buyer', [eois]);

  const liveBuyerIds = useMemo(() => new Set(
    queue.filter((entry) => ['WAITING', 'CALLED', 'LOCKED'].includes(entry.status)).map((entry) => entry.buyerProfileId),
  ), [queue]);
  const paidCheckInCandidates = useMemo(() =>
    eois.filter((eoi) => eoi.status === 'PAID' && !liveBuyerIds.has(eoi.buyerProfileId)),
  [eois, liveBuyerIds]);

  const loadOperationalState = useCallback(async (tenantId: string, selectedProjectId: string, reception: boolean, allocator: boolean) => {
    const tasks: Promise<void>[] = [];
    if (reception || allocator) {
      tasks.push(apiFetch<QueueEntrySnapshot[]>(`/v1/tenants/${tenantId}/projects/${selectedProjectId}/queue`).then(setQueue));
      tasks.push(apiFetch<EoiListItemSnapshot[]>(`/v1/tenants/${tenantId}/projects/${selectedProjectId}/eois`).then(setEois));
    }
    if (allocator) {
      tasks.push(apiFetch<UnitTypeCommercialSnapshot[]>(`/v1/tenants/${tenantId}/projects/${selectedProjectId}/catalog`).then(setCatalog));
      tasks.push(apiFetch<AllocationSessionSnapshot | null>(`/v1/tenants/${tenantId}/projects/${selectedProjectId}/allocation/session`).then(setAllocation));
    }
    await Promise.all(tasks);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void apiFetch<WorkspaceContextSnapshot>('/v1/me/workspace')
      .then((context) => {
        if (cancelled) return;
        const eligible = context.projects.filter((candidate) => candidate.roles.some((projectRole) =>
          roleHasPermission(projectRole, 'queue.manage') || roleHasPermission(projectRole, 'allocation.assist'),
        ));
        setWorkspace(context);
        if (eligible.length === 0) {
          setError('Reception and allocation operations are not available for this account.');
          setLoading(false);
          return;
        }
        const stored = window.localStorage.getItem(projectStorageKey);
        setProjectId(eligible.some((candidate) => candidate.projectId === stored) ? stored! : eligible[0]!.projectId);
      })
      .catch((reason: unknown) => {
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
    window.localStorage.setItem(projectStorageKey, project.projectId);
    const reception = project.roles.some((projectRole) => roleHasPermission(projectRole, 'queue.manage'));
    const allocator = project.roles.some((projectRole) => roleHasPermission(projectRole, 'allocation.assist'));
    if (!reception && allocator) setRole('ALLOCATOR');
    if (role === 'RECEPTION' && !reception && allocator) setRole('ALLOCATOR');
    if (role === 'ALLOCATOR' && !allocator && reception) setRole('RECEPTION');
    let cancelled = false;
    setLoading(true);
    setError('');
    void loadOperationalState(project.tenantId, project.projectId, reception, allocator)
      .catch((reason: unknown) => { if (!cancelled) setError(reason instanceof Error ? reason.message : 'Unable to load allocation operations.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [project, role, loadOperationalState]);

  useEffect(() => {
    if (!project) return;
    const timer = window.setInterval(() => {
      void loadOperationalState(project.tenantId, project.projectId, canReception, canAllocate).catch(() => undefined);
    }, 15000);
    return () => window.clearInterval(timer);
  }, [project, canReception, canAllocate, loadOperationalState]);

  async function refresh(): Promise<void> {
    if (!project) return;
    await loadOperationalState(project.tenantId, project.projectId, canReception, canAllocate);
  }

  async function checkIn(eoi: EoiListItemSnapshot): Promise<void> {
    if (!project || !canReception) return;
    setBusy(`checkin:${eoi.eoiId}`); setError(''); setMessage('');
    try {
      await apiFetch(`/v1/tenants/${project.tenantId}/projects/${project.projectId}/queue/check-in`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ buyerProfileId: eoi.buyerProfileId, eoiId: eoi.eoiId, channel: 'ONSITE', priorityGroup: 'STANDARD', priorityScore: 0 }),
      });
      setMessage(`${eoi.buyerDisplayName} checked in to the shared allocation queue.`);
      await refresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to check in buyer.'); }
    finally { setBusy(''); }
  }

  async function callNext(): Promise<void> {
    if (!project || !canReception) return;
    setBusy('call-next'); setError(''); setMessage('');
    try {
      const called = await apiFetch<QueueEntrySnapshot>(`/v1/tenants/${project.tenantId}/projects/${project.projectId}/queue/call-next`, { method: 'POST' });
      setMessage(`${buyerName(called.buyerProfileId)} is now called for allocation.`);
      await refresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to call next buyer.'); }
    finally { setBusy(''); }
  }

  async function claimNext(): Promise<void> {
    if (!project || !canAllocate) return;
    setBusy('claim'); setError(''); setMessage('');
    try {
      const claimed = await apiFetch<AllocationSessionSnapshot>(`/v1/tenants/${project.tenantId}/projects/${project.projectId}/allocation/claim-next`, { method: 'POST' });
      setAllocation(claimed);
      setMessage(`${claimed.buyerDisplayName} assigned to your allocation desk.`);
      await refresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to claim called buyer.'); }
    finally { setBusy(''); }
  }

  async function lockUnitType(unitType: UnitTypeCommercialSnapshot): Promise<void> {
    if (!project || !allocation || allocation.status !== 'CALLED') return;
    setBusy(`lock:${unitType.unitTypeId}`); setError(''); setMessage('');
    try {
      const lock = await apiFetch<AssignedAllocationLockSnapshot>(`/v1/tenants/${project.tenantId}/projects/${project.projectId}/allocation/locks`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ unitTypeId: unitType.unitTypeId, ttlSeconds: 900 }),
      });
      setMessage(`${unitType.name} held for ${allocation.buyerDisplayName}. The buyer has 15 minutes to proceed.`);
      setAllocation({ ...allocation, status: 'LOCKED', allocationLockId: lock.lockId, lockUnitTypeId: unitType.unitTypeId, lockExpiresAt: lock.expiresAt });
      await refresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to hold this unit type.'); }
    finally { setBusy(''); }
  }

  async function releaseSelection(): Promise<void> {
    if (!project || !allocation?.allocationLockId) return;
    setBusy('release'); setError(''); setMessage('');
    try {
      await apiFetch(`/v1/tenants/${project.tenantId}/projects/${project.projectId}/locks/${allocation.allocationLockId}`, {
        method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ reason: 'Buyer changed selection' }),
      });
      setMessage('Selection released. The same buyer remains assigned to your desk.');
      await refresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to release selection.'); }
    finally { setBusy(''); }
  }

  async function reserve(): Promise<void> {
    if (!project || !allocation?.allocationLockId) return;
    setBusy('reserve'); setError(''); setMessage('');
    try {
      const result = await apiFetch<ReservationResult>(`/v1/tenants/${project.tenantId}/projects/${project.projectId}/reservations/from-lock`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ buyerProfileId: allocation.buyerProfileId, queueEntryId: allocation.queueEntryId, lockId: allocation.allocationLockId }),
      });
      setMessage(`Reservation completed. Transaction ${shortId(result.transactionId)} opened at the frozen quote.`);
      setAllocation(null);
      await refresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to convert this hold to reservation.'); }
    finally { setBusy(''); }
  }

  const waiting = queue.filter((entry) => entry.status === 'WAITING');
  const called = queue.filter((entry) => entry.status === 'CALLED');

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <a href="/workspace" className={styles.back}>← Workspace</a>
          <p className={styles.eyebrow}>LIVE ALLOCATION</p>
          <h1>Reception & Allocation</h1>
          <p className={styles.subtitle}>Reception controls the shared queue. Allocators can only act on the buyer explicitly assigned to their desk.</p>
        </div>
        <div className={styles.headerControls}>
          {eligibleProjects.length > 1 ? <select value={projectId} onChange={(event) => setProjectId(event.target.value)}>{eligibleProjects.map((candidate) => <option key={candidate.projectId} value={candidate.projectId}>{candidate.projectName}</option>)}</select> : null}
          {canReception && canAllocate ? <div className={styles.roleSwitch}><button className={role === 'RECEPTION' ? styles.active : ''} onClick={() => setRole('RECEPTION')}>Reception</button><button className={role === 'ALLOCATOR' ? styles.active : ''} onClick={() => setRole('ALLOCATOR')}>Allocator</button></div> : null}
        </div>
      </header>

      {message ? <div className={styles.success}>{message}</div> : null}
      {error ? <div className={styles.error}>{error}</div> : null}
      {loading ? <div className={styles.loading}>Loading live allocation state…</div> : null}

      {!loading && role === 'RECEPTION' && canReception ? (
        <>
          <section className={styles.metrics}>
            <Metric label="Waiting" value={waiting.length} />
            <Metric label="Called" value={called.length} />
            <Metric label="Eligible check-ins" value={paidCheckInCandidates.length} />
            <Metric label="Locked" value={queue.filter((entry) => entry.status === 'LOCKED').length} />
          </section>
          <section className={styles.split}>
            <div className={styles.panel}>
              <div className={styles.panelHead}><div><p className={styles.sectionLabel}>QUEUE</p><h2>Shared waiting line</h2></div><button className={styles.primary} disabled={busy === 'call-next' || waiting.length === 0} onClick={() => void callNext()}>{busy === 'call-next' ? 'Calling…' : 'Call next'}</button></div>
              <div className={styles.list}>{queue.filter((entry) => ['WAITING', 'CALLED', 'LOCKED'].includes(entry.status)).map((entry, index) => <div className={styles.queueRow} key={entry.queueEntryId}><span className={styles.position}>{index + 1}</span><div><strong>{buyerName(entry.buyerProfileId)}</strong><small>{entry.priorityGroup} · {entry.channel}</small></div><span className={`${styles.status} ${styles[entry.status.toLowerCase() as 'waiting' | 'called' | 'locked']}`}>{entry.status}</span></div>)}{queue.length === 0 ? <p className={styles.empty}>No active queue entries.</p> : null}</div>
            </div>
            <div className={styles.panel}>
              <div className={styles.panelHead}><div><p className={styles.sectionLabel}>CHECK-IN</p><h2>Paid EOI buyers</h2></div></div>
              <div className={styles.list}>{paidCheckInCandidates.map((eoi) => <div className={styles.candidate} key={eoi.eoiId}><div><strong>{eoi.buyerDisplayName}</strong><small>{money(eoi.amount, eoi.currency)} EOI verified</small></div><button disabled={busy === `checkin:${eoi.eoiId}`} onClick={() => void checkIn(eoi)}>{busy === `checkin:${eoi.eoiId}` ? 'Checking in…' : 'Check in'}</button></div>)}{paidCheckInCandidates.length === 0 ? <p className={styles.empty}>No paid EOI is waiting for check-in.</p> : null}</div>
            </div>
          </section>
        </>
      ) : null}

      {!loading && role === 'ALLOCATOR' && canAllocate ? (
        <>
          <section className={styles.assignment}>
            <div><p className={styles.sectionLabel}>YOUR DESK</p><h2>{allocation ? allocation.buyerDisplayName : 'No buyer assigned'}</h2><p>{allocation ? `${allocation.priorityGroup} · ${allocation.channel} · ${allocation.status}` : 'Claim the next buyer already called by Reception.'}</p></div>
            {!allocation ? <button className={styles.primary} disabled={busy === 'claim'} onClick={() => void claimNext()}>{busy === 'claim' ? 'Claiming…' : 'Claim next called buyer'}</button> : allocation.lockExpiresAt ? <Countdown expiresAt={allocation.lockExpiresAt} /> : <span className={styles.ready}>Ready to select</span>}
          </section>

          {allocation ? <section className={styles.panel}><div className={styles.panelHead}><div><p className={styles.sectionLabel}>UNIT TYPES</p><h2>Live availability & price</h2></div>{allocation.allocationLockId ? <div className={styles.actions}><button disabled={busy === 'release'} onClick={() => void releaseSelection()}>Change selection</button><button className={styles.primary} disabled={busy === 'reserve'} onClick={() => void reserve()}>{busy === 'reserve' ? 'Reserving…' : 'Create reservation'}</button></div> : null}</div><div className={styles.cards}>{catalog.map((unitType) => { const selected = allocation.lockUnitTypeId === unitType.unitTypeId; return <article className={`${styles.unitCard} ${selected ? styles.selected : ''}`} key={unitType.unitTypeId}><div className={styles.unitTop}><div><small>{unitType.code}</small><h3>{unitType.name}</h3></div><span>{unitType.availableQuantity} available</span></div><dl><div><dt>Indoor</dt><dd>{unitType.indoorAreaSqm} m²</dd></div><div><dt>Garden</dt><dd>{unitType.gardenAreaSqm} m²</dd></div><div><dt>Roof</dt><dd>{unitType.roofAreaSqm} m²</dd></div></dl><strong className={styles.price}>{unitType.currentTotalPrice ? money(unitType.currentTotalPrice, unitType.currency) : 'Price unavailable'}</strong>{unitType.nextPriceChangePercent ? <p className={styles.priceAlert}>Upcoming price change {Number(unitType.nextPriceChangePercent) > 0 ? '+' : ''}{unitType.nextPriceChangePercent}%</p> : null}<button disabled={allocation.status !== 'CALLED' || unitType.availableQuantity === 0 || busy === `lock:${unitType.unitTypeId}`} onClick={() => void lockUnitType(unitType)}>{selected ? 'Selected' : busy === `lock:${unitType.unitTypeId}` ? 'Holding…' : 'Hold this type'}</button></article>; })}</div></section> : null}
        </>
      ) : null}
    </main>
  );
}

function Metric({ label, value }: { label: string; value: number }) { return <div className={styles.metric}><span>{label}</span><strong>{value}</strong></div>; }

function Countdown({ expiresAt }: { expiresAt: string }) {
  const [seconds, setSeconds] = useState(() => Math.max(0, Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000)));
  useEffect(() => { const timer = window.setInterval(() => setSeconds(Math.max(0, Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000))), 1000); return () => window.clearInterval(timer); }, [expiresAt]);
  const minutes = Math.floor(seconds / 60); const remaining = seconds % 60;
  return <div className={styles.countdown}><span>Hold expires</span><strong>{minutes}:{String(remaining).padStart(2, '0')}</strong></div>;
}

function money(amount: string, currency: string): string { const value = Number(amount); return Number.isFinite(value) ? new Intl.NumberFormat('en-EG', { style: 'currency', currency, maximumFractionDigits: 0 }).format(value) : `${amount} ${currency}`; }
function shortId(id: string): string { return id.slice(0, 8).toUpperCase(); }
