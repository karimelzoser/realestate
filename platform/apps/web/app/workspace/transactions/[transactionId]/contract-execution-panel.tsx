'use client';

import type { ContractExecutionSnapshot } from '@preneura/contracts/contract-execution';
import { useEffect, useState } from 'react';
import { ApiError, apiFetch } from '../../../../lib/api';
import styles from './contract-execution-panel.module.css';

type Props = {
  transactionId: string;
  tenantId: string;
  projectId: string;
};

export default function ContractExecutionPanel({ transactionId, tenantId, projectId }: Props) {
  const [snapshot, setSnapshot] = useState<ContractExecutionSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!transactionId || !tenantId || !projectId) {
      setLoading(false);
      return;
    }

    void apiFetch<ContractExecutionSnapshot | null>(
      `/v1/tenants/${tenantId}/projects/${projectId}/transactions/${transactionId}/contract-execution`,
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
        setError(reason instanceof Error ? reason.message : 'Unable to load contract execution evidence.');
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
      <section className={styles.panel} aria-label="Contract execution evidence loading">
        <div className={styles.skeleton} />
      </section>
    );
  }

  if (error) {
    return (
      <section className={styles.panel} aria-label="Contract execution evidence unavailable">
        <div className={styles.notice}>
          <strong>Execution evidence unavailable</strong>
          <span>{error}</span>
        </div>
      </section>
    );
  }

  if (!snapshot) {
    return (
      <section className={styles.panel} aria-label="Contract execution pending">
        <header className={styles.heading}>
          <div>
            <span className={styles.eyebrow}>Legal evidence</span>
            <h2>Contract execution</h2>
            <p>The immutable execution manifest will appear after the fully signed contract is executed.</p>
          </div>
          <span className={styles.pendingBadge}>Not executed</span>
        </header>
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
    <section className={styles.panel} aria-label="Immutable contract execution evidence">
      <header className={styles.heading}>
        <div>
          <span className={styles.eyebrow}>Immutable legal evidence</span>
          <h2>Contract execution</h2>
          <p>
            The executed contract is bound to its trusted file hash, template version,
            certified reservation price and signer evidence.
          </p>
        </div>
        <span className={styles.trustedBadge}>Trusted · {snapshot.objectTrustStatus}</span>
      </header>

      <div className={styles.metrics}>
        <EvidenceCard label="Executed" value={formatDateTime(snapshot.executedAt)} detail={`Actor ${shortId(snapshot.executedBy)}`} />
        <EvidenceCard label="Template" value={`Version ${snapshot.templateVersionNumber}`} detail={shortHash(snapshot.templateSha256Hex)} mono />
        <EvidenceCard label="Certified value" value={formatter.format(Number(snapshot.quotedTotal))} detail={`Pricing ${shortId(snapshot.pricingVersionId)}`} />
        <EvidenceCard label="Signatures" value={`${snapshot.signatures.length} captured`} detail={snapshot.signatures.map((item) => item.signerRole).join(' · ')} />
      </div>

      <div className={styles.hashGrid}>
        <HashLine label="Executed document SHA-256" value={snapshot.documentSha256Hex} />
        <HashLine label="Execution manifest SHA-256" value={snapshot.manifestSha256Hex} />
      </div>

      <div className={styles.signers}>
        <span>Signer evidence</span>
        <div>
          {snapshot.signatures.map((signature) => (
            <article key={`${signature.signerRole}-${signature.signedAt}`} className={styles.signer}>
              <strong>{signature.signerRole}</strong>
              <span>{signature.method}</span>
              <small>{formatDateTime(signature.signedAt)}</small>
            </article>
          ))}
        </div>
      </div>

      <p className={styles.auditNote}>
        Snapshot {shortId(snapshot.snapshotId)} · Contract {shortId(snapshot.documentId)} · Reservation {shortId(snapshot.reservationId)}
      </p>
    </section>
  );
}

function EvidenceCard({
  label,
  value,
  detail,
  mono = false,
}: {
  label: string;
  value: string;
  detail: string;
  mono?: boolean;
}) {
  return (
    <article className={styles.metric}>
      <span>{label}</span>
      <strong className={mono ? styles.mono : undefined}>{value}</strong>
      <small>{detail}</small>
    </article>
  );
}

function HashLine({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.hashLine}>
      <span>{label}</span>
      <code>{value}</code>
    </div>
  );
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

function shortId(value: string | null): string {
  if (!value) return 'system';
  return value.length > 12 ? `${value.slice(0, 8)}…${value.slice(-4)}` : value;
}

function shortHash(value: string): string {
  return value.length > 18 ? `${value.slice(0, 10)}…${value.slice(-8)}` : value;
}
