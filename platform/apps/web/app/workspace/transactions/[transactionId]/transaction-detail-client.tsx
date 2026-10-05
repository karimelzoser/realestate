'use client';

import {
  roleHasPermission,
  type PermissionCode,
  type WorkspaceContextSnapshot,
  type WorkspaceProjectSnapshot,
} from '@preneura/contracts/access';
import type { CommissionCaseSnapshot } from '@preneura/contracts/commissions';
import type { TransactionDocumentSnapshot } from '@preneura/contracts/documents';
import type { ChequeSnapshot, PaymentScheduleSnapshot } from '@preneura/contracts/finance';
import type { RealtimeSignal } from '@preneura/contracts/realtime';
import type {
  TransactionListItemSnapshot,
  TransactionMilestoneCode,
  TransactionProgressSnapshot,
} from '@preneura/contracts/sales';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ApiError, apiFetch, eventStreamUrl } from '../../../../lib/api';
import styles from './transaction-detail.module.css';

const milestonePermission: Readonly<Record<TransactionMilestoneCode, PermissionCode>> = {
  BUYER_DOCUMENTS_COMPLETE: 'documents.verify',
  DOWN_PAYMENT_RECEIVED: 'payment.verify',
  CHEQUES_RECEIVED: 'payment.verify',
  CONTRACT_GENERATED: 'contract.generate',
  CONTRACT_SIGNED: 'contract.execute',
  CONTRACT_STAMPED: 'contract.execute',
};

type CommissionAction = 'MARK_INVOICED' | 'MARK_PAID' | 'MARK_DISPUTED';
type ChequeAction = 'RECEIVED' | 'DEPOSITED' | 'CLEARED' | 'RETURNED' | 'CANCELLED';

type Props = {
  transactionId: string;
  tenantId: string;
  projectId: string;
};

