'use client';

import type { TransactionPriceSnapshot } from '@preneura/contracts/pricing-quote';
import { useEffect, useState } from 'react';
import { ApiError, apiFetch } from '../../../../lib/api';
import styles from './transaction-price-panel.module.css';

type Props = {
  transactionId: string;
  tenantId: string;
  projectId: string;
};

const COMPONENT_LABEL: Readonly<Record<string, string>> = {
  INDOOR: 'Indoor area',
  ROOF: 'Roof / terrace',
  GARDEN: 'Garden',
};

export default function TransactionPricePanel({ transactionId, tenantId, projectId }: Props) {
  const [snapshot, setSnapshot] = useState<TransactionPriceSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!transactionId || !tenantId || !projectId) {
      setLoading(false);
      return;
    }

    void apiFetch<TransactionPriceSnapshot>(
      `/v1/tenants/${tenantId}/projects/${projectId}/transactions/${transactionId}/price-snapshot`,
    )
      .then((value) => {
        if (cancelled) return;
        setSnapshot(value);
        setError(null);
      })
      .catch((reason) => {
        if (cancelled) return;
        if (reason instanceof ApiError && reason.status === 401) {
          window.location.replace('/login');
          return;
        }
        setError(reason instanceof Error ? reason.message : 'Unable to load the certified quote snapshot.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [projectId, tenantId, transactionId]);

  if (loading) {
    return (
      <section className={styles.panel} aria-label="Certified quote loading">
        <div className={styles.skeleton} />
      </section>
    );
  }

  if (!snapshot) {
    if (!error) return null;
    return (
      <section className={styles.panel} aria-label="Certified quote unavailable">
        <div className={styles.notice}>
          <strong>Certified quote unavailable</strong>
          <span>{error}</span>
        </div>
      </section>
    );
  }

  const formatter = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: snapshot.currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  return (
    <section className={styles.panel} aria-label="Certified reservation quote">
      <header className={styles.heading}>
        <div>
          <span className={styles.eyebrow}>Certified commercial snapshot</span>
          <h2>Reservation price breakdown</h2>
          <p>
            Frozen at reservation time. Later price publications cannot rewrite these areas,
            rates, component amounts, or the quoted total.
          </p>
        </div>
        <div className={styles.total}>
          <span>Quoted total</span>
          <strong>{formatter.format(Number(snapshot.quotedTotal))}</strong>
        </div>
      </header>

      <div className={styles.meta}>
        <div>
          <span>Unit type</span>
          <strong>{snapshot.unitTypeCode} · {snapshot.unitTypeName}</strong>
        </div>
        <div>
          <span>Pricing version</span>
          <strong>v{snapshot.pricingVersionNumber} · {snapshot.pricingVersionLabel}</strong>
        </div>
        <div>
          <span>Effective</span>
          <strong>{formatDateTime(snapshot.pricingEffectiveAt)}</strong>
        </div>
        <div>
          <span>Reserved</span>
          <strong>{formatDateTime(snapshot.reservedAt)}</strong>
        </div>
      </div>

      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Component</th>
              <th>Area</th>
              <th>Rate / m²</th>
              <th>Amount</th>
            </tr>
          </thead>
          <tbody>
            {snapshot.components.map((component) => (
              <tr key={component.component}>
                <td>{COMPONENT_LABEL[component.component] ?? component.component}</td>
                <td>{formatNumber(component.areaSqm)} m²</td>
                <td>{formatter.format(Number(component.ratePerSqm))}</td>
                <td>{formatter.format(Number(component.amount))}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={3}>Certified total</td>
              <td>{formatter.format(Number(snapshot.quotedTotal))}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      <p className={styles.auditNote}>
        Pricing snapshot ID {shortId(snapshot.pricingVersionId)} · Reservation {shortId(snapshot.reservationId)}
      </p>
    </section>
  );
}

function formatNumber(value: string): string {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(Number(value));
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
  return value.length > 12 ? `${value.slice(0, 8)}…${value.slice(-4)}` : value;
}
