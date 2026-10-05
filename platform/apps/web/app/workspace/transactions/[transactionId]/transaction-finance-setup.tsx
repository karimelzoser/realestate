'use client';

import {
  roleHasPermission,
  type WorkspaceContextSnapshot,
  type WorkspaceProjectSnapshot,
} from '@preneura/contracts/access';
import type { ChequeSnapshot, PaymentScheduleSnapshot, PaymentItemType } from '@preneura/contracts/finance';
import type { TransactionListItemSnapshot } from '@preneura/contracts/sales';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ApiError, apiFetch } from '../../../../lib/api';
import styles from './transaction-finance-setup.module.css';

type Props = {
  transactionId: string;
  tenantId: string;
  projectId: string;
};

type PaymentDraft = {
  key: string;
  itemType: PaymentItemType;
  amount: string;
  dueAt: string;
};

type ChequeDraft = {
  key: string;
  amount: string;
  dueAt: string;
};

export default function TransactionFinanceSetup({ transactionId, tenantId, projectId }: Props) {
  const [project, setProject] = useState<WorkspaceProjectSnapshot | null>(null);
  const [transaction, setTransaction] = useState<TransactionListItemSnapshot | null>(null);
  const [schedule, setSchedule] = useState<PaymentScheduleSnapshot | null>(null);
  const [cheques, setCheques] = useState<ChequeSnapshot[]>([]);
  const [paymentDrafts, setPaymentDrafts] = useState<PaymentDraft[]>([
    newPaymentDraft('DOWN_PAYMENT'),
  ]);
  const [chequeDrafts, setChequeDrafts] = useState<ChequeDraft[]>([newChequeDraft()]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const basePath = useMemo(
    () => `/v1/tenants/${tenantId}/projects/${projectId}/transactions/${transactionId}/finance`,
    [projectId, tenantId, transactionId],
  );

  const canManage = Boolean(project?.roles.some((role) => roleHasPermission(role, 'payment.schedule.manage')));

  const load = useCallback(async (): Promise<void> => {
    if (!tenantId || !projectId || !transactionId) {
      setError('Finance setup context is incomplete. Reopen the transaction from the workspace.');
      setLoading(false);
      return;
    }

    setLoading(true);
    setError('');
    try {
      const workspace = await apiFetch<WorkspaceContextSnapshot>('/v1/me/workspace');
      const nextProject = workspace.projects.find(
        (candidate) => candidate.tenantId === tenantId && candidate.projectId === projectId,
      );
      if (!nextProject) {
        setProject(null);
        return;
      }
      setProject(nextProject);
      if (!nextProject.roles.some((role) => roleHasPermission(role, 'payment.schedule.manage'))) return;

      const transactions = await apiFetch<TransactionListItemSnapshot[]>(
        `/v1/tenants/${tenantId}/projects/${projectId}/transactions`,
      );
      const nextTransaction = transactions.find((item) => item.transactionId === transactionId) ?? null;
      setTransaction(nextTransaction);
      if (!nextTransaction) return;

      const [nextSchedule, nextCheques] = await Promise.all([
        optionalFetch<PaymentScheduleSnapshot>(`${basePath}/payment-schedule`, null),
        optionalFetch<ChequeSnapshot[]>(`${basePath}/cheques`, []),
      ]);
      setSchedule(nextSchedule);
      setCheques(nextCheques ?? []);
    } catch (reason) {
      if (reason instanceof ApiError && reason.status === 401) {
        window.location.replace('/login');
        return;
      }
      setError(reason instanceof Error ? reason.message : 'Unable to load finance setup.');
    } finally {
      setLoading(false);
    }
  }, [basePath, projectId, tenantId, transactionId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading && !project) return null;
  if (!project || !canManage) return null;

  const contractTotal = transaction?.quotedTotal ?? null;
  const paymentTotal = paymentDrafts.reduce((sum, item) => sum + moneyNumber(item.amount), 0);
  const chequeTotal = chequeDrafts.reduce((sum, item) => sum + moneyNumber(item.amount), 0);
  const targetTotal = contractTotal === null ? null : moneyNumber(contractTotal);
  const paymentReconciles = targetTotal !== null && cents(paymentTotal) === cents(targetTotal);

  async function createPaymentSchedule(): Promise<void> {
    setSuccess('');
    setError('');
    if (!transaction || !contractTotal) {
      setError('The frozen reservation value is unavailable for this transaction.');
      return;
    }
    if (paymentDrafts.length === 0 || !paymentDrafts.some((item) => item.itemType === 'DOWN_PAYMENT')) {
      setError('Add at least one down-payment item.');
      return;
    }
    if (paymentDrafts.some((item) => moneyNumber(item.amount) <= 0 || !item.dueAt)) {
      setError('Every payment item needs a positive amount and due date.');
      return;
    }
    if (!paymentReconciles) {
      setError(`Payment items must total exactly ${money(contractTotal, transaction.currency)}.`);
      return;
    }

    setBusy('payment');
    try {
      await apiFetch(`${basePath}/payment-schedule`, {
        method: 'POST',
        body: JSON.stringify({
          currency: transaction.currency,
          totalContractAmount: normalizeMoney(contractTotal),
          items: paymentDrafts.map((item, index) => ({
            sequenceNumber: index + 1,
            itemType: item.itemType,
            amount: normalizeMoney(item.amount),
            dueAt: toIso(item.dueAt),
          })),
        }),
      });
      setSuccess('Payment schedule created from the frozen reservation value.');
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Payment schedule could not be created.');
    } finally {
      setBusy('');
    }
  }

  async function createChequeSchedule(): Promise<void> {
    setSuccess('');
    setError('');
    if (chequeDrafts.length === 0 || chequeDrafts.some((item) => moneyNumber(item.amount) <= 0 || !item.dueAt)) {
      setError('Every cheque needs a positive amount and due date.');
      return;
    }

    setBusy('cheques');
    try {
      await apiFetch(`${basePath}/cheques`, {
        method: 'POST',
        body: JSON.stringify({
          cheques: chequeDrafts.map((item, index) => ({
            sequenceNumber: index + 1,
            amount: normalizeMoney(item.amount),
            dueAt: toIso(item.dueAt),
          })),
        }),
      });
      setSuccess('Cheque schedule created. Individual cheque details can be captured as each instrument is received.');
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Cheque schedule could not be created.');
    } finally {
      setBusy('');
    }
  }

  return (
    <section className={styles.panel} aria-label="Transaction finance setup">
      <div className={styles.heading}>
        <div>
          <span>Finance administration</span>
          <h2>Schedule setup</h2>
          <p>Create the contractual payment and cheque schedules once. Subsequent verification remains in the transaction operations panel.</p>
        </div>
        {transaction ? (
          <div className={styles.contractValue}>
            <span>Frozen contract value</span>
            <strong>{contractTotal ? money(contractTotal, transaction.currency) : 'Unavailable'}</strong>
          </div>
        ) : null}
      </div>

      {error ? <div className={styles.error}>{error}</div> : null}
      {success ? <div className={styles.success}>{success}</div> : null}

      <div className={styles.grid}>
        <article className={styles.setupCard}>
          <div className={styles.cardHeading}>
            <div>
              <span>Installments</span>
              <h3>Payment schedule</h3>
            </div>
            {schedule ? <Status text={schedule.status} /> : <Status text="NOT SET" />}
          </div>

          {schedule ? (
            <div className={styles.existingSummary}>
              <strong>{schedule.items.length} payment items</strong>
              <span>{money(schedule.totalContractAmount, schedule.currency)} contractual total</span>
              <small>The schedule is immutable through this setup surface. Payment verification remains available in transaction operations.</small>
            </div>
          ) : (
            <>
              <div className={styles.rows}>
                {paymentDrafts.map((item, index) => (
                  <div className={styles.paymentRow} key={item.key}>
                    <span className={styles.sequence}>{index + 1}</span>
                    <select
                      aria-label={`Payment ${index + 1} type`}
                      value={item.itemType}
                      onChange={(event) => updatePayment(item.key, { itemType: event.target.value as PaymentItemType })}
                    >
                      <option value="DOWN_PAYMENT">Down payment</option>
                      <option value="INSTALLMENT">Installment</option>
                      <option value="FEE">Fee</option>
                    </select>
                    <input
                      inputMode="decimal"
                      placeholder="Amount"
                      value={item.amount}
                      onChange={(event) => updatePayment(item.key, { amount: moneyInput(event.target.value) })}
                    />
                    <input
                      type="datetime-local"
                      value={item.dueAt}
                      onChange={(event) => updatePayment(item.key, { dueAt: event.target.value })}
                    />
                    <button
                      type="button"
                      className={styles.iconButton}
                      aria-label={`Remove payment item ${index + 1}`}
                      disabled={paymentDrafts.length === 1 || Boolean(busy)}
                      onClick={() => setPaymentDrafts((current) => current.filter((draft) => draft.key !== item.key))}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>

              <div className={styles.addRow}>
                <button type="button" disabled={Boolean(busy)} onClick={() => setPaymentDrafts((current) => [...current, newPaymentDraft('INSTALLMENT')])}>
                  + Add payment item
                </button>
              </div>

              <div className={styles.reconcile}>
                <div>
                  <span>Items total</span>
                  <strong>{transaction ? money(paymentTotal.toFixed(2), transaction.currency) : paymentTotal.toFixed(2)}</strong>
                </div>
                <div className={paymentReconciles ? styles.reconciled : styles.unreconciled}>
                  {paymentReconciles ? 'Reconciled' : 'Must equal frozen total'}
                </div>
              </div>

              <button
                type="button"
                className={styles.primaryAction}
                disabled={Boolean(busy) || !paymentReconciles}
                onClick={() => void createPaymentSchedule()}
              >
                {busy === 'payment' ? 'Creating schedule…' : 'Create payment schedule'}
              </button>
            </>
          )}
        </article>

        <article className={styles.setupCard}>
          <div className={styles.cardHeading}>
            <div>
              <span>Physical instruments</span>
              <h3>Cheque schedule</h3>
            </div>
            {cheques.length > 0 ? <Status text="SET" /> : <Status text="NOT SET" />}
          </div>

          {cheques.length > 0 ? (
            <div className={styles.existingSummary}>
              <strong>{cheques.length} cheques configured</strong>
              <span>{transaction ? money(cheques.reduce((sum, cheque) => sum + Number(cheque.amount), 0).toFixed(2), transaction.currency) : 'Schedule active'}</span>
              <small>Receipt, bank details, deposit and clearing status are managed from transaction operations.</small>
            </div>
          ) : (
            <>
              <div className={styles.rows}>
                {chequeDrafts.map((item, index) => (
                  <div className={styles.chequeRow} key={item.key}>
                    <span className={styles.sequence}>{index + 1}</span>
                    <input
                      inputMode="decimal"
                      placeholder="Amount"
                      value={item.amount}
                      onChange={(event) => updateChequeDraft(item.key, { amount: moneyInput(event.target.value) })}
                    />
                    <input
                      type="datetime-local"
                      value={item.dueAt}
                      onChange={(event) => updateChequeDraft(item.key, { dueAt: event.target.value })}
                    />
                    <button
                      type="button"
                      className={styles.iconButton}
                      aria-label={`Remove cheque ${index + 1}`}
                      disabled={chequeDrafts.length === 1 || Boolean(busy)}
                      onClick={() => setChequeDrafts((current) => current.filter((draft) => draft.key !== item.key))}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>

              <div className={styles.addRow}>
                <button type="button" disabled={Boolean(busy)} onClick={() => setChequeDrafts((current) => [...current, newChequeDraft()])}>
                  + Add cheque
                </button>
              </div>

              <div className={styles.reconcile}>
                <div>
                  <span>Cheque total</span>
                  <strong>{transaction ? money(chequeTotal.toFixed(2), transaction.currency) : chequeTotal.toFixed(2)}</strong>
                </div>
                <small>Cheque total is informational; project terms may include non-cheque payment components.</small>
              </div>

              <button
                type="button"
                className={styles.primaryAction}
                disabled={Boolean(busy)}
                onClick={() => void createChequeSchedule()}
              >
                {busy === 'cheques' ? 'Creating schedule…' : 'Create cheque schedule'}
              </button>
            </>
          )}
        </article>
      </div>
    </section>
  );

  function updatePayment(key: string, patch: Partial<PaymentDraft>): void {
    setPaymentDrafts((current) => current.map((item) => item.key === key ? { ...item, ...patch } : item));
  }

  function updateChequeDraft(key: string, patch: Partial<ChequeDraft>): void {
    setChequeDrafts((current) => current.map((item) => item.key === key ? { ...item, ...patch } : item));
  }
}

function Status({ text }: { text: string }) {
  return <span className={styles.status}>{text.replaceAll('_', ' ')}</span>;
}

async function optionalFetch<T>(path: string, fallback: T): Promise<T> {
  try {
    return await apiFetch<T>(path);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return fallback;
    throw error;
  }
}

function newPaymentDraft(itemType: PaymentItemType): PaymentDraft {
  return { key: crypto.randomUUID(), itemType, amount: '', dueAt: '' };
}

function newChequeDraft(): ChequeDraft {
  return { key: crypto.randomUUID(), amount: '', dueAt: '' };
}

function moneyInput(value: string): string {
  const cleaned = value.replace(/[^0-9.]/g, '');
  const [whole = '', ...rest] = cleaned.split('.');
  const fraction = rest.join('').slice(0, 2);
  return rest.length > 0 ? `${whole}.${fraction}` : whole;
}

function moneyNumber(value: string): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function cents(value: number): number {
  return Math.round(value * 100);
}

function normalizeMoney(value: string): string {
  return moneyNumber(value).toFixed(2);
}

function toIso(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error('Enter a valid due date and time.');
  return date.toISOString();
}

function money(value: string, currency: string): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    maximumFractionDigits: 2,
  }).format(Number(value));
}
