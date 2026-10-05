'use client';

import type { TransactionListItemSnapshot } from '@preneura/contracts/sales';
import { useEffect, useState } from 'react';
import { ApiError, apiFetch } from '../../../../lib/api';
import styles from './transaction-identity-panel.module.css';

type Props = {
  transactionId: string;
  tenantId: string;
  projectId: string;
};

export default function TransactionIdentityPanel({ transactionId, tenantId, projectId }: Props) {
  const [transaction, setTransaction] = useState<TransactionListItemSnapshot | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    if (!transactionId || !tenantId || !projectId) {
      setLoading(false);
      return;
    }

    void apiFetch<TransactionListItemSnapshot[]>(
      `/v1/tenants/${tenantId}/projects/${projectId}/transactions`,
    )
      .then((items) => {
        if (cancelled) return;
        setTransaction(items.find((item) => item.transactionId === transactionId) ?? null);
      })
      .catch((reason) => {
        if (reason instanceof ApiError && reason.status === 401) {
          window.location.replace('/login');
        }
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
      <section className={styles.panel} aria-label="Transaction identity loading">
        <div className={styles.skeleton} />
      </section>
    );
  }

  if (!transaction) return null;

  return (
    <section className={styles.panel} aria-label="Transaction identity">
      <div className={styles.heading}>
        <div>
          <span className={styles.eyebrow}>Commercial identity</span>
          <h2>Buyer & attribution</h2>
          <p>Identity is resolved only after the transaction passes the server-side project, broker, agent, or buyer scope filter.</p>
        </div>
        <span className={styles.source}>{formatToken(transaction.buyerSource)}</span>
      </div>

      <div className={styles.grid}>
        <IdentityCard
          label="Buyer"
          primary={transaction.buyerDisplayName}
          secondary={`Profile ${shortId(transaction.buyerProfileId)}`}
        />
        <IdentityCard
          label="Buyer user"
          primary={shortId(transaction.buyerUserId)}
          secondary="Authenticated platform identity"
        />
        <IdentityCard
          label="Broker company"
          primary={transaction.brokerCompanyName ?? 'Direct / internal sale'}
          secondary={transaction.brokerCompanyId ? shortId(transaction.brokerCompanyId) : 'No broker company attribution'}
        />
        <IdentityCard
          label="Broker agent"
          primary={transaction.brokerAgentDisplayName ?? 'Not attributed'}
          secondary={transaction.brokerAgentUserId ? shortId(transaction.brokerAgentUserId) : 'No broker agent attribution'}
        />
      </div>
    </section>
  );
}

function IdentityCard({
  label,
  primary,
  secondary,
}: {
  label: string;
  primary: string;
  secondary: string;
}) {
  return (
    <article className={styles.card}>
      <span>{label}</span>
      <strong>{primary}</strong>
      <small>{secondary}</small>
    </article>
  );
}

function formatToken(value: string): string {
  return value.toLowerCase().split('_').map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ');
}

function shortId(value: string): string {
  return value.length > 10 ? `${value.slice(0, 6)}…${value.slice(-4)}` : value;
}
