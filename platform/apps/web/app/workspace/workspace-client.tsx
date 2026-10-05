'use client';

import {
  roleHasPermission,
  type PermissionCode,
  type WorkspaceContextSnapshot,
  type WorkspaceProjectSnapshot,
} from '@preneura/contracts/access';
import type { UnitTypeCommercialSnapshot } from '@preneura/contracts/catalog';
import type { UserNotificationSnapshot } from '@preneura/contracts/notifications';
import type { RealtimeSignal } from '@preneura/contracts/realtime';
import type {
  QueueEntrySnapshot,
  TransactionListItemSnapshot,
} from '@preneura/contracts/sales';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { ApiError, apiFetch, eventStreamUrl } from '../../lib/api';
import styles from './workspace.module.css';

type View = 'overview' | 'inventory' | 'queue' | 'transactions';
type LiveState = 'connecting' | 'live' | 'reconnecting' | 'offline';

type AuthMe = {
  userId: string;
  status: 'ACTIVE' | 'PENDING';
  expiresAt: string;
};

const projectStorageKey = 'preneura:selected-project';

export default function WorkspaceClient() {
  const [workspace, setWorkspace] = useState<WorkspaceContextSnapshot | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [catalog, setCatalog] = useState<UnitTypeCommercialSnapshot[]>([]);
  const [queue, setQueue] = useState<QueueEntrySnapshot[]>([]);
  const [transactions, setTransactions] = useState<TransactionListItemSnapshot[]>([]);
  const [notifications, setNotifications] = useState<UserNotificationSnapshot[]>([]);
  const [view, setView] = useState<View>('overview');
  const [liveState, setLiveState] = useState<LiveState>('connecting');
  const [lastSignalAt, setLastSignalAt] = useState<string | null>(null);
  const [loadingProject, setLoadingProject] = useState(false);
  const [bootstrapError, setBootstrapError] = useState('');
  const [projectError, setProjectError] = useState('');
  const [notificationOpen, setNotificationOpen] = useState(false);
  const projectLoadToken = useRef(0);

  const selectedProject = useMemo(
    () => workspace?.projects.find((project) => project.projectId === selectedProjectId) ?? null,
    [workspace, selectedProjectId],
  );

  const can = useCallback((project: WorkspaceProjectSnapshot | null, permission: PermissionCode): boolean => {
    if (!project) return false;
    return project.roles.some((role) => roleHasPermission(role, permission));
  }, []);

  const canReadInventory = can(selectedProject, 'inventory.read');
  const canReadPricing = can(selectedProject, 'pricing.read');
  const canReadQueue = can(selectedProject, 'queue.read');
  const canReadTransactions = can(selectedProject, 'transaction.read') || can(selectedProject, 'transaction.read.self');

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const me = await apiFetch<AuthMe>('/v1/auth/me');
        if (cancelled) return;
        if (me.status === 'PENDING') {
          window.location.replace('/access-pending');
          return;
        }
        const context = await apiFetch<WorkspaceContextSnapshot>('/v1/me/workspace');
        if (cancelled) return;
        if (context.projects.length === 0) {
          window.location.replace('/access-pending');
          return;
        }
        setWorkspace(context);
        const stored = window.localStorage.getItem(projectStorageKey);
        const initial = context.projects.some((project) => project.projectId === stored)
          ? stored!
          : context.projects[0]!.projectId;
        setSelectedProjectId(initial);
      } catch (error) {
        if (cancelled) return;
        if (error instanceof ApiError && error.status === 401) {
          window.location.replace('/login');
          return;
        }
        setBootstrapError(error instanceof Error ? error.message : 'Unable to load your workspace.');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const loadCatalog = useCallback(async (project: WorkspaceProjectSnapshot): Promise<UnitTypeCommercialSnapshot[]> => {
    if (!can(project, 'inventory.read')) return [];
    return apiFetch<UnitTypeCommercialSnapshot[]>(
      `/v1/tenants/${project.tenantId}/projects/${project.projectId}/catalog`,
    );
  }, [can]);

  const loadQueue = useCallback(async (project: WorkspaceProjectSnapshot): Promise<QueueEntrySnapshot[]> => {
    if (!can(project, 'queue.read')) return [];
    return apiFetch<QueueEntrySnapshot[]>(
      `/v1/tenants/${project.tenantId}/projects/${project.projectId}/queue`,
    );
  }, [can]);

  const loadTransactions = useCallback(async (project: WorkspaceProjectSnapshot): Promise<TransactionListItemSnapshot[]> => {
    if (!can(project, 'transaction.read') && !can(project, 'transaction.read.self')) return [];
    return apiFetch<TransactionListItemSnapshot[]>(
      `/v1/tenants/${project.tenantId}/projects/${project.projectId}/transactions`,
    );
  }, [can]);

  const refreshProject = useCallback(async (project: WorkspaceProjectSnapshot): Promise<void> => {
    const token = ++projectLoadToken.current;
    setLoadingProject(true);
    setProjectError('');
    try {
      const [nextCatalog, nextQueue, nextTransactions] = await Promise.all([
        loadCatalog(project),
        loadQueue(project),
        loadTransactions(project),
      ]);
      if (projectLoadToken.current !== token) return;
      setCatalog(nextCatalog);
      setQueue(nextQueue);
      setTransactions(nextTransactions);
    } catch (error) {
      if (projectLoadToken.current !== token) return;
      if (error instanceof ApiError && error.status === 401) {
        window.location.replace('/login');
        return;
      }
      setProjectError(error instanceof Error ? error.message : 'Unable to refresh project data.');
    } finally {
      if (projectLoadToken.current === token) setLoadingProject(false);
    }
  }, [loadCatalog, loadQueue, loadTransactions]);

  useEffect(() => {
    if (!selectedProject) return;
    window.localStorage.setItem(projectStorageKey, selectedProject.projectId);
    setCatalog([]);
    setQueue([]);
    setTransactions([]);
    void refreshProject(selectedProject);
  }, [selectedProject, refreshProject]);

  useEffect(() => {
    if (!selectedProject) return;
    const path = `/v1/tenants/${selectedProject.tenantId}/projects/${selectedProject.projectId}/events?after=0`;
    const source = new EventSource(eventStreamUrl(path), { withCredentials: true });
    setLiveState('connecting');

    const onSignal = (event: Event): void => {
      const message = event as MessageEvent<string>;
      try {
        const signal = JSON.parse(message.data) as RealtimeSignal;
        setLastSignalAt(new Date().toISOString());
        if (['CATALOG', 'INVENTORY', 'PRICING'].includes(signal.topic) && can(selectedProject, 'inventory.read')) {
          void loadCatalog(selectedProject).then(setCatalog).catch(() => undefined);
        }
        if (signal.topic === 'QUEUE' && can(selectedProject, 'queue.read')) {
          void loadQueue(selectedProject).then(setQueue).catch(() => undefined);
        }
        if (
          signal.topic === 'TRANSACTION' &&
          (can(selectedProject, 'transaction.read') || can(selectedProject, 'transaction.read.self'))
        ) {
          void loadTransactions(selectedProject).then(setTransactions).catch(() => undefined);
        }
      } catch {
        // Durable replay will supply the next valid signal.
      }
    };

    const onResync = (): void => {
      void refreshProject(selectedProject);
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
  }, [selectedProject, can, loadCatalog, loadQueue, loadTransactions, refreshProject]);

  useEffect(() => {
    let cancelled = false;
    void apiFetch<UserNotificationSnapshot[]>('/v1/me/notifications?after=0&limit=100')
      .then((items) => {
        if (!cancelled) setNotifications(items.slice().reverse());
      })
      .catch((error) => {
        if (error instanceof ApiError && error.status === 401) window.location.replace('/login');
      });

    const source = new EventSource(eventStreamUrl('/v1/me/notifications/events?after=0'), {
      withCredentials: true,
    });
    const onNotification = (event: Event): void => {
      try {
        const item = JSON.parse((event as MessageEvent<string>).data) as UserNotificationSnapshot;
        setNotifications((current) => [
          item,
          ...current.filter((existing) => existing.notificationId !== item.notificationId),
        ].slice(0, 100));
      } catch {
        // The durable inbox replay remains authoritative.
      }
    };
    const onResync = (): void => {
      void apiFetch<UserNotificationSnapshot[]>('/v1/me/notifications?after=0&limit=100')
        .then((items) => setNotifications(items.slice().reverse()))
        .catch(() => undefined);
    };
    source.addEventListener('notification', onNotification);
    source.addEventListener('resync_required', onResync);

    return () => {
      cancelled = true;
      source.removeEventListener('notification', onNotification);
      source.removeEventListener('resync_required', onResync);
      source.close();
    };
  }, []);

  async function markNotificationRead(notification: UserNotificationSnapshot): Promise<void> {
    if (notification.readAt) return;
    try {
      await apiFetch<{ read: true }>(`/v1/me/notifications/${notification.notificationId}/read`, {
        method: 'POST',
      });
      const readAt = new Date().toISOString();
      setNotifications((current) => current.map((item) =>
        item.notificationId === notification.notificationId ? { ...item, readAt } : item,
      ));
    } catch {
      // Keep the notification unread so the user can retry.
    }
  }

  async function logout(): Promise<void> {
    try {
      await apiFetch<{ loggedOut: true }>('/v1/auth/logout', { method: 'POST' });
    } finally {
      window.localStorage.removeItem(projectStorageKey);
      window.location.replace('/login');
    }
  }

  if (bootstrapError) {
    return (
      <main className={styles.centerState}>
        <div className={styles.stateCard}>
          <span className={styles.eyebrow}>Workspace unavailable</span>
          <h1>PRENEURA could not load your access context.</h1>
          <p>{bootstrapError}</p>
          <button type="button" onClick={() => window.location.reload()}>Try again</button>
        </div>
      </main>
    );
  }

  if (!workspace || !selectedProject) {
    return (
      <main className={styles.centerState}>
        <div className={styles.loadingMark}>P</div>
        <p>Loading secure workspace…</p>
      </main>
    );
  }

  const totals = catalog.reduce(
    (sum, unit) => ({
      available: sum.available + unit.availableQuantity,
      locked: sum.locked + unit.lockedQuantity,
      reserved: sum.reserved + unit.reservedQuantity,
      sold: sum.sold + unit.soldQuantity,
    }),
    { available: 0, locked: 0, reserved: 0, sold: 0 },
  );
  const queueActive = queue.filter((entry) => ['WAITING', 'CALLED', 'LOCKED'].includes(entry.status));
  const activeTransactions = transactions.filter((transaction) =>
    ['IN_PROGRESS', 'READY_FOR_COMPLETION'].includes(transaction.status),
  );
  const nextPriceMoves = catalog.filter((unit) => unit.nextPriceEffectiveAt && unit.nextPriceChangePercent);
  const unreadCount = notifications.filter((notification) => !notification.readAt).length;

  return (
    <main className={styles.shell}>
      <aside className={styles.sidebar}>
        <div className={styles.brandBlock}>
          <div className={styles.brandIcon}>P</div>
          <div>
            <strong>PRENEURA</strong>
            <span>Real Estate OS</span>
          </div>
        </div>

        <nav className={styles.nav} aria-label="Workspace navigation">
          <NavButton active={view === 'overview'} icon="grid" label="Overview" onClick={() => setView('overview')} />
          {canReadInventory ? (
            <NavButton active={view === 'inventory'} icon="building" label="Inventory" onClick={() => setView('inventory')} />
          ) : null}
          {canReadQueue ? (
            <NavButton active={view === 'queue'} icon="users" label="Queue" count={queueActive.length} onClick={() => setView('queue')} />
          ) : null}
          {canReadTransactions ? (
            <NavButton
              active={view === 'transactions'}
              icon="file"
              label="Transactions"
              count={activeTransactions.length}
              onClick={() => setView('transactions')}
            />
          ) : null}
        </nav>

        <div className={styles.sidebarFoot}>
          <span className={`${styles.liveDot} ${styles[liveState]}`} />
          <div>
            <strong>{liveLabel(liveState)}</strong>
            <span>{lastSignalAt ? `Last event ${relativeTime(lastSignalAt)}` : 'Server replay enabled'}</span>
          </div>
        </div>
      </aside>

      <section className={styles.mainColumn}>
        <header className={styles.topbar}>
          <div className={styles.projectSwitcher}>
            <label htmlFor="project-select">Project</label>
            <select
              id="project-select"
              value={selectedProject.projectId}
              onChange={(event) => setSelectedProjectId(event.target.value)}
            >
              {workspace.projects.map((project) => (
                <option key={project.projectId} value={project.projectId}>
                  {project.projectName} · {project.tenantName}
                </option>
              ))}
            </select>
            <span className={styles.projectStatus}>{selectedProject.projectStatus}</span>
          </div>

          <div className={styles.topActions}>
            <button
              type="button"
              className={styles.notificationButton}
              aria-label="Notifications"
              onClick={() => setNotificationOpen((open) => !open)}
            >
              <Icon name="bell" />
              {unreadCount > 0 ? <span className={styles.notificationCount}>{Math.min(unreadCount, 99)}</span> : null}
            </button>
            <div className={styles.userIdentity}>
              <div className={styles.avatar}>{initials(workspace.displayName)}</div>
              <div>
                <strong>{workspace.displayName}</strong>
                <span>{selectedProject.roles.map(formatRole).join(' · ')}</span>
              </div>
            </div>
            <button type="button" className={styles.logoutButton} onClick={() => void logout()}>
              Sign out
            </button>
          </div>
        </header>

        {notificationOpen ? (
          <NotificationPanel
            items={notifications}
            onClose={() => setNotificationOpen(false)}
            onRead={(item) => void markNotificationRead(item)}
          />
        ) : null}

        <div className={styles.content}>
          {projectError ? <div className={styles.errorBanner}>{projectError}</div> : null}
          {view === 'overview' ? (
            <Overview
              project={selectedProject}
              catalog={catalog}
              queue={queue}
              transactions={transactions}
              totals={totals}
              queueActive={queueActive}
              nextPriceMoves={nextPriceMoves}
              canReadPricing={canReadPricing}
              canReadQueue={canReadQueue}
              canReadTransactions={canReadTransactions}
              loading={loadingProject}
              onInventory={() => setView('inventory')}
              onQueue={() => setView('queue')}
              onTransactions={() => setView('transactions')}
            />
          ) : null}
          {view === 'inventory' && canReadInventory ? (
            <InventoryView
              project={selectedProject}
              catalog={catalog}
              canReadPricing={canReadPricing}
              loading={loadingProject}
            />
          ) : null}
          {view === 'queue' && canReadQueue ? (
            <QueueView queue={queue} loading={loadingProject} />
          ) : null}
          {view === 'transactions' && canReadTransactions ? (
            <TransactionsView project={selectedProject} transactions={transactions} loading={loadingProject} />
          ) : null}
        </div>
      </section>
    </main>
  );
}

function Overview(props: {
  project: WorkspaceProjectSnapshot;
  catalog: UnitTypeCommercialSnapshot[];
  queue: QueueEntrySnapshot[];
  transactions: TransactionListItemSnapshot[];
  totals: { available: number; locked: number; reserved: number; sold: number };
  queueActive: QueueEntrySnapshot[];
  nextPriceMoves: UnitTypeCommercialSnapshot[];
  canReadPricing: boolean;
  canReadQueue: boolean;
  canReadTransactions: boolean;
  loading: boolean;
  onInventory(): void;
  onQueue(): void;
  onTransactions(): void;
}) {
  const activeTransactions = props.transactions.filter((transaction) =>
    ['IN_PROGRESS', 'READY_FOR_COMPLETION'].includes(transaction.status),
  );
  return (
    <>
      <section className={styles.pageHeading}>
        <div>
          <span className={styles.eyebrow}>Live project operations</span>
          <h1>{props.project.projectName}</h1>
          <p>
            Server-authoritative inventory, pricing, queue and transaction state. Updates refresh automatically from the durable event stream.
          </p>
        </div>
        <div className={styles.contextTags}>
          <span>{props.project.projectCode}</span>
          <span>{props.project.currency}</span>
          <span>{props.project.timezone}</span>
        </div>
      </section>

      <section className={styles.metricGrid} aria-label="Project metrics">
        <Metric label="Available" value={props.totals.available} hint="units ready to allocate" />
        <Metric label="Locked" value={props.totals.locked} hint="temporary live holds" />
        <Metric label="Reserved" value={props.totals.reserved} hint="converted reservations" />
        <Metric label="Sold" value={props.totals.sold} hint="completed inventory" />
        {props.canReadQueue ? <Metric label="Queue" value={props.queueActive.length} hint="active buyers" /> : null}
        {props.canReadTransactions ? <Metric label="Transactions" value={activeTransactions.length} hint="active post-reservation cases" /> : null}
      </section>

      <section className={styles.twoColumn}>
        <div className={styles.panel}>
          <div className={styles.panelHeader}>
            <div>
              <span className={styles.eyebrow}>Inventory pulse</span>
              <h2>Unit types</h2>
            </div>
            <button type="button" onClick={props.onInventory}>View inventory</button>
          </div>
          {props.loading && props.catalog.length === 0 ? <SkeletonRows /> : (
            <div className={styles.compactList}>
              {props.catalog.slice(0, 6).map((unit) => (
                <div className={styles.compactRow} key={unit.unitTypeId}>
                  <div>
                    <strong>{unit.name}</strong>
                    <span>{unit.code} · {formatArea(unit.indoorAreaSqm)}</span>
                  </div>
                  <div className={styles.compactRight}>
                    <strong>{unit.availableQuantity} available</strong>
                    <span>
                      {props.canReadPricing && unit.currentTotalPrice
                        ? money(unit.currentTotalPrice, unit.currency)
                        : 'Price restricted'}
                    </span>
                  </div>
                </div>
              ))}
              {props.catalog.length === 0 && !props.loading ? <Empty text="No unit types are published for this project yet." /> : null}
            </div>
          )}
        </div>

        <div className={styles.panel}>
          <div className={styles.panelHeader}>
            <div>
              <span className={styles.eyebrow}>Attention</span>
              <h2>Operational pulse</h2>
            </div>
            {props.canReadTransactions ? <button type="button" onClick={props.onTransactions}>Transactions</button> : null}
          </div>
          <div className={styles.attentionStack}>
            {props.canReadQueue ? (
              <AttentionItem
                title={`${props.queueActive.filter((entry) => entry.status === 'WAITING').length} buyers waiting`}
                detail={`${props.queueActive.filter((entry) => entry.status === 'CALLED').length} called · ${props.queueActive.filter((entry) => entry.status === 'LOCKED').length} with active locks`}
              />
            ) : null}
            {props.canReadTransactions ? (
              <AttentionItem
                title={`${activeTransactions.length} active transactions`}
                detail={`${activeTransactions.filter((transaction) => transaction.status === 'READY_FOR_COMPLETION').length} ready for completion`}
              />
            ) : null}
            <AttentionItem
              title={`${props.nextPriceMoves.length} scheduled price moves`}
              detail={props.nextPriceMoves[0]?.nextPriceEffectiveAt
                ? `Next effective ${formatDateTime(props.nextPriceMoves[0].nextPriceEffectiveAt)}`
                : 'No known scheduled price changes'}
            />
            <AttentionItem
              title="Live updates enabled"
              detail="No manual page refresh is required. Event signals trigger authorized snapshot refetches."
            />
          </div>
        </div>
      </section>
    </>
  );
}

function InventoryView(props: {
  project: WorkspaceProjectSnapshot;
  catalog: UnitTypeCommercialSnapshot[];
  canReadPricing: boolean;
  loading: boolean;
}) {
  return (
    <>
      <section className={styles.pageHeading}>
        <div>
          <span className={styles.eyebrow}>Commercial catalog</span>
          <h1>Inventory</h1>
          <p>Availability is sold by unit type while exact physical slots remain server-managed.</p>
        </div>
      </section>
      {props.loading && props.catalog.length === 0 ? <SkeletonCards /> : (
        <section className={styles.inventoryGrid}>
          {props.catalog.map((unit) => (
            <article className={styles.inventoryCard} key={unit.unitTypeId}>
              <div className={styles.cardTopline}>
                <span>{unit.code}</span>
                <span className={unit.availableQuantity > 0 ? styles.availableBadge : styles.emptyBadge}>
                  {unit.availableQuantity > 0 ? 'Available' : 'Unavailable'}
                </span>
              </div>
              <h2>{unit.name}</h2>
              <div className={styles.areaLine}>
                <span>{unit.bedroomCount === null ? 'Flexible' : `${unit.bedroomCount} BR`}</span>
                <span>{formatArea(unit.indoorAreaSqm)} indoor</span>
                {Number(unit.gardenAreaSqm) > 0 ? <span>{formatArea(unit.gardenAreaSqm)} garden</span> : null}
                {Number(unit.roofAreaSqm) > 0 ? <span>{formatArea(unit.roofAreaSqm)} roof</span> : null}
              </div>
              <div className={styles.priceBlock}>
                <span>Current total</span>
                <strong>
                  {props.canReadPricing && unit.currentTotalPrice
                    ? money(unit.currentTotalPrice, unit.currency)
                    : 'Restricted'}
                </strong>
                <small>
                  {unit.currentPriceEffectiveAt ? `Effective ${formatDateTime(unit.currentPriceEffectiveAt)}` : 'No published price'}
                </small>
              </div>
              {props.canReadPricing && unit.nextPriceChangePercent && unit.nextPriceEffectiveAt ? (
                <div className={styles.priceMove}>
                  <strong>{signedPercent(unit.nextPriceChangePercent)} next price move</strong>
                  <span>{formatDateTime(unit.nextPriceEffectiveAt)}</span>
                </div>
              ) : null}
              <div className={styles.stockBar}>
                <Stock label="Available" value={unit.availableQuantity} />
                <Stock label="Locked" value={unit.lockedQuantity} />
                <Stock label="Reserved" value={unit.reservedQuantity} />
                <Stock label="Sold" value={unit.soldQuantity} />
              </div>
              <footer>
                Inventory updated {relativeTime(unit.inventoryUpdatedAt)}
              </footer>
            </article>
          ))}
          {props.catalog.length === 0 && !props.loading ? <Empty text="No inventory is available for this project." /> : null}
        </section>
      )}
    </>
  );
}

function QueueView(props: { queue: QueueEntrySnapshot[]; loading: boolean }) {
  const active = props.queue.filter((entry) => !['COMPLETED', 'LEFT', 'CANCELLED'].includes(entry.status));
  return (
    <>
      <section className={styles.pageHeading}>
        <div>
          <span className={styles.eyebrow}>Allocation control</span>
          <h1>Buyer queue</h1>
          <p>Priority and queue status come directly from the allocation service and update live.</p>
        </div>
      </section>
      <section className={styles.panel}>
        {props.loading && props.queue.length === 0 ? <SkeletonRows /> : (
          <div className={styles.queueTableWrap}>
            <table className={styles.queueTable}>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Buyer</th>
                  <th>Channel</th>
                  <th>Priority</th>
                  <th>Status</th>
                  <th>Checked in</th>
                </tr>
              </thead>
              <tbody>
                {active.map((entry, index) => (
                  <tr key={entry.queueEntryId}>
                    <td>{index + 1}</td>
                    <td><code>{shortId(entry.buyerProfileId)}</code></td>
                    <td>{formatToken(entry.channel)}</td>
                    <td>
                      <span className={styles.priorityBadge}>{formatToken(entry.priorityGroup)} · {entry.priorityScore}</span>
                    </td>
                    <td><span className={`${styles.statusBadge} ${styles[`status${entry.status}`]}`}>{formatToken(entry.status)}</span></td>
                    <td>{formatDateTime(entry.checkedInAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {active.length === 0 && !props.loading ? <Empty text="No buyers are currently active in the queue." /> : null}
          </div>
        )}
      </section>
    </>
  );
}

function TransactionsView(props: {
  project: WorkspaceProjectSnapshot;
  transactions: TransactionListItemSnapshot[];
  loading: boolean;
}) {
  return (
    <>
      <section className={styles.pageHeading}>
        <div>
          <span className={styles.eyebrow}>Post-reservation operations</span>
          <h1>Transactions</h1>
          <p>The server applies internal, broker-company, broker-agent or buyer-self scope before this list is returned.</p>
        </div>
      </section>
      <section className={styles.panel}>
        {props.loading && props.transactions.length === 0 ? <SkeletonRows /> : (
          <div className={styles.queueTableWrap}>
            <table className={styles.queueTable}>
              <thead>
                <tr>
                  <th>Transaction</th>
                  <th>Unit type</th>
                  <th>Buyer</th>
                  <th>Status</th>
                  <th>Progress</th>
                  <th>Contract value</th>
                  <th>Opened</th>
                </tr>
              </thead>
              <tbody>
                {props.transactions.map((transaction) => {
                  const href = `/workspace/transactions/${transaction.transactionId}?tenantId=${encodeURIComponent(props.project.tenantId)}&projectId=${encodeURIComponent(props.project.projectId)}`;
                  return (
                    <tr key={transaction.transactionId}>
                      <td>
                        <a href={href} style={{ color: 'inherit', textDecoration: 'none', fontWeight: 750 }}>
                          <code>{shortId(transaction.transactionId)}</code>
                        </a>
                      </td>
                      <td>
                        <strong className={styles.tablePrimary}>{transaction.unitTypeName}</strong>
                        <span className={styles.tableSecondary}>{transaction.unitTypeCode}</span>
                      </td>
                      <td>
                        <code>{shortId(transaction.buyerProfileId)}</code>
                        <span className={styles.tableSecondary}>{formatToken(transaction.buyerSource)}</span>
                      </td>
                      <td>
                        <span className={`${styles.statusBadge} ${transactionStatusClass(transaction.status, styles)}`}>
                          {formatToken(transaction.status)}
                        </span>
                      </td>
                      <td>
                        <div className={styles.progressCell}>
                          <div><span style={{ width: `${clampPercent(transaction.completionPercent)}%` }} /></div>
                          <strong>{clampPercent(transaction.completionPercent).toFixed(0)}%</strong>
                        </div>
                      </td>
                      <td>{transaction.quotedTotal ? money(transaction.quotedTotal, transaction.currency) : '—'}</td>
                      <td>{formatDateTime(transaction.openedAt)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {props.transactions.length === 0 && !props.loading ? <Empty text="No transactions are visible in your current project scope." /> : null}
          </div>
        )}
      </section>
    </>
  );
}

function NotificationPanel(props: {
  items: UserNotificationSnapshot[];
  onClose(): void;
  onRead(item: UserNotificationSnapshot): void;
}) {
  return (
    <aside className={styles.notificationPanel} aria-label="Notifications">
      <div className={styles.notificationHeader}>
        <div>
          <span className={styles.eyebrow}>Live inbox</span>
          <h2>Notifications</h2>
        </div>
        <button type="button" onClick={props.onClose} aria-label="Close notifications">×</button>
      </div>
      <div className={styles.notificationList}>
        {props.items.map((item) => (
          <button
            type="button"
            className={`${styles.notificationItem} ${item.readAt ? '' : styles.unread}`}
            key={item.notificationId}
            onClick={() => props.onRead(item)}
          >
            <span className={styles.notificationMarker} />
            <div>
              <strong>{notificationTitle(item)}</strong>
              <p>{notificationDetail(item)}</p>
              <small>{relativeTime(item.createdAt)}</small>
            </div>
          </button>
        ))}
        {props.items.length === 0 ? <Empty text="No notifications yet." /> : null}
      </div>
    </aside>
  );
}

function NavButton(props: {
  active: boolean;
  icon: IconName;
  label: string;
  count?: number;
  onClick(): void;
}) {
  return (
    <button type="button" className={props.active ? styles.navActive : ''} onClick={props.onClick}>
      <Icon name={props.icon} />
      <span>{props.label}</span>
      {props.count !== undefined && props.count > 0 ? <em>{props.count}</em> : null}
    </button>
  );
}

function Metric(props: { label: string; value: number; hint: string }) {
  return (
    <article className={styles.metricCard}>
      <span>{props.label}</span>
      <strong>{props.value.toLocaleString('en-US')}</strong>
      <small>{props.hint}</small>
    </article>
  );
}

function Stock(props: { label: string; value: number }) {
  return (
    <div>
      <span>{props.label}</span>
      <strong>{props.value}</strong>
    </div>
  );
}

function AttentionItem(props: { title: string; detail: string }) {
  return (
    <div className={styles.attentionItem}>
      <span />
      <div>
        <strong>{props.title}</strong>
        <p>{props.detail}</p>
      </div>
    </div>
  );
}

function Empty(props: { text: string }) {
  return <div className={styles.empty}>{props.text}</div>;
}

function SkeletonRows() {
  return (
    <div className={styles.skeletonStack} aria-label="Loading">
      {[0, 1, 2, 3].map((item) => <span key={item} />)}
    </div>
  );
}

function SkeletonCards() {
  return (
    <div className={styles.inventoryGrid} aria-label="Loading inventory">
      {[0, 1, 2].map((item) => <div className={styles.skeletonCard} key={item} />)}
    </div>
  );
}

type IconName = 'grid' | 'building' | 'users' | 'file' | 'bell';

function Icon({ name }: { name: IconName }) {
  const paths: Record<IconName, React.ReactNode> = {
    grid: <><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></>,
    building: <><path d="M4 21V5a2 2 0 0 1 2-2h8v18"/><path d="M14 9h4a2 2 0 0 1 2 2v10"/><path d="M2 21h20"/><path d="M8 7h2M8 11h2M8 15h2M17 13h1M17 17h1"/></>,
    users: <><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></>,
    file: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h6"/></>,
    bell: <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></>,
  };
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      {paths[name]}
    </svg>
  );
}

function formatRole(role: string): string {
  return role.toLowerCase().split('_').map(capitalize).join(' ');
}

function formatToken(value: string): string {
  return value.toLowerCase().split('_').map(capitalize).join(' ');
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return (parts[0]?.[0] ?? 'P') + (parts[1]?.[0] ?? '');
}

function shortId(value: string): string {
  return value.length > 10 ? `${value.slice(0, 6)}…${value.slice(-4)}` : value;
}

function formatArea(value: string): string {
  return `${Number(value).toLocaleString('en-US', { maximumFractionDigits: 2 })} m²`;
}

function money(value: string, currency: string): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(Number(value));
}

function signedPercent(value: string): string {
  const number = Number(value);
  const prefix = number > 0 ? '+' : '';
  return `${prefix}${number.toLocaleString('en-US', { maximumFractionDigits: 2 })}%`;
}

function clampPercent(value: string): number {
  return Math.max(0, Math.min(100, Number(value)));
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function relativeTime(value: string): string {
  const deltaSeconds = Math.round((new Date(value).getTime() - Date.now()) / 1000);
  const formatter = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  if (Math.abs(deltaSeconds) < 60) return formatter.format(deltaSeconds, 'second');
  const minutes = Math.round(deltaSeconds / 60);
  if (Math.abs(minutes) < 60) return formatter.format(minutes, 'minute');
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return formatter.format(hours, 'hour');
  return formatter.format(Math.round(hours / 24), 'day');
}

function liveLabel(state: LiveState): string {
  switch (state) {
    case 'live': return 'Live connected';
    case 'connecting': return 'Connecting';
    case 'reconnecting': return 'Reconnecting';
    case 'offline': return 'Replay available';
  }
}

function transactionStatusClass(
  status: TransactionListItemSnapshot['status'],
  styleMap: typeof styles,
): string {
  switch (status) {
    case 'IN_PROGRESS': return styleMap.statusIN_PROGRESS;
    case 'READY_FOR_COMPLETION': return styleMap.statusREADY_FOR_COMPLETION;
    case 'COMPLETED': return styleMap.statusCOMPLETED;
    case 'CANCELLED': return styleMap.statusCANCELLED;
  }
}

function notificationTitle(notification: UserNotificationSnapshot): string {
  const payload = notification.payload;
  if (payload.kind === 'MILESTONE_SLA') return 'Transaction milestone reminder';
  return notification.templateCode.split(/[._-]/).map(capitalize).join(' ');
}

function notificationDetail(notification: UserNotificationSnapshot): string {
  const payload = notification.payload;
  if (payload.kind === 'MILESTONE_SLA') {
    const milestone = typeof payload.milestoneCode === 'string' ? formatToken(payload.milestoneCode) : 'Milestone';
    const overdue = payload.overdue === true;
    return `${milestone}${overdue ? ' is overdue' : ' is approaching its SLA target'}.`;
  }
  return 'Open the relevant workspace view for the latest authorized state.';
}