export default function TransactionDetailClient({ transactionId, tenantId, projectId }: Props) {
  const [workspace, setWorkspace] = useState<WorkspaceContextSnapshot | null>(null);
  const [project, setProject] = useState<WorkspaceProjectSnapshot | null>(null);
  const [transaction, setTransaction] = useState<TransactionListItemSnapshot | null>(null);
  const [progress, setProgress] = useState<TransactionProgressSnapshot | null>(null);
  const [documents, setDocuments] = useState<TransactionDocumentSnapshot[] | null>(null);
  const [paymentSchedule, setPaymentSchedule] = useState<PaymentScheduleSnapshot | null>(null);
  const [cheques, setCheques] = useState<ChequeSnapshot[] | null>(null);
  const [commission, setCommission] = useState<CommissionCaseSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [actionError, setActionError] = useState('');
  const [actionBusy, setActionBusy] = useState('');
  const [typedName, setTypedName] = useState('');
  const [rejectReasons, setRejectReasons] = useState<Record<string, string>>({});
  const [paymentReferences, setPaymentReferences] = useState<Record<string, string>>({});
  const [chequeNumbers, setChequeNumbers] = useState<Record<string, string>>({});
  const [chequeBanks, setChequeBanks] = useState<Record<string, string>>({});
  const [liveState, setLiveState] = useState<'connecting' | 'live' | 'reconnecting' | 'offline'>('connecting');

  const can = useCallback((permission: PermissionCode): boolean => {
    if (!project) return false;
    return project.roles.some((role) => roleHasPermission(role, permission));
  }, [project]);

  const basePath = useMemo(
    () => `/v1/tenants/${tenantId}/projects/${projectId}/transactions/${transactionId}`,
    [tenantId, projectId, transactionId],
  );

  const loadDetail = useCallback(async (background = false): Promise<void> => {
    if (!tenantId || !projectId || !transactionId) {
      setError('This transaction URL is missing its project context. Return to the workspace and open the transaction again.');
      setLoading(false);
      return;
    }

    if (background) setRefreshing(true);
    else setLoading(true);
    setError('');

    try {
      const context = workspace ?? await apiFetch<WorkspaceContextSnapshot>('/v1/me/workspace');
      const nextProject = context.projects.find(
        (candidate) => candidate.tenantId === tenantId && candidate.projectId === projectId,
      );
      if (!nextProject) throw new ApiError('This project is not in your active workspace scope.', 403);

      if (!workspace) setWorkspace(context);
      setProject(nextProject);

      const transactionList = await apiFetch<TransactionListItemSnapshot[]>(
        `/v1/tenants/${tenantId}/projects/${projectId}/transactions`,
      );
      const nextTransaction = transactionList.find((item) => item.transactionId === transactionId);
      if (!nextTransaction) throw new ApiError('This transaction is not visible in your current access scope.', 404);
      setTransaction(nextTransaction);

      const nextProgress = await apiFetch<TransactionProgressSnapshot>(`${basePath}/progress`);
      setProgress(nextProgress);

      const hasDocumentRead = nextProject.roles.some(
        (role) => roleHasPermission(role, 'documents.read') || roleHasPermission(role, 'documents.read.self'),
      );
      const hasFinanceRead = nextProject.roles.some(
        (role) => roleHasPermission(role, 'payment.read') || roleHasPermission(role, 'installment.read.self'),
      );
      const hasCommissionRead = nextProject.roles.some((role) => roleHasPermission(role, 'commission.status.read'));

      const [nextDocuments, nextSchedule, nextCheques, nextCommission] = await Promise.all([
        hasDocumentRead
          ? optionalFetch<TransactionDocumentSnapshot[]>(`${basePath}/documents`, [])
          : Promise.resolve(null),
        hasFinanceRead
          ? optionalFetch<PaymentScheduleSnapshot>(`${basePath}/finance/payment-schedule`, null)
          : Promise.resolve(null),
        hasFinanceRead
          ? optionalFetch<ChequeSnapshot[]>(`${basePath}/finance/cheques`, [])
          : Promise.resolve(null),
        hasCommissionRead && nextProject.brokerCompanyIds.length > 0
          ? loadCommission(nextProject, transactionId)
          : Promise.resolve(null),
      ]);

      setDocuments(nextDocuments);
      setPaymentSchedule(nextSchedule);
      setCheques(nextCheques);
      setCommission(nextCommission);
    } catch (reason) {
      if (reason instanceof ApiError && reason.status === 401) {
        window.location.replace('/login');
        return;
      }
      setError(reason instanceof Error ? reason.message : 'Unable to load transaction operations.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [basePath, projectId, tenantId, transactionId, workspace]);

  useEffect(() => {
    void loadDetail();
  }, [loadDetail]);

  useEffect(() => {
    if (!project) return;
    const source = new EventSource(
      eventStreamUrl(`/v1/tenants/${project.tenantId}/projects/${project.projectId}/events?after=0`),
      { withCredentials: true },
    );
    setLiveState('connecting');

    const onSignal = (event: Event): void => {
      try {
        const signal = JSON.parse((event as MessageEvent<string>).data) as RealtimeSignal;
        if (['TRANSACTION', 'COMMISSION', 'DOMAIN'].includes(signal.topic)) {
          void loadDetail(true);
        }
      } catch {
        // Durable replay will recover the next valid signal.
      }
    };
    const onResync = (): void => {
      void loadDetail(true);
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
  }, [project, loadDetail]);

  async function runAction(key: string, action: () => Promise<unknown>): Promise<void> {
    setActionBusy(key);
    setActionError('');
    try {
      await action();
      await loadDetail(true);
    } catch (reason) {
      if (reason instanceof ApiError && reason.status === 401) {
        window.location.replace('/login');
        return;
      }
      setActionError(reason instanceof Error ? reason.message : 'The operation could not be completed.');
    } finally {
      setActionBusy('');
    }
  }

  async function completeMilestone(code: TransactionMilestoneCode): Promise<void> {
    await runAction(`milestone:${code}`, () =>
      apiFetch(`${basePath}/milestones/${code}/complete`, {
        method: 'POST',
        body: JSON.stringify({}),
      }),
    );
  }

  async function reviewDocument(documentId: string, decision: 'VERIFY' | 'REJECT'): Promise<void> {
    const rejectionReason = rejectReasons[documentId]?.trim();
    if (decision === 'REJECT' && !rejectionReason) {
      setActionError('Enter a rejection reason before rejecting this document.');
      return;
    }
    await runAction(`review:${documentId}:${decision}`, () =>
      apiFetch(`${basePath}/documents/${documentId}/review`, {
        method: 'POST',
        body: JSON.stringify({ decision, ...(rejectionReason ? { rejectionReason } : {}) }),
      }),
    );
  }

  async function addTypedSignature(documentId: string, signerRole: 'BUYER' | 'COMPANY'): Promise<void> {
    const name = typedName.trim();
    if (name.length < 2) {
      setActionError('Enter the signer name before adding a typed signature.');
      return;
    }
    await runAction(`sign:${documentId}:${signerRole}`, () =>
      apiFetch(`${basePath}/documents/${documentId}/signatures/typed`, {
        method: 'POST',
        body: JSON.stringify({ signerRole, typedName: name }),
      }),
    );
  }

  async function stampContract(documentId: string): Promise<void> {
    await runAction(`stamp:${documentId}`, () =>
      apiFetch(`${basePath}/documents/${documentId}/stamp`, { method: 'POST' }),
    );
  }

  async function markPaymentPaid(paymentItemId: string): Promise<void> {
    const paymentReference = paymentReferences[paymentItemId]?.trim();
    if (!paymentReference) {
      setActionError('Enter the payment reference before verifying payment.');
      return;
    }
    await runAction(`payment:${paymentItemId}`, () =>
      apiFetch(`${basePath}/finance/payments/${paymentItemId}/mark-paid`, {
        method: 'POST',
        body: JSON.stringify({ paymentReference }),
      }),
    );
  }

  async function updateCheque(cheque: ChequeSnapshot, status: ChequeAction): Promise<void> {
    const chequeNumber = chequeNumbers[cheque.chequeId]?.trim() || cheque.chequeNumber || undefined;
    const bankName = chequeBanks[cheque.chequeId]?.trim() || cheque.bankName || undefined;
    await runAction(`cheque:${cheque.chequeId}:${status}`, () =>
      apiFetch(`${basePath}/finance/cheques/${cheque.chequeId}/status`, {
        method: 'POST',
        body: JSON.stringify({ status, ...(chequeNumber ? { chequeNumber } : {}), ...(bankName ? { bankName } : {}) }),
      }),
    );
  }

  async function updateCommission(action: CommissionAction): Promise<void> {
    if (!commission) return;
    await runAction(`commission:${action}`, () =>
      apiFetch(
        `/v1/tenants/${tenantId}/projects/${projectId}/brokers/${commission.brokerCompanyId}/commissions/${commission.commissionCaseId}/status`,
        { method: 'POST', body: JSON.stringify({ action }) },
      ),
    );
  }

  if (loading && !transaction) {
    return (
      <main className={styles.statePage}>
        <div className={styles.loadingMark}>P</div>
        <p>Loading authorized transaction state…</p>
      </main>
    );
  }

  if (error || !project || !transaction || !progress) {
    return (
      <main className={styles.statePage}>
        <section className={styles.stateCard}>
          <span className={styles.eyebrow}>Transaction unavailable</span>
          <h1>PRENEURA could not open this transaction.</h1>
          <p>{error || 'The transaction is outside your current access scope.'}</p>
          <a href="/workspace">Return to workspace</a>
        </section>
      </main>
    );
  }

  const contract = documents?.find((document) => document.category === 'CONTRACT' && document.status !== 'SUPERSEDED') ?? null;
  const buyerSigned = contract?.signatures.some((signature) => signature.signerRole === 'BUYER') ?? false;
  const companySigned = contract?.signatures.some((signature) => signature.signerRole === 'COMPANY') ?? false;
  const outstandingPayments = paymentSchedule?.items.filter((item) => !['PAID', 'WAIVED', 'CANCELLED'].includes(item.status)) ?? [];
  const outstandingAmount = outstandingPayments.reduce((sum, item) => sum + Number(item.amount), 0);

  return (
    <main className={styles.page}>
      <header className={styles.topbar}>
        <div className={styles.brandLine}>
          <a href="/workspace" className={styles.backButton} aria-label="Back to workspace">←</a>
          <div className={styles.brandMark}>P</div>
          <div>
            <strong>PRENEURA</strong>
            <span>{project.projectName}</span>
          </div>
        </div>
        <div className={styles.liveBlock}>
          <span className={`${styles.liveDot} ${styles[liveState]}`} />
          <div>
            <strong>{refreshing ? 'Refreshing' : liveLabel(liveState)}</strong>
            <span>Durable project replay</span>
          </div>
        </div>
      </header>

      <div className={styles.content}>
        <section className={styles.hero}>
          <div>
            <span className={styles.eyebrow}>Transaction operations</span>
            <h1>{transaction.unitTypeName}</h1>
            <p>
              Transaction <code>{shortId(transaction.transactionId)}</code> · buyer <code>{shortId(transaction.buyerProfileId)}</code>
            </p>
          </div>
          <div className={styles.heroStatus}>
            <span className={styles.statusPill}>{formatToken(transaction.status)}</span>
            <strong>{clampPercent(progress.completionPercent).toFixed(0)}%</strong>
            <small>workflow complete</small>
          </div>
        </section>

        {actionError ? <div className={styles.errorBanner}>{actionError}</div> : null}

        <section className={styles.metricGrid}>
          <Metric label="Contract value" value={transaction.quotedTotal ? money(transaction.quotedTotal, transaction.currency) : '—'} />
          <Metric label="Opened" value={formatDate(transaction.openedAt)} />
          <Metric label="Milestones" value={`${progress.milestones.filter((item) => item.status === 'COMPLETED').length}/${progress.milestones.length}`} />
          <Metric label="Documents" value={documents === null ? 'Restricted' : String(documents.filter((item) => item.status !== 'SUPERSEDED').length)} />
          <Metric label="Outstanding" value={paymentSchedule ? money(outstandingAmount.toFixed(2), paymentSchedule.currency) : '—'} />
          <Metric label="Commission" value={commission ? formatToken(commission.status) : '—'} />
        </section>

        <div className={styles.layout}>
          <div className={styles.primaryColumn}>
            <section className={styles.panel}>
              <PanelHeading eyebrow="Workflow" title="Transaction milestones" detail="Server-managed operational progress. Financial and document flows also complete linked milestones automatically." />
              <div className={styles.timeline}>
                {progress.milestones.map((milestone) => {
                  const allowed = can(milestonePermission[milestone.code]);
                  return (
                    <article className={styles.timelineItem} key={milestone.code}>
                      <div className={`${styles.timelineMarker} ${milestone.status === 'COMPLETED' ? styles.completeMarker : ''}`} />
                      <div className={styles.timelineBody}>
                        <div className={styles.rowBetween}>
                          <div>
                            <strong>{milestone.label}</strong>
                            <span>{milestone.weightPercent}% of workflow</span>
                          </div>
                          <span className={styles.miniStatus}>{formatToken(milestone.status)}</span>
                        </div>
                        {milestone.completedAt ? <small>Completed {formatDateTime(milestone.completedAt)}</small> : null}
                        {milestone.status !== 'COMPLETED' && allowed ? (
                          <button
                            type="button"
                            className={styles.smallAction}
                            disabled={Boolean(actionBusy)}
                            onClick={() => void completeMilestone(milestone.code)}
                          >
                            {actionBusy === `milestone:${milestone.code}` ? 'Updating…' : 'Mark complete'}
                          </button>
                        ) : null}
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>

            <section className={styles.panel}>
              <PanelHeading eyebrow="Documents" title="Verification & contract" detail="Uploaded records, review state and signatures are always read from the document service." />
              {documents === null ? (
                <Restricted text="Your role does not include transaction document visibility." />
              ) : documents.length === 0 ? (
                <Empty text="No transaction documents have been uploaded yet." />
              ) : (
                <div className={styles.documentList}>
                  {documents.filter((item) => item.status !== 'SUPERSEDED').map((document) => (
                    <article className={styles.documentCard} key={document.documentId}>
                      <div className={styles.rowBetween}>
                        <div>
                          <span className={styles.eyebrow}>{formatToken(document.category)}</span>
                          <strong>{document.filename ?? 'Awaiting upload'}</strong>
                          <small>Revision {document.revisionNumber} · {formatToken(document.status)}</small>
                        </div>
                        <span className={styles.miniStatus}>{formatToken(document.status)}</span>
                      </div>

                      {document.signatures.length > 0 ? (
                        <div className={styles.signatureChips}>
                          {document.signatures.map((signature) => (
                            <span key={`${signature.signerRole}:${signature.signedAt}`}>
                              {formatToken(signature.signerRole)} · {formatToken(signature.method)}
                            </span>
                          ))}
                        </div>
                      ) : null}

                      {can('documents.verify') && ['UPLOADED', 'REJECTED'].includes(document.status) ? (
                        <div className={styles.actionBox}>
                          <input
                            value={rejectReasons[document.documentId] ?? ''}
                            onChange={(event) => setRejectReasons((current) => ({ ...current, [document.documentId]: event.target.value }))}
                            placeholder="Rejection reason (required only to reject)"
                          />
                          <div className={styles.actionRow}>
                            <button disabled={Boolean(actionBusy)} type="button" onClick={() => void reviewDocument(document.documentId, 'VERIFY')}>Verify</button>
                            <button disabled={Boolean(actionBusy)} type="button" className={styles.dangerButton} onClick={() => void reviewDocument(document.documentId, 'REJECT')}>Reject</button>
                          </div>
                        </div>
                      ) : null}

                      {document.category === 'CONTRACT' && ['VERIFIED', 'SIGNED'].includes(document.status) ? (
                        <div className={styles.actionBox}>
                          {(can('contract.sign.self') || can('contract.sign.company')) ? (
                            <input value={typedName} onChange={(event) => setTypedName(event.target.value)} placeholder="Typed signer name" />
                          ) : null}
                          <div className={styles.actionRow}>
                            {can('contract.sign.self') && !buyerSigned && transaction.buyerUserId === workspace?.userId ? (
                              <button disabled={Boolean(actionBusy)} type="button" onClick={() => void addTypedSignature(document.documentId, 'BUYER')}>Sign as buyer</button>
                            ) : null}
                            {can('contract.sign.company') && !companySigned ? (
                              <button disabled={Boolean(actionBusy)} type="button" onClick={() => void addTypedSignature(document.documentId, 'COMPANY')}>Sign for company</button>
                            ) : null}
                            {can('contract.execute') && document.status !== 'STAMPED' ? (
                              <button disabled={Boolean(actionBusy)} type="button" onClick={() => void stampContract(document.documentId)}>Stamp contract</button>
                            ) : null}
                          </div>
                        </div>
                      ) : null}
                    </article>
                  ))}
                </div>
              )}
            </section>
          </div>

          <aside className={styles.secondaryColumn}>
            <section className={styles.panel}>
              <PanelHeading eyebrow="Finance" title="Payment schedule" detail="Installments and verification state." />
              {paymentSchedule === null ? (
                <Restricted text={can('payment.read') || can('installment.read.self') ? 'No payment schedule is configured yet.' : 'Payment schedule is restricted for this role.'} />
              ) : (
                <div className={styles.financeList}>
                  {paymentSchedule.items.map((item) => (
                    <article key={item.paymentItemId} className={styles.financeItem}>
                      <div className={styles.rowBetween}>
                        <div>
                          <strong>{formatToken(item.itemType)} #{item.sequenceNumber}</strong>
                          <span>{formatDate(item.dueAt)}</span>
                        </div>
                        <div className={styles.moneyRight}>
                          <strong>{money(item.amount, paymentSchedule.currency)}</strong>
                          <span>{formatToken(item.status)}</span>
                        </div>
                      </div>
                      {can('payment.verify') && !['PAID', 'WAIVED', 'CANCELLED'].includes(item.status) ? (
                        <div className={styles.inlineAction}>
                          <input
                            value={paymentReferences[item.paymentItemId] ?? ''}
                            onChange={(event) => setPaymentReferences((current) => ({ ...current, [item.paymentItemId]: event.target.value }))}
                            placeholder="Payment reference"
                          />
                          <button disabled={Boolean(actionBusy)} type="button" onClick={() => void markPaymentPaid(item.paymentItemId)}>Mark paid</button>
                        </div>
                      ) : null}
                    </article>
                  ))}
                </div>
              )}
            </section>

            <section className={styles.panel}>
              <PanelHeading eyebrow="Physical instruments" title="Cheques" detail="Receipt, deposit and clearing lifecycle." />
              {cheques === null ? (
                <Restricted text="Cheque details are restricted for this role." />
              ) : cheques.length === 0 ? (
                <Empty text="No cheques are configured for this transaction." />
              ) : (
                <div className={styles.financeList}>
                  {cheques.map((cheque) => (
                    <article className={styles.financeItem} key={cheque.chequeId}>
                      <div className={styles.rowBetween}>
                        <div>
                          <strong>Cheque #{cheque.sequenceNumber}</strong>
                          <span>{formatDate(cheque.dueAt)}</span>
                        </div>
                        <div className={styles.moneyRight}>
                          <strong>{money(cheque.amount, transaction.currency)}</strong>
                          <span>{formatToken(cheque.status)}</span>
                        </div>
                      </div>
                      {can('payment.verify') && !['CLEARED', 'CANCELLED'].includes(cheque.status) ? (
                        <div className={styles.actionBox}>
                          <div className={styles.twoInputs}>
                            <input
                              value={chequeNumbers[cheque.chequeId] ?? cheque.chequeNumber ?? ''}
                              onChange={(event) => setChequeNumbers((current) => ({ ...current, [cheque.chequeId]: event.target.value }))}
                              placeholder="Cheque number"
                            />
                            <input
                              value={chequeBanks[cheque.chequeId] ?? cheque.bankName ?? ''}
                              onChange={(event) => setChequeBanks((current) => ({ ...current, [cheque.chequeId]: event.target.value }))}
                              placeholder="Bank name"
                            />
                          </div>
                          <div className={styles.actionRow}>
                            {nextChequeActions(cheque.status).map((status) => (
                              <button
                                type="button"
                                disabled={Boolean(actionBusy)}
                                key={status}
                                className={status === 'RETURNED' || status === 'CANCELLED' ? styles.dangerButton : ''}
                                onClick={() => void updateCheque(cheque, status)}
                              >
                                {formatToken(status)}
                              </button>
                            ))}
                          </div>
                        </div>
                      ) : null}
                    </article>
                  ))}
                </div>
              )}
            </section>

            <section className={styles.panel}>
              <PanelHeading eyebrow="Broker" title="Commission" detail="Status and due timing are server-computed from transaction prerequisites." />
              {!commission ? (
                <Restricted text={can('commission.status.read') ? 'No broker commission case is visible for this transaction.' : 'Commission status is restricted for this role.'} />
              ) : (
                <div className={styles.commissionBody}>
                  <div className={styles.commissionStatus}>
                    <span>{formatToken(commission.status)}</span>
                    {commission.dueAt ? <strong>{commission.overdueSeconds ? `Overdue ${duration(commission.overdueSeconds)}` : `Due in ${duration(commission.dueInSeconds ?? 0)}`}</strong> : null}
                  </div>
                  {commission.commissionAmount ? (
                    <div className={styles.commissionAmount}>
                      <span>Commission amount</span>
                      <strong>{money(commission.commissionAmount, transaction.currency)}</strong>
                      {commission.ratePercent ? <small>{commission.ratePercent}% rate</small> : null}
                    </div>
                  ) : null}
                  {can('commission.payment.manage') ? (
                    <div className={styles.actionRow}>
                      {['ELIGIBLE', 'DUE'].includes(commission.status) ? <button type="button" disabled={Boolean(actionBusy)} onClick={() => void updateCommission('MARK_INVOICED')}>Mark invoiced</button> : null}
                      {['INVOICED', 'DUE'].includes(commission.status) ? <button type="button" disabled={Boolean(actionBusy)} onClick={() => void updateCommission('MARK_PAID')}>Mark paid</button> : null}
                      {!['PAID', 'CANCELLED', 'DISPUTED'].includes(commission.status) ? <button type="button" disabled={Boolean(actionBusy)} className={styles.dangerButton} onClick={() => void updateCommission('MARK_DISPUTED')}>Dispute</button> : null}
                    </div>
                  ) : null}
                </div>
              )}
            </section>
          </aside>
        </div>
      </div>
    </main>
  );
}

async function optionalFetch<T>(path: string, fallback: T | null): Promise<T | null> {
  try {
    return await apiFetch<T>(path);
  } catch (error) {
    if (error instanceof ApiError && [403, 404].includes(error.status)) return fallback;
    throw error;
  }
}

async function loadCommission(
  project: WorkspaceProjectSnapshot,
  transactionId: string,
): Promise<CommissionCaseSnapshot | null> {
  for (const brokerCompanyId of project.brokerCompanyIds) {
    try {
      const cases = await apiFetch<CommissionCaseSnapshot[]>(
        `/v1/tenants/${project.tenantId}/projects/${project.projectId}/brokers/${brokerCompanyId}/commissions`,
      );
      const match = cases.find((item) => item.transactionId === transactionId);
      if (match) return match;
    } catch (error) {
      if (error instanceof ApiError && [403, 404].includes(error.status)) continue;
      throw error;
    }
  }
  return null;
}

function PanelHeading(props: { eyebrow: string; title: string; detail: string }) {
  return (
    <header className={styles.panelHeading}>
      <span className={styles.eyebrow}>{props.eyebrow}</span>
      <h2>{props.title}</h2>
      <p>{props.detail}</p>
    </header>
  );
}

function Metric(props: { label: string; value: string }) {
  return (
    <article className={styles.metric}>
      <span>{props.label}</span>
      <strong>{props.value}</strong>
    </article>
  );
}

function Restricted({ text }: { text: string }) {
  return <div className={styles.restricted}>{text}</div>;
}

function Empty({ text }: { text: string }) {
  return <div className={styles.empty}>{text}</div>;
}

function nextChequeActions(status: ChequeSnapshot['status']): ChequeAction[] {
  switch (status) {
    case 'EXPECTED': return ['RECEIVED', 'CANCELLED'];
    case 'RECEIVED': return ['DEPOSITED', 'RETURNED', 'CANCELLED'];
    case 'DEPOSITED': return ['CLEARED', 'RETURNED'];
    case 'RETURNED': return ['RECEIVED', 'CANCELLED'];
    case 'CLEARED':
    case 'CANCELLED':
      return [];
  }
}

function clampPercent(value: string): number {
  return Math.min(100, Math.max(0, Number(value) || 0));
}

function formatToken(value: string): string {
  return value.toLowerCase().split('_').map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ');
}

function money(value: string, currency: string): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(Number(value));
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(value));
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function shortId(value: string): string {
  return value.length > 12 ? `${value.slice(0, 6)}…${value.slice(-4)}` : value;
}

function liveLabel(state: 'connecting' | 'live' | 'reconnecting' | 'offline'): string {
  switch (state) {
    case 'live': return 'Live connected';
    case 'connecting': return 'Connecting';
    case 'reconnecting': return 'Reconnecting';
    case 'offline': return 'Replay available';
  }
}

function duration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
}
