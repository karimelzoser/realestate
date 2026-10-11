'use client';

import type {
  ExactAllocationContextSnapshot,
  ExactAllocationLockResult,
  ExactAllocationUnitSnapshot,
} from '@preneura/contracts/allocation';
import type { ExactReservationResult } from '@preneura/contracts/sales';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ApiError, apiFetch } from '../../../../lib/api';
import styles from './exact-allocation.module.css';

type Props = {
  queueEntryId: string;
  tenantId: string;
  projectId: string;
};

export default function ExactAllocationClient(props: Props) {
  const [context, setContext] = useState<ExactAllocationContextSnapshot | null>(null);
  const [selectedUnitId, setSelectedUnitId] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reservation, setReservation] = useState<ExactReservationResult | null>(null);
  const [now, setNow] = useState(Date.now());

  const basePath = useMemo(
    () => `/v1/tenants/${props.tenantId}/projects/${props.projectId}/queue/${props.queueEntryId}/allocation`,
    [props.tenantId, props.projectId, props.queueEntryId],
  );

  const load = useCallback(async (): Promise<void> => {
    if (!props.tenantId || !props.projectId || !props.queueEntryId) {
      setError('Missing project or allocation context. Open this page from the project queue.');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const next = await apiFetch<ExactAllocationContextSnapshot>(basePath);
      setContext(next);
      if (next.activeLock) setSelectedUnitId(next.activeLock.physicalUnitId);
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 401) {
        window.location.replace('/login');
        return;
      }
      setError(cause instanceof Error ? cause.message : 'Unable to load exact apartments for allocation.');
    } finally {
      setLoading(false);
    }
  }, [basePath, props.tenantId, props.projectId, props.queueEntryId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  async function lock(unit: ExactAllocationUnitSnapshot): Promise<void> {
    setBusy(true);
    setError('');
    try {
      const locked = await apiFetch<ExactAllocationLockResult>(`${basePath}/lock`, {
        method: 'POST',
        body: JSON.stringify({ physicalUnitId: unit.physicalUnitId, ttlSeconds: 180 }),
      });
      setSelectedUnitId(locked.physicalUnitId);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'This apartment could not be locked. Inventory has been refreshed.');
      await load().catch(() => undefined);
    } finally {
      setBusy(false);
    }
  }

  async function reserve(): Promise<void> {
    const activeLock = context?.activeLock;
    if (!activeLock || !context) return;
    setBusy(true);
    setError('');
    try {
      const result = await apiFetch<ExactReservationResult>(
        `/v1/tenants/${props.tenantId}/projects/${props.projectId}/reservations/from-lock`,
        {
          method: 'POST',
          body: JSON.stringify({
            buyerProfileId: context.buyerProfileId,
            queueEntryId: context.queueEntryId,
            lockId: activeLock.lockId,
          }),
        },
      );
      setReservation(result);
      setContext((current) => current ? { ...current, activeLock: null, units: [] } : current);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Reservation could not be completed.');
      await load().catch(() => undefined);
    } finally {
      setBusy(false);
    }
  }

  if (reservation) {
    const transactionHref = `/workspace/transactions/${reservation.transactionId}?tenantId=${encodeURIComponent(props.tenantId)}&projectId=${encodeURIComponent(props.projectId)}`;
    return (
      <main className={styles.page}>
        <section className={styles.successCard}>
          <span className={styles.eyebrow}>Reservation confirmed</span>
          <h1>{reservation.physicalUnitReference}</h1>
          <p>
            {reservation.buildingCode} · {reservation.floorCode} · {money(reservation.quotedTotal, reservation.currency)}
          </p>
          <div className={styles.successActions}>
            <a href={transactionHref}>Open transaction</a>
            <a className={styles.secondaryLink} href="/workspace">Return to workspace</a>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <a className={styles.backLink} href="/workspace">← Project workspace</a>
          <span className={styles.eyebrow}>Exact apartment allocation</span>
          <h1>{context ? context.eoiUnitTypeName : 'Loading allocation…'}</h1>
          <p>
            The EOI fixes the apartment type. This step selects and atomically locks one exact apartment from that type.
          </p>
        </div>
        {context ? (
          <div className={styles.contextBox}>
            <span>EOI type</span>
            <strong>{context.eoiUnitTypeCode}</strong>
            <small>Queue {shortId(context.queueEntryId)} · {context.queueStatus.toLowerCase()}</small>
          </div>
        ) : null}
      </header>

      {error ? <div className={styles.error}>{error}</div> : null}

      {context?.activeLock ? (
        <ActiveLockCard
          lock={context.activeLock}
          now={now}
          busy={busy}
          onReserve={() => void reserve()}
        />
      ) : null}

      <section className={styles.listHeader}>
        <div>
          <span className={styles.eyebrow}>Eligible exact inventory</span>
          <h2>Choose the apartment</h2>
        </div>
        <button type="button" onClick={() => void load()} disabled={loading || busy}>
          Refresh availability
        </button>
      </section>

      {loading && !context ? <div className={styles.loading}>Loading exact inventory…</div> : null}

      {context && context.units.length > 0 ? (
        <section className={styles.unitGrid}>
          {context.units.map((unit) => (
            <UnitCard
              key={unit.physicalUnitId}
              unit={unit}
              selected={selectedUnitId === unit.physicalUnitId}
              locked={Boolean(context.activeLock)}
              busy={busy}
              onLock={() => void lock(unit)}
            />
          ))}
        </section>
      ) : null}

      {context && context.units.length === 0 && !context.activeLock && !loading ? (
        <section className={styles.empty}>
          <h2>No exact apartments are currently available.</h2>
          <p>Availability may have changed live. Refresh or return to the queue without changing the buyer’s EOI type.</p>
        </section>
      ) : null}
    </main>
  );
}

