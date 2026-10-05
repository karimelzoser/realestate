'use client';

import type { RealtimeSignal } from '@preneura/contracts/realtime';
import type { TransactionTimelineEventSnapshot } from '@preneura/contracts/sales';
import { useCallback, useEffect, useState } from 'react';
import { ApiError, apiFetch, eventStreamUrl } from '../../../../lib/api';
import styles from './transaction-timeline-panel.module.css';

type Props = {
  transactionId: string;
  tenantId: string;
  projectId: string;
};

export default function TransactionTimelinePanel({ transactionId, tenantId, projectId }: Props) {
  const [events, setEvents] = useState<TransactionTimelineEventSnapshot[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [liveState, setLiveState] = useState<'connecting' | 'live' | 'reconnecting' | 'offline'>('connecting');

  const load = useCallback(async (background = false): Promise<void> => {
    if (!tenantId || !projectId || !transactionId) {
      setError('Timeline context is incomplete. Reopen the transaction from the workspace.');
      setLoading(false);
      return;
    }
    if (background) setRefreshing(true);
    else setLoading(true);
    setError('');
    try {
      const next = await apiFetch<TransactionTimelineEventSnapshot[]>(
        `/v1/tenants/${tenantId}/projects/${projectId}/transactions/${transactionId}/timeline`,
      );
      setEvents(next.slice().reverse());
    } catch (reason) {
      if (reason instanceof ApiError && reason.status === 401) {
        window.location.replace('/login');
        return;
      }
      setError(reason instanceof Error ? reason.message : 'Unable to load transaction activity.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [projectId, tenantId, transactionId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!tenantId || !projectId) return;
    const source = new EventSource(
      eventStreamUrl(`/v1/tenants/${tenantId}/projects/${projectId}/events?after=0`),
      { withCredentials: true },
    );
    setLiveState('connecting');

    const onSignal = (event: Event): void => {
      try {
        const signal = JSON.parse((event as MessageEvent<string>).data) as RealtimeSignal;
        if (['TRANSACTION', 'COMMISSION', 'REFUND', 'DOMAIN'].includes(signal.topic)) {
          void load(true);
        }
      } catch {
        // Durable replay remains authoritative; malformed client events are ignored.
      }
    };
    const onResync = (): void => {
      void load(true);
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
  }, [load, projectId, tenantId]);

  if (error && events.length === 0) {
    return (
      <section className={styles.panel}>
        <div className={styles.heading}>
          <div>
            <span>Audit trail</span>
            <h2>Transaction activity</h2>
          </div>
        </div>
        <div className={styles.error}>{error}</div>
      </section>
    );
  }

  return (
    <section className={styles.panel} aria-label="Transaction audit timeline">
      <div className={styles.heading}>
        <div>
          <span>Audit trail</span>
          <h2>Transaction activity</h2>
          <p>Append-only business events recorded by the server, newest first.</p>
        </div>
        <div className={styles.liveState}>
          <i className={`${styles.liveDot} ${styles[liveState]}`} />
          <span>{refreshing ? 'Refreshing' : liveLabel(liveState)}</span>
        </div>
      </div>

      {loading && events.length === 0 ? (
        <div className={styles.skeleton} aria-label="Loading transaction activity">
          <span />
          <span />
          <span />
        </div>
      ) : events.length === 0 ? (
        <div className={styles.empty}>No transaction activity has been recorded yet.</div>
      ) : (
        <div className={styles.timeline}>
          {events.map((item) => (
            <article className={styles.event} key={item.eventId}>
              <div className={styles.marker} />
              <div className={styles.eventBody}>
                <div className={styles.eventTop}>
                  <div>
                    <strong>{eventTitle(item.eventType)}</strong>
                    <span>{item.actorDisplayName ?? (item.actorUserId ? `User ${shortId(item.actorUserId)}` : 'System')}</span>
                  </div>
                  <time dateTime={item.createdAt}>{formatDateTime(item.createdAt)}</time>
                </div>
                <EventMetadata metadata={item.metadata} />
              </div>
            </article>
          ))}
        </div>
      )}
      {error && events.length > 0 ? <div className={styles.inlineError}>{error}</div> : null}
    </section>
  );
}

function EventMetadata({ metadata }: { metadata: Record<string, unknown> }) {
  const items = Object.entries(metadata)
    .filter(([, value]) => value !== null && value !== undefined && value !== '')
    .slice(0, 6);
  if (items.length === 0) return null;

  return (
    <div className={styles.metadata}>
      {items.map(([key, value]) => (
        <span key={key}>
          <b>{formatToken(key)}</b>
          <em>{metadataValue(value)}</em>
        </span>
      ))}
    </div>
  );
}

function metadataValue(value: unknown): string {
  if (typeof value === 'string') return value.length > 70 ? `${value.slice(0, 67)}…` : value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map((item) => metadataValue(item)).join(', ').slice(0, 70);
  if (value && typeof value === 'object') {
    const text = JSON.stringify(value);
    return text.length > 70 ? `${text.slice(0, 67)}…` : text;
  }
  return String(value);
}

function eventTitle(eventType: string): string {
  const overrides: Record<string, string> = {
    'reservation.created': 'Reservation created',
    'transaction.milestone.completed': 'Milestone completed',
    'finance.payment_schedule.created': 'Payment schedule created',
    'finance.payment.paid': 'Payment verified',
    'finance.cheque_schedule.created': 'Cheque schedule created',
    'finance.cheque.status_updated': 'Cheque status updated',
    'document.upload.requested': 'Document upload started',
    'document.uploaded': 'Document uploaded',
    'document.verified': 'Document verified',
    'document.rejected': 'Document rejected',
    'contract.signature.added': 'Contract signature added',
    'contract.stamped': 'Contract stamped',
  };
  return overrides[eventType] ?? formatToken(eventType.replaceAll('.', '_'));
}

function formatToken(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[_\-.\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function shortId(value: string): string {
  return value.length > 12 ? `${value.slice(0, 6)}…${value.slice(-4)}` : value;
}

function liveLabel(state: 'connecting' | 'live' | 'reconnecting' | 'offline'): string {
  switch (state) {
    case 'live': return 'Live';
    case 'connecting': return 'Connecting';
    case 'reconnecting': return 'Reconnecting';
    case 'offline': return 'Replay available';
  }
}
