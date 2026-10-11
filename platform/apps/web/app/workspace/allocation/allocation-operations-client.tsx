'use client';

import {
  roleHasPermission,
  type PermissionCode,
  type WorkspaceContextSnapshot,
  type WorkspaceProjectSnapshot,
} from '@preneura/contracts/access';
import type { AllocationQueueEntrySnapshot } from '@preneura/contracts/allocation';
import type { InventoryLockResult, UnitTypeCommercialSnapshot } from '@preneura/contracts/catalog';
import type {
  EoiListItemSnapshot,
  QueueEntrySnapshot,
  ReservationResult,
} from '@preneura/contracts/sales';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ApiError, apiFetch, eventStreamUrl } from '../../lib/api';
import styles from './allocation-operations.module.css';

const projectStorageKey = 'preneura:selected-project';

type QueueChannel = 'ONSITE' | 'ONLINE' | 'BROKER';
type PriorityGroup = 'STANDARD' | 'VIP' | 'RECOVERY';

function can(project: WorkspaceProjectSnapshot | null, permission: PermissionCode): boolean {
  return Boolean(project?.roles.some((role) => roleHasPermission(role, permission)));
}

export default function AllocationOperationsClient() {
  const [workspace, setWorkspace] = useState<WorkspaceContextSnapshot | null>(null);
  const [projectId, setProjectId] = useState('');
  const [eois, setEois] = useState<EoiListItemSnapshot[]>([]);
  const [queue, setQueue] = useState<AllocationQueueEntrySnapshot[]>([]);
  const [catalog, setCatalog] = useState<UnitTypeCommercialSnapshot[]>([]);
  const [selectedEoiId, setSelectedEoiId] = useState('');
  const [selectedQueueId, setSelectedQueueId] = useState('');
  const [selectedUnitTypeId, setSelectedUnitTypeId] = useState('');
  const [channel, setChannel] = useState<QueueChannel>('ONSITE');
  const [priorityGroup, setPriorityGroup] = useState<PriorityGroup>('STANDARD');
  const [priorityScore, setPriorityScore] = useState('0');
  const [ttlSeconds, setTtlSeconds] = useState('180');
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [clock, setClock] = useState(() => Date.now());

  const project = useMemo(
    () => workspace?.projects.find((item) => item.projectId === projectId) ?? null,
    [workspace, projectId],
  );
  const selectedEoi = useMemo(
    () => eois.find((item) => item.eoiId === selectedEoiId) ?? null,
    [eois, selectedEoiId],
  );
  const selectedQueue = useMemo(
    () => queue.find((item) => item.queueEntryId === selectedQueueId) ?? null,
    [queue, selectedQueueId],
  );

  const canReadEois = can(project, 'eoi.read');
  const canCheckIn = can(project, 'queue.checkin');
  const canCallNext = can(project, 'queue.manage');
  const canAllocate = can(project, 'allocation.assist') && can(project, 'unit.lock');
  const canReadInventory = can(project, 'inventory.read');

  useEffect(() => {
    let cancelled = false;
    void apiFetch<WorkspaceContextSnapshot>('/v1/me/workspace')
      .then((context) => {
        if (cancelled) return;
        const eligible = context.projects.filter((candidate) => candidate.roles.some((role) =>
          roleHasPermission(role, 'queue.read') ||
          roleHasPermission(role, 'queue.checkin') ||
          roleHasPermission(role, 'allocation.assist'),
        ));
        if (eligible.length === 0) {
          setError('Your account does not have Sales Center or allocation access.');
          setWorkspace(context);
          return;
        }
        setWorkspace({ ...context, projects: eligible });
        const stored = window.localStorage.getItem(projectStorageKey);
        setProjectId(eligible.some((candidate) => candidate.projectId === stored)
          ? stored!
          : eligible[0]!.projectId);
      })
      .catch((reason) => {
        if (reason instanceof ApiError && reason.status === 401) {
          window.location.replace('/login');
          return;
        }
        setError(reason instanceof Error ? reason.message : 'Unable to load allocation workspace.');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const refresh = useCallback(async (): Promise<void> => {
    if (!project) return;
    setError('');
    try {
      const [nextQueue, nextEois, nextCatalog] = await Promise.all([
        apiFetch<AllocationQueueEntrySnapshot[]>(
          `/v1/tenants/${project.tenantId}/projects/${project.projectId}/allocation/queue`,
        ),
        canReadEois
          ? apiFetch<EoiListItemSnapshot[]>(`/v1/tenants/${project.tenantId}/projects/${project.projectId}/eois`)
          : Promise.resolve([]),
        canReadInventory
          ? apiFetch<UnitTypeCommercialSnapshot[]>(`/v1/tenants/${project.tenantId}/projects/${project.projectId}/catalog`)
          : Promise.resolve([]),
      ]);
      setQueue(nextQueue);
      setEois(nextEois);
      setCatalog(nextCatalog);

      if (selectedQueueId && !nextQueue.some((item) => item.queueEntryId === selectedQueueId)) {
        setSelectedQueueId('');
      }
      if (selectedEoiId && !nextEois.some((item) => item.eoiId === selectedEoiId)) {
        setSelectedEoiId('');
      }
    } catch (reason) {
      if (reason instanceof ApiError && reason.status === 401) {
        window.location.replace('/login');
        return;
      }
      setError(reason instanceof Error ? reason.message : 'Unable to refresh allocation state.');
    }
  }, [project, canReadEois, canReadInventory, selectedQueueId, selectedEoiId]);

  useEffect(() => {
    if (!project) return;
    window.localStorage.setItem(projectStorageKey, project.projectId);
    setSelectedEoiId('');
    setSelectedQueueId('');
    setSelectedUnitTypeId('');
    void refresh();
  }, [project, refresh]);

  useEffect(() => {
    if (!project) return;
    const source = new EventSource(
      eventStreamUrl(`/v1/tenants/${project.tenantId}/projects/${project.projectId}/events?after=0`),
      { withCredentials: true },
    );
    const onSignal = (): void => {
      void refresh();
    };
    source.addEventListener('domain_signal', onSignal);
    source.addEventListener('resync_required', onSignal);
    return () => {
      source.removeEventListener('domain_signal', onSignal);
      source.removeEventListener('resync_required', onSignal);
      source.close();
    };
  }, [project, refresh]);

  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  async function run(action: string, task: () => Promise<void>): Promise<void> {
    if (busy) return;
    setBusy(action);
    setError('');
    setMessage('');
    try {
      await task();
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Operation failed.');
    } finally {
      setBusy('');
    }
  }

  async function checkIn(): Promise<void> {
    if (!project || !selectedEoi || selectedEoi.status !== 'PAID') return;
    await run('checkin', async () => {
      await apiFetch<{ queueEntryId: string }>(
        `/v1/tenants/${project.tenantId}/projects/${project.projectId}/queue/check-in`,
        {
          method: 'POST',
          body: JSON.stringify({
            buyerProfileId: selectedEoi.buyerProfileId,
            eoiId: selectedEoi.eoiId,
            channel,
            priorityGroup,
            priorityScore: Number(priorityScore || 0),
          }),
        },
      );
      setMessage(`${selectedEoi.buyerDisplayName} checked in successfully.`);
      setSelectedEoiId('');
    });
  }

  async function callNext(): Promise<void> {
    if (!project) return;
    await run('call-next', async () => {
      const called = await apiFetch<QueueEntrySnapshot>(
        `/v1/tenants/${project.tenantId}/projects/${project.projectId}/queue/call-next`,
        { method: 'POST' },
      );
      setSelectedQueueId(called.queueEntryId);
      setMessage('Next eligible buyer called. Priority was selected by the server.');
    });
  }

  async function lockUnit(): Promise<void> {
    if (!project || !selectedQueue || !selectedUnitTypeId) return;
    await run('lock', async () => {
      const result = await apiFetch<InventoryLockResult>(
        `/v1/tenants/${project.tenantId}/projects/${project.projectId}/unit-types/${selectedUnitTypeId}/locks`,
        {
          method: 'POST',
          body: JSON.stringify({
            buyerUserId: selectedQueue.buyerUserId,
            ttlSeconds: Number(ttlSeconds || 180),
          }),
        },
      );
      setMessage(`Unit type locked until ${formatDateTime(result.expiresAt)}.`);
    });
  }

  async function releaseLock(): Promise<void> {
    if (!project || !selectedQueue?.activeLock) return;
    await run('release', async () => {
      await apiFetch<{ released: true }>(
        `/v1/tenants/${project.tenantId}/projects/${project.projectId}/locks/${selectedQueue.activeLock!.lockId}`,
        {
          method: 'DELETE',
          body: JSON.stringify({ reason: 'Released from Sales Center allocation workspace' }),
        },
      );
      setMessage('Active allocation lock released.');
    });
  }

  async function reserve(): Promise<void> {
    if (!project || !selectedQueue?.activeLock) return;
    await run('reserve', async () => {
      const result = await apiFetch<ReservationResult>(
        `/v1/tenants/${project.tenantId}/projects/${project.projectId}/reservations/from-lock`,
        {
          method: 'POST',
          body: JSON.stringify({
            buyerProfileId: selectedQueue.buyerProfileId,
            queueEntryId: selectedQueue.queueEntryId,
            lockId: selectedQueue.activeLock!.lockId,
          }),
        },
      );
      window.location.assign(
        `/workspace/transactions/${result.transactionId}?tenantId=${encodeURIComponent(project.tenantId)}&projectId=${encodeURIComponent(project.projectId)}`,
      );
    });
  }

  if (!workspace) {
    return <main className={styles.centerState}>{error || 'Loading Sales Center operations…'}</main>;
  }
  if (!project) {
    return (
      <main className={styles.centerState}>
        <a href="/workspace">Back to workspace</a>
        <p>{error || 'No authorized allocation project is available.'}</p>
      </main>
    );
  }

  const paidEois = eois.filter((item) => item.status === 'PAID');
  const waiting = queue.filter((item) => item.status === 'WAITING');
  const called = queue.filter((item) => item.status === 'CALLED' || item.status === 'LOCKED');
  const selectedLockRemaining = selectedQueue?.activeLock
    ? Math.max(0, Math.ceil((new Date(selectedQueue.activeLock.expiresAt).getTime() - clock) / 1000))
    : null;

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <a className={styles.back} href="/workspace">← Workspace</a>
          <span className={styles.eyebrow}>Role operations</span>
          <h1>Sales & Allocation Center</h1>
          <p>Buyer check-in, deterministic queue dispatch, recoverable unit-type locks and reservation handoff.</p>
        </div>
        <div className={styles.projectBox}>
          <label htmlFor="allocation-project">Project</label>
          <select id="allocation-project" value={project.projectId} onChange={(event) => setProjectId(event.target.value)}>
            {workspace.projects.map((item) => (
              <option key={item.projectId} value={item.projectId}>{item.projectName} · {item.tenantName}</option>
            ))}
          </select>
          <small>{project.roles.map(formatRole).join(' · ')}</small>
        </div>
      </header>

      {error ? <div className={styles.error}>{error}</div> : null}
      {message ? <div className={styles.success}>{message}</div> : null}

      <section className={styles.metrics}>
        <Metric label="Paid EOIs" value={paidEois.length} />
        <Metric label="Waiting" value={waiting.length} />
        <Metric label="Called" value={called.length} />
        <Metric label="Available capacity" value={catalog.reduce((total, item) => total + item.availableQuantity, 0)} />
      </section>

      <section className={styles.grid}>
        <article className={styles.panel}>
          <div className={styles.panelHeader}>
            <div>
              <span className={styles.eyebrow}>Reception</span>
              <h2>Check in paid EOI</h2>
            </div>
            {!canCheckIn ? <span className={styles.restricted}>Read only</span> : null}
          </div>
          <label>
            Buyer / EOI
            <select value={selectedEoiId} onChange={(event) => setSelectedEoiId(event.target.value)} disabled={!canCheckIn}>
              <option value="">Select paid EOI</option>
              {paidEois.map((item) => (
                <option key={item.eoiId} value={item.eoiId}>
                  {item.buyerDisplayName} · {item.amount} {item.currency} · {shortId(item.eoiId)}
                </option>
              ))}
            </select>
          </label>
          <div className={styles.formGrid}>
            <label>Channel
              <select value={channel} onChange={(event) => setChannel(event.target.value as QueueChannel)} disabled={!canCheckIn}>
                <option value="ONSITE">Onsite</option>
                <option value="ONLINE">Online</option>
                <option value="BROKER">Broker</option>
              </select>
            </label>
            <label>Priority group
              <select value={priorityGroup} onChange={(event) => setPriorityGroup(event.target.value as PriorityGroup)} disabled={!canCheckIn}>
                <option value="STANDARD">Standard</option>
                <option value="VIP">VIP</option>
                <option value="RECOVERY">Recovery</option>
              </select>
            </label>
            <label>Priority score
              <input type="number" min={-100000} max={100000} value={priorityScore} onChange={(event) => setPriorityScore(event.target.value)} disabled={!canCheckIn} />
            </label>
          </div>
          <button className={styles.primary} type="button" onClick={() => void checkIn()} disabled={!canCheckIn || !selectedEoi || busy !== ''}>
            {busy === 'checkin' ? 'Checking in…' : 'Check in buyer'}
          </button>
        </article>

        <article className={styles.panel}>
          <div className={styles.panelHeader}>
            <div>
              <span className={styles.eyebrow}>Queue dispatch</span>
              <h2>Call next eligible buyer</h2>
            </div>
            {!canCallNext ? <span className={styles.restricted}>Reception authority required</span> : null}
          </div>
          <p className={styles.help}>The server chooses VIP → Recovery → Standard, then score and check-in time. Operators cannot manually jump the queue.</p>
          <div className={styles.nextCard}>
            <strong>{waiting[0]?.buyerDisplayName ?? 'No buyer waiting'}</strong>
            <span>{waiting[0] ? `${formatToken(waiting[0].priorityGroup)} · checked in ${formatDateTime(waiting[0].checkedInAt)}` : 'Queue is clear.'}</span>
          </div>
          <button className={styles.primary} type="button" onClick={() => void callNext()} disabled={!canCallNext || waiting.length === 0 || busy !== ''}>
            {busy === 'call-next' ? 'Calling…' : 'Call next'}
          </button>
        </article>
      </section>

      <section className={styles.panel}>
        <div className={styles.panelHeader}>
          <div>
            <span className={styles.eyebrow}>Allocator</span>
            <h2>Called buyers & active locks</h2>
          </div>
          {!canAllocate ? <span className={styles.restricted}>Allocator authority required</span> : null}
        </div>
        <div className={styles.queueList}>
          {called.map((entry) => (
            <button
              type="button"
              key={entry.queueEntryId}
              className={`${styles.queueCard} ${selectedQueueId === entry.queueEntryId ? styles.selected : ''}`}
              onClick={() => setSelectedQueueId(entry.queueEntryId)}
            >
              <div>
                <strong>{entry.buyerDisplayName}</strong>
                <span>{formatToken(entry.channel)} · {formatToken(entry.priorityGroup)} · score {entry.priorityScore}</span>
              </div>
              <div>
                <strong>{entry.activeLock ? 'Locked' : formatToken(entry.status)}</strong>
                <span>{entry.activeLock ? `until ${formatDateTime(entry.activeLock.expiresAt)}` : `called ${entry.calledAt ? formatDateTime(entry.calledAt) : '—'}`}</span>
              </div>
            </button>
          ))}
          {called.length === 0 ? <p className={styles.empty}>No called buyer is awaiting allocation.</p> : null}
        </div>

        {selectedQueue ? (
          <div className={styles.allocationEditor}>
            <div>
              <span className={styles.eyebrow}>Selected buyer</span>
              <h3>{selectedQueue.buyerDisplayName}</h3>
              <p>{shortId(selectedQueue.queueEntryId)} · {formatToken(selectedQueue.status)}</p>
            </div>

            {selectedQueue.activeLock ? (
              <div className={styles.lockBox}>
                <div>
                  <span>Active lock</span>
                  <strong>{catalog.find((item) => item.unitTypeId === selectedQueue.activeLock?.unitTypeId)?.name ?? shortId(selectedQueue.activeLock.unitTypeId)}</strong>
                  <small>{selectedLockRemaining === 0 ? 'Expired — awaiting server reconciliation' : `${selectedLockRemaining}s remaining`}</small>
                </div>
                <div className={styles.buttonRow}>
                  <button type="button" className={styles.secondary} onClick={() => void releaseLock()} disabled={!canAllocate || busy !== ''}>Release</button>
                  <button type="button" className={styles.primary} onClick={() => void reserve()} disabled={!canAllocate || busy !== '' || selectedLockRemaining === 0}>
                    {busy === 'reserve' ? 'Reserving…' : 'Reserve & open transaction'}
                  </button>
                </div>
              </div>
            ) : (
              <div className={styles.lockCreator}>
                <label>Unit type
                  <select value={selectedUnitTypeId} onChange={(event) => setSelectedUnitTypeId(event.target.value)} disabled={!canAllocate}>
                    <option value="">Choose available type</option>
                    {catalog.filter((item) => item.availableQuantity > 0).map((item) => (
                      <option key={item.unitTypeId} value={item.unitTypeId}>
                        {item.name} · {item.availableQuantity} available{item.currentTotalPrice ? ` · ${money(item.currentTotalPrice, item.currency)}` : ''}
                      </option>
                    ))}
                  </select>
                </label>
                <label>Lock duration
                  <select value={ttlSeconds} onChange={(event) => setTtlSeconds(event.target.value)} disabled={!canAllocate}>
                    <option value="120">2 minutes</option>
                    <option value="180">3 minutes</option>
                    <option value="300">5 minutes</option>
                    <option value="600">10 minutes</option>
                    <option value="900">15 minutes</option>
                  </select>
                </label>
                <button type="button" className={styles.primary} onClick={() => void lockUnit()} disabled={!canAllocate || !selectedUnitTypeId || busy !== ''}>
                  {busy === 'lock' ? 'Locking…' : 'Lock unit type'}
                </button>
              </div>
            )}
          </div>
        ) : null}
      </section>
    </main>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return <article><span>{label}</span><strong>{value.toLocaleString('en-US')}</strong></article>;
}

function formatRole(value: string): string {
  return value.toLowerCase().split('_').map(capitalize).join(' ');
}
function formatToken(value: string): string {
  return value.toLowerCase().split('_').map(capitalize).join(' ');
}
function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
function shortId(value: string): string {
  return value.length > 12 ? `${value.slice(0, 7)}…${value.slice(-4)}` : value;
}
function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}
function money(value: string, currency: string): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 0 }).format(Number(value));
}