function ActiveLockCard(props: {
  lock: ExactAllocationLockResult;
  now: number;
  busy: boolean;
  onReserve(): void;
}) {
  const remaining = Math.max(0, Math.ceil((new Date(props.lock.expiresAt).getTime() - props.now) / 1000));
  return (
    <section className={styles.lockCard}>
      <div>
        <span className={styles.eyebrow}>Exact apartment locked</span>
        <h2>{props.lock.displayReference ?? props.lock.internalReference}</h2>
        <p>{props.lock.buildingName} · {props.lock.floorName}</p>
      </div>
      <div className={styles.lockRight}>
        <strong>{formatCountdown(remaining)}</strong>
        <span>remaining</span>
        <button type="button" disabled={props.busy || remaining === 0} onClick={props.onReserve}>
          Convert to reservation
        </button>
      </div>
    </section>
  );
}

function UnitCard(props: {
  unit: ExactAllocationUnitSnapshot;
  selected: boolean;
  locked: boolean;
  busy: boolean;
  onLock(): void;
}) {
  return (
    <article className={`${styles.unitCard} ${props.selected ? styles.selected : ''}`}>
      <div className={styles.unitTop}>
        <div>
          <span>{props.unit.buildingCode} · {props.unit.floorCode}</span>
          <h3>{props.unit.displayReference ?? props.unit.internalReference}</h3>
        </div>
        <span className={styles.availableBadge}>Available now</span>
      </div>
      <dl className={styles.attributes}>
        <div><dt>Building</dt><dd>{props.unit.buildingName}</dd></div>
        <div><dt>Floor</dt><dd>{props.unit.floorName}</dd></div>
        <div><dt>Orientation</dt><dd>{humanize(props.unit.orientation)}</dd></div>
        <div><dt>View</dt><dd>{humanize(props.unit.viewCode)}</dd></div>
        <div><dt>Position</dt><dd>{humanize(props.unit.cornerPosition)}</dd></div>
        <div><dt>Inventory update</dt><dd>{formatDateTime(props.unit.inventoryUpdatedAt)}</dd></div>
      </dl>
      <div className={styles.priceLine}>
        <div>
          <span>Current certified type price</span>
          <strong>{money(props.unit.currentTotalPrice, props.unit.currency)}</strong>
          <small>Effective {formatDateTime(props.unit.priceEffectiveAt)}</small>
        </div>
        <button type="button" disabled={props.locked || props.busy} onClick={props.onLock}>
          {props.selected ? 'Locked' : 'Lock this apartment'}
        </button>
      </div>
    </article>
  );
}

function money(value: string | null, currency: string): string {
  if (value === null) return '—';
  return new Intl.NumberFormat('en-EG', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(Number(value));
}

function humanize(value: string | null): string {
  if (!value) return '—';
  return value.toLowerCase().split('_').map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ');
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat('en-EG', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function formatCountdown(seconds: number): string {
  const minutes = Math.floor(seconds / 60).toString().padStart(2, '0');
  const remainder = (seconds % 60).toString().padStart(2, '0');
  return `${minutes}:${remainder}`;
}

function shortId(value: string): string {
  return value.length > 12 ? `${value.slice(0, 6)}…${value.slice(-4)}` : value;
}
