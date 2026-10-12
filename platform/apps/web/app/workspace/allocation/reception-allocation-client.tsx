'use client';

import { roleHasPermission, type WorkspaceContextSnapshot } from '@preneura/contracts/access';
import type { AllocationSessionSnapshot } from '@preneura/contracts/allocation';
import type { EoiListItemSnapshot, QueueEntrySnapshot, ReservationResult } from '@preneura/contracts/sales';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ApiError, apiFetch } from '../../lib/api';
import styles from './allocation.module.css';
import ExactApartmentSelection from './exact-apartment-selection';
import { useLocale } from '../../locale-provider';
import { allocationMessages } from '../../../lib/allocation-messages';

const projectStorageKey = 'preneura:selected-project';

type ActiveRole = 'RECEPTION' | 'ALLOCATOR';

export default function ReceptionAllocationClient() {
  const { locale,formatAmount }=useLocale();
  const copy=allocationMessages[locale];
  const stateRequest=useRef(0);
  const [workspace, setWorkspace] = useState<WorkspaceContextSnapshot | null>(null);
  const [projectId, setProjectId] = useState('');
  const [role, setRole] = useState<ActiveRole>('RECEPTION');
  const [queue, setQueue] = useState<QueueEntrySnapshot[]>([]);
  const [eois, setEois] = useState<EoiListItemSnapshot[]>([]);
  const [allocation, setAllocation] = useState<AllocationSessionSnapshot | null>(null);
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const eligibleProjects = useMemo(() => workspace?.projects.filter((project) =>
    project.roles.some((projectRole) =>
      roleHasPermission(projectRole, 'queue.manage') || projectRole === 'ALLOCATOR',
    ),
  ) ?? [], [workspace]);
  const project = eligibleProjects.find((candidate) => candidate.projectId === projectId) ?? null;
  const canReception = Boolean(project?.roles.some((projectRole) => roleHasPermission(projectRole, 'queue.manage')));
  const canAllocate = Boolean(project?.roles.some((projectRole) => projectRole === 'ALLOCATOR'));

  const buyerName = useCallback((buyerProfileId: string) =>
    eois.find((eoi) => eoi.buyerProfileId === buyerProfileId)?.buyerDisplayName ?? copy.buyer, [eois,copy.buyer]);

  const liveBuyerIds = useMemo(() => new Set(
    queue.filter((entry) => ['WAITING', 'CALLED', 'LOCKED'].includes(entry.status)).map((entry) => entry.buyerProfileId),
  ), [queue]);
  const paidCheckInCandidates = useMemo(() =>
    eois.filter((eoi) => eoi.selectedUnitTypeId && eoi.status === 'PAID' && !liveBuyerIds.has(eoi.buyerProfileId)),
  [eois, liveBuyerIds]);

  const loadOperationalState = useCallback(async (tenantId: string, selectedProjectId: string, reception: boolean, allocator: boolean) => {
    const request=++stateRequest.current;
    const path=`/v1/tenants/${tenantId}/projects/${selectedProjectId}`;
    const [entries,paidEois,current]=await Promise.all([
      reception||allocator ? apiFetch<QueueEntrySnapshot[]>(`${path}/queue`) : Promise.resolve([]),
      reception||allocator ? apiFetch<EoiListItemSnapshot[]>(`${path}/eois`) : Promise.resolve([]),
      allocator ? apiFetch<AllocationSessionSnapshot|null>(`${path}/allocation/session`) : Promise.resolve(null),
    ]);
    if(request!==stateRequest.current)return;
    setQueue(entries);setEois(paidEois);setAllocation(current);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void apiFetch<WorkspaceContextSnapshot>('/v1/me/workspace')
      .then((context) => {
        if (cancelled) return;
        const eligible = context.projects.filter((candidate) => candidate.roles.some((projectRole) =>
          roleHasPermission(projectRole, 'queue.manage') || projectRole === 'ALLOCATOR',
        ));
        setWorkspace(context);
        if (eligible.length === 0) {
          setError(copy.failed);
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
        setError(copy.failed);
        setLoading(false);
      });
    return () => { cancelled = true; stateRequest.current++; };
  }, []);

  useEffect(() => {
    if (!project) return;
    window.localStorage.setItem(projectStorageKey, project.projectId);
    const reception = project.roles.some((projectRole) => roleHasPermission(projectRole, 'queue.manage'));
    const allocator = project.roles.some((projectRole) => projectRole === 'ALLOCATOR');
    if (!reception && allocator) setRole('ALLOCATOR');
    if (role === 'RECEPTION' && !reception && allocator) setRole('ALLOCATOR');
    if (role === 'ALLOCATOR' && !allocator && reception) setRole('RECEPTION');
    let cancelled = false;
    setLoading(true);
    setError('');
    void loadOperationalState(project.tenantId, project.projectId, reception, allocator)
      .catch((reason: unknown) => { if (!cancelled) setError(copy.failed); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; stateRequest.current++; };
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
      setMessage(`${eoi.buyerDisplayName} · ${copy.checkedInNotice}`);
      await refresh();
    } catch (reason) { setError(copy.failed); }
    finally { setBusy(''); }
  }

  async function callNext(): Promise<void> {
    if (!project || !canReception) return;
    setBusy('call-next'); setError(''); setMessage('');
    try {
      const called = await apiFetch<QueueEntrySnapshot>(`/v1/tenants/${project.tenantId}/projects/${project.projectId}/queue/call-next`, { method: 'POST' });
      setMessage(`${buyerName(called.buyerProfileId)} · ${copy.calledNotice}`);
      await refresh();
    } catch (reason) { setError(copy.failed); }
    finally { setBusy(''); }
  }

  async function claimNext(): Promise<void> {
    if (!project || !canAllocate) return;
    setBusy('claim'); setError(''); setMessage('');
    try {
      const claimed = await apiFetch<AllocationSessionSnapshot>(`/v1/tenants/${project.tenantId}/projects/${project.projectId}/allocation/claim-next`, { method: 'POST' });
      setAllocation(claimed);
      setMessage(`${claimed.buyerDisplayName} · ${copy.claimedNotice}`);
      await refresh();
    } catch (reason) { setError(copy.failed); }
    finally { setBusy(''); }
  }

  async function releaseSelection(): Promise<void> {
    if (!project || !allocation?.allocationLockId) return;
    setBusy('release'); setError(''); setMessage('');
    try {
      await apiFetch(`/v1/tenants/${project.tenantId}/projects/${project.projectId}/locks/${allocation.allocationLockId}`, {
        method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ reason: 'Buyer changed selection' }),
      });
      setMessage(copy.released);
      await refresh();
    } catch (reason) { setError(copy.failed); }
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
      setMessage(`${copy.reserved} · ${shortId(result.transactionId)}`);
      setAllocation(null);
      await refresh();
    } catch (reason) { setError(copy.failed); }
    finally { setBusy(''); }
  }

  const waiting = queue.filter((entry) => entry.status === 'WAITING');
  const called = queue.filter((entry) => entry.status === 'CALLED');

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <a href="/workspace" className={styles.back}>{copy.workspace}</a>
          <p className={styles.eyebrow}>{copy.live}</p>
          <h1>{copy.title}</h1>
          <p className={styles.subtitle}>{copy.subtitle}</p>
        </div>
        <div className={styles.headerControls}>
          {eligibleProjects.length > 1 ? <select value={projectId} onChange={(event) => setProjectId(event.target.value)}>{eligibleProjects.map((candidate) => <option key={candidate.projectId} value={candidate.projectId}>{candidate.projectName}</option>)}</select> : null}
          {canReception && canAllocate ? <div className={styles.roleSwitch}><button className={role === 'RECEPTION' ? styles.active : ''} onClick={() => setRole('RECEPTION')}>{copy.reception}</button><button className={role === 'ALLOCATOR' ? styles.active : ''} onClick={() => setRole('ALLOCATOR')}>{copy.allocator}</button></div> : null}
        </div>
      </header>

      {message ? <div className={styles.success} role="status">{message}</div> : null}
      {error ? <div className={styles.error} role="alert">{error}</div> : null}
      {loading ? <div className={styles.loading}>{copy.loading}</div> : null}

      {!loading && role === 'RECEPTION' && canReception ? (
        <>
          <section className={styles.metrics}>
            <Metric label={copy.waiting} value={waiting.length} />
            <Metric label={copy.called} value={called.length} />
            <Metric label={copy.eligible} value={paidCheckInCandidates.length} />
            <Metric label={copy.locked} value={queue.filter((entry) => entry.status === 'LOCKED').length} />
          </section>
          <section className={styles.split}>
            <div className={styles.panel}>
              <div className={styles.panelHead}><div><p className={styles.sectionLabel}>{copy.queue}</p><h2>{copy.sharedQueue}</h2></div><button className={styles.primary} disabled={busy === 'call-next' || waiting.length === 0} onClick={() => void callNext()}>{busy === 'call-next' ? copy.calling : copy.callNext}</button></div>
              <div className={styles.list}>{queue.filter((entry) => ['WAITING', 'CALLED', 'LOCKED'].includes(entry.status)).map((entry, index) => (
                <div className={styles.queueRow} key={entry.queueEntryId}>
                  <span className={styles.position}>{index + 1}</span>
                  <div><strong>{buyerName(entry.buyerProfileId)}</strong><small>{allocationLabel(entry.priorityGroup,copy)} · {allocationLabel(entry.channel,copy)}</small></div>
                  <span className={`${styles.status} ${styles[entry.status.toLowerCase() as 'waiting' | 'called' | 'locked']}`}>{allocationLabel(entry.status,copy)}</span>
                </div>
              ))}{queue.length === 0 ? <p className={styles.empty}>{copy.noQueue}</p> : null}</div>
            </div>
            <div className={styles.panel}>
              <div className={styles.panelHead}><div><p className={styles.sectionLabel}>{copy.checkIn}</p><h2>{copy.paidEoi}</h2></div></div>
              <div className={styles.list}>{paidCheckInCandidates.map((eoi) => <div className={styles.candidate} key={eoi.eoiId}><div><strong>{eoi.buyerDisplayName}</strong><small>{formatAmount(eoi.amount, eoi.currency)} {copy.paidEoi}</small></div><button disabled={busy === `checkin:${eoi.eoiId}`} onClick={() => void checkIn(eoi)}>{busy === `checkin:${eoi.eoiId}` ? copy.checkingIn : copy.checkIn}</button></div>)}{paidCheckInCandidates.length === 0 ? <p className={styles.empty}>{copy.noEois}</p> : null}</div>
            </div>
          </section>
        </>
      ) : null}

      {!loading && role === 'ALLOCATOR' && canAllocate ? (
        <>
          <section className={styles.assignment}>
            <div><p className={styles.sectionLabel}>{copy.desk}</p><h2>{allocation ? allocation.buyerDisplayName : copy.noBuyer}</h2><p>{allocation ? `${allocationLabel(allocation.priorityGroup,copy)} · ${allocationLabel(allocation.channel,copy)} · ${allocationLabel(allocation.status,copy)}` : copy.claimHint}</p></div>
            {!allocation ? <button className={styles.primary} disabled={busy === 'claim'} onClick={() => void claimNext()}>{busy === 'claim' ? copy.claiming : copy.claim}</button> : allocation.lockExpiresAt ? <Countdown expiresAt={allocation.lockExpiresAt} serverTime={allocation.serverTime} /> : <span className={styles.ready}>{copy.ready}</span>}
          </section>

          {allocation ? <>
            {allocation.allocationLockId?<div className={styles.actions}>
              <button disabled={Boolean(busy)} onClick={()=>void releaseSelection()}>{copy.change}</button>
              <button className={styles.primary} disabled={Boolean(busy)||!allocation.lockPhysicalUnitId} onClick={()=>void reserve()}>{busy==='reserve'?copy.reserving:copy.reserve}</button>
            </div>:null}
            <ExactApartmentSelection key={`${projectId}:${allocation.queueEntryId}`} tenantId={project!.tenantId} projectId={projectId} session={allocation} onChanged={refresh}/>
          </>:null}
        </>
      ) : null}
    </main>
  );
}

