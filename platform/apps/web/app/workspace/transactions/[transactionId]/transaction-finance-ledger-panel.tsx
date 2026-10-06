'use client';

import type {
  ChequeSnapshot,
  FinanceLedgerSnapshot,
  PaymentScheduleSnapshot,
} from '@preneura/contracts/finance';
import { useEffect, useMemo, useState } from 'react';
import { ApiError, apiFetch } from '../../../../lib/api';
import styles from './transaction-finance-ledger-panel.module.css';

type Props = {
  transactionId: string;
  tenantId: string;
  projectId: string;
};

export default function TransactionFinanceLedgerPanel({ transactionId, tenantId, projectId }: Props) {
  const [ledger, setLedger] = useState<FinanceLedgerSnapshot | null>(null);
  const [schedule, setSchedule] = useState<PaymentScheduleSnapshot | null>(null);
  const [cheques, setCheques] = useState<ChequeSnapshot[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const basePath = useMemo(
    () => `/v1/tenants/${tenantId}/projects/${projectId}/transactions/${transactionId}/finance`,
    [projectId, tenantId, transactionId],
  );

  useEffect(() => {
    let cancelled = false;
    if (!tenantId || !projectId || !transactionId) {
      setLoading(false);
      return;
    }

    void Promise.all([
      apiFetch<FinanceLedgerSnapshot>(`${basePath}/ledger`),
      optionalFetch<PaymentScheduleSnapshot>(`${basePath}/payment-schedule`, null),
      optionalFetch<ChequeSnapshot[]>(`${basePath}/cheques`, []),
    ])
      .then(([nextLedger, nextSchedule, nextCheques]) => {
        if (cancelled) return;
        setLedger(nextLedger);
        setSchedule(nextSchedule);
        setCheques(nextCheques ?? []);
        setError(null);
      })
      .catch((reason) => {
        if (cancelled) return;
        if (reason instanceof ApiError && reason.status === 401) {
          window.location.replace('/login');
          return;
        }
        if (reason instanceof ApiError && reason.status === 403) {
          setError(null);
          return;
        }
        setError(reason instanceof Error ? reason.message : 'Unable to load finance evidence.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [basePath, projectId, tenantId, transactionId]);

  if (loading) {
    return (
      <section className={styles.panel} aria-label="Finance ledger loading">
        <div className={styles.skeleton} />
      </section>
    );
  }
  if (!ledger && !error) return null;
  if (!ledger) {
    return (
      <section className={styles.panel} aria-label="Finance ledger unavailable">
        <div className={styles.notice}>
          <strong>Finance evidence unavailable</strong>
          <span>{error}</span>
        </div>
      </section>
    );
  }

  return (
    <section className={styles.panel} aria-label="Immutable transaction finance ledger">
      <header className={styles.heading}>
        <div>
          <span className={styles.eyebrow}>Certified financial evidence</span>
          <h2>Payment ledger & cheque history</h2>
          <p>
            Receipts, reversals, refunds and cheque transitions are append-only evidence. Schedule and cheque statuses below are derived projections.
          </p>
        </div>
        <span className={styles.immutableBadge}>Append-only</span>
      </header>

      <div className={styles.metrics}>
        <Metric label="Net cash received" value={money(ledger.netCashReceived, ledger.currency)} />
        <Metric label="Allocated to schedule" value={money(ledger.netAllocated, ledger.currency)} />
        <Metric label="Unallocated cash" value={money(ledger.unallocatedCash, ledger.currency)} />
        <Metric label="Ledger events" value={String(ledger.events.length)} />
      </div>

      {schedule ? (
        <div className={styles.section}>
          <div className={styles.sectionHeading}>
            <div>
              <span>Schedule projection</span>
              <h3>Installment settlement</h3>
            </div>
            <Status value={schedule.status} />
          </div>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Type</th>
                  <th>Contractual</th>
                  <th>Paid</th>
                  <th>Remaining</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {schedule.items.map((item) => (
                  <tr key={item.paymentItemId}>
                    <td>{item.sequenceNumber}</td>
                    <td>{label(item.itemType)}</td>
                    <td>{money(item.amount, schedule.currency)}</td>
                    <td>{money(item.paidAmount, schedule.currency)}</td>
                    <td>{money(item.remainingAmount, schedule.currency)}</td>
                    <td><Status value={item.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      <div className={styles.section}>
        <div className={styles.sectionHeading}>
          <div>
            <span>Money evidence</span>
            <h3>Immutable payment events</h3>
          </div>
          <small>{ledger.events.length === 0 ? 'No money events posted yet' : `${ledger.events.length} event${ledger.events.length === 1 ? '' : 's'}`}</small>
        </div>
        {ledger.events.length === 0 ? (
          <div className={styles.empty}>No receipts, reversals or refunds have been posted.</div>
        ) : (
          <div className={styles.eventList}>
            {[...ledger.events].reverse().map((event) => (
              <article className={styles.event} key={event.paymentEventId}>
                <div className={styles.eventMain}>
                  <Status value={event.eventType} />
                  <div>
                    <strong>{money(event.amount, event.currency)}</strong>
                    <span>{event.externalReference}</span>
                  </div>
                </div>
                <div className={styles.eventMeta}>
                  <span>{event.source}{event.provider ? ` · ${event.provider}` : ''}</span>
                  <span>{formatDateTime(event.occurredAt)}</span>
                  <span>{event.allocations.length} allocation{event.allocations.length === 1 ? '' : 's'}</span>
                  <code>{shortId(event.paymentEventId)}</code>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>

      <div className={styles.section}>
        <div className={styles.sectionHeading}>
          <div>
            <span>Instrument projection</span>
            <h3>Cheque generations</h3>
          </div>
          <small>{cheques.length === 0 ? 'No cheque schedule' : `${cheques.length} instrument record${cheques.length === 1 ? '' : 's'}`}</small>
        </div>
        {cheques.length === 0 ? (
          <div className={styles.empty}>No cheques are configured for this transaction.</div>
        ) : (
          <div className={styles.chequeGrid}>
            {cheques.map((cheque) => (
              <article className={styles.cheque} key={cheque.chequeId}>
                <div className={styles.chequeTop}>
                  <div>
                    <span>Cheque {cheque.sequenceNumber} · generation {cheque.generation}</span>
                    <strong>{money(cheque.amount, ledger.currency)}</strong>
                  </div>
                  <Status value={cheque.status} />
                </div>
                <div className={styles.chequeMeta}>
                  <span>Due {formatDate(cheque.dueAt)}</span>
                  <span>{cheque.bankName ?? 'Bank not captured'}</span>
                  <span>{cheque.chequeNumber ?? 'Number not captured'}</span>
                  {cheque.replacesChequeId ? <span>Replaces {shortId(cheque.replacesChequeId)}</span> : <span>Original instrument</span>}
                </div>
              </article>
            ))}
          </div>
        )}
      </div>

      <p className={styles.auditNote}>
        Transaction {shortId(transactionId)} · Ledger balances are calculated from immutable double-entry postings and allocations.
      </p>
    </section>
  );
}

function Metric({ label: text, value }: { label: string; value: string }) {
  return (
    <div className={styles.metric}>
      <span>{text}</span>
      <strong>{value}</strong>
    </div>
  );
}

function Status({ value }: { value: string }) {
  return <span className={styles.status}>{label(value)}</span>;
}

async function optionalFetch<T>(path: string, fallback: T): Promise<T> {
  try {
    return await apiFetch<T>(path);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return fallback;
    throw error;
  }
}

function label(value: string): string {
  return value.toLowerCase().replaceAll('_', ' ').replace(/\b\w/g, (character) => character.toUpperCase());
}

function money(value: string, currency: string): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(value));
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

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(value));
}

function shortId(value: string): string {
  return value.length > 12 ? `${value.slice(0, 8)}…${value.slice(-4)}` : value;
}