function Metric({ label, value }: { label: string; value: number }) { return <div className={styles.metric}><span>{label}</span><strong>{value}</strong></div>; }

function Countdown({ expiresAt,serverTime }: { expiresAt: string;serverTime:string }) {
  const {locale,formatNumber}=useLocale();
  const copy=allocationMessages[locale];
  const [seconds, setSeconds] = useState(() => Math.max(0,Math.floor((Date.parse(expiresAt)-Date.parse(serverTime))/1000)));
  useEffect(() => {
    const observed=performance.now(),server=Date.parse(serverTime);
    const update=()=>setSeconds(Math.max(0,Math.floor((Date.parse(expiresAt)-server-(performance.now()-observed))/1000)));
    update();const timer=window.setInterval(update,1000);return()=>window.clearInterval(timer);
  }, [expiresAt,serverTime]);
  const minutes = Math.floor(seconds / 60); const remaining = seconds % 60;
  return <div className={styles.countdown}><span>{copy.expires}</span><strong><bdi>{formatNumber(minutes)}:{formatNumber(remaining,{minimumIntegerDigits:2,useGrouping:false})}</bdi></strong></div>;
}

function shortId(id: string): string { return id.slice(0, 8).toUpperCase(); }

function allocationLabel(value:string,copy:typeof allocationMessages.en):string {
  const labels:Record<string,string>={WAITING:copy.waiting,CALLED:copy.called,LOCKED:copy.locked,STANDARD:copy.standard,VIP:copy.vip,RECOVERY:copy.recovery,ONSITE:copy.onsite,ONLINE:copy.online,BROKER:copy.broker};
  return labels[value]??value;
}
