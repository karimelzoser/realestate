'use client';

import {
  roleHasPermission,
  type WorkspaceContextSnapshot,
  type WorkspaceProjectSnapshot,
} from '@preneura/contracts/access';
import type {
  BrokerCommissionContextSnapshot,
  CommissionCaseSnapshot,
} from '@preneura/contracts/commissions';
import type { EoiRefundRequestSnapshot } from '@preneura/contracts/sales';
import type {
  SettlementSnapshot,
  SettlementSummarySnapshot,
} from '@preneura/contracts/settlements';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ApiError, apiFetch } from '../../lib/api';
import styles from './settlement-operations.module.css';

interface SubmissionDraft { provider: string; reference: string }

export default function SettlementOperationsClient() {
  const [workspace, setWorkspace] = useState<WorkspaceContextSnapshot | null>(null);
  const [projectId, setProjectId] = useState('');
  const [refunds, setRefunds] = useState<EoiRefundRequestSnapshot[]>([]);
  const [refundSettlements, setRefundSettlements] = useState<SettlementSummarySnapshot[]>([]);
  const [brokers, setBrokers] = useState<BrokerCommissionContextSnapshot[]>([]);
  const [brokerCompanyId, setBrokerCompanyId] = useState('');
  const [commissions, setCommissions] = useState<CommissionCaseSnapshot[]>([]);
  const [commissionSettlements, setCommissionSettlements] = useState<SettlementSummarySnapshot[]>([]);
  const [drafts, setDrafts] = useState<Record<string, SubmissionDraft>>({});
  const [busy, setBusy] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const projects = useMemo(
    () => workspace?.projects.filter((project) => project.roles.some((role) =>
      roleHasPermission(role, 'refund.payout.manage') || roleHasPermission(role, 'commission.payment.manage'),
    )) ?? [],
    [workspace],
  );
  const project = useMemo(
    () => projects.find((candidate) => candidate.projectId === projectId) ?? null,
    [projects, projectId],
  );
  const canRefund = Boolean(project?.roles.some((role) => roleHasPermission(role, 'refund.payout.manage')));
  const canCommission = Boolean(project?.roles.some((role) => roleHasPermission(role, 'commission.payment.manage')));

  const latestRefundSettlement = useMemo(
    () => latestBySource(refundSettlements, 'eoiRefundRequestId'),
    [refundSettlements],
  );
  const latestCommissionSettlement = useMemo(
    () => latestBySource(commissionSettlements, 'commissionCaseId'),
    [commissionSettlements],
  );

  useEffect(() => {
    let cancelled = false;
    void apiFetch<WorkspaceContextSnapshot>('/v1/me/workspace')
      .then((context) => {
        if (cancelled) return;
        const allowed = context.projects.filter((candidate) => candidate.roles.some((role) =>
          roleHasPermission(role, 'refund.payout.manage') || roleHasPermission(role, 'commission.payment.manage'),
        ));
        if (allowed.length === 0) {
          setError('Your account does not have payout execution authority.');
          setLoading(false);
          return;
        }
        setWorkspace(context);
        const stored = window.localStorage.getItem('preneura:selected-project');
        const selected = allowed.find((candidate) => candidate.projectId === stored) ?? allowed[0]!;
        setProjectId(selected.projectId);
      })
      .catch((reason) => {
        if (reason instanceof ApiError && reason.status === 401) {
          window.location.replace('/login');
          return;
        }
        setError(reason instanceof Error ? reason.message : 'Unable to load settlement access.');
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  const loadProject = useCallback(async (selected: WorkspaceProjectSnapshot): Promise<void> => {
    setLoading(true);
    setError('');
    try {
      const refundAllowed = selected.roles.some((role) => roleHasPermission(role, 'refund.payout.manage'));
      const commissionAllowed = selected.roles.some((role) => roleHasPermission(role, 'commission.payment.manage'));
      const [refundRequests, refundPayouts, brokerContexts] = await Promise.all([
        refundAllowed
          ? apiFetch<EoiRefundRequestSnapshot[]>(`/v1/tenants/${selected.tenantId}/projects/${selected.projectId}/refund-requests`)
          : Promise.resolve([]),
        refundAllowed
          ? apiFetch<SettlementSummarySnapshot[]>(`/v1/tenants/${selected.tenantId}/projects/${selected.projectId}/refund-settlements`)
          : Promise.resolve([]),
        commissionAllowed
          ? apiFetch<BrokerCommissionContextSnapshot[]>(`/v1/tenants/${selected.tenantId}/projects/${selected.projectId}/commission-brokers`)
          : Promise.resolve([]),
      ]);
      setRefunds(refundRequests);
      setRefundSettlements(refundPayouts);
      setBrokers(brokerContexts);
      setBrokerCompanyId((current) => brokerContexts.some((item) => item.brokerCompanyId === current)
        ? current
        : brokerContexts[0]?.brokerCompanyId ?? '');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to load payout operations.');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadCommission = useCallback(async (
    selected: WorkspaceProjectSnapshot,
    selectedBrokerCompanyId: string,
  ): Promise<void> => {
    if (!selectedBrokerCompanyId) {
      setCommissions([]);
      setCommissionSettlements([]);
      return;
    }
    try {
      const [cases, settlements] = await Promise.all([
        apiFetch<CommissionCaseSnapshot[]>(
          `/v1/tenants/${selected.tenantId}/projects/${selected.projectId}/brokers/${selectedBrokerCompanyId}/commissions`,
        ),
        apiFetch<SettlementSummarySnapshot[]>(
          `/v1/tenants/${selected.tenantId}/projects/${selected.projectId}/brokers/${selectedBrokerCompanyId}/commission-settlements`,
        ),
      ]);
      setCommissions(cases);
      setCommissionSettlements(settlements);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to load commission settlements.');
    }
  }, []);

  useEffect(() => {
    if (!project) return;
    window.localStorage.setItem('preneura:selected-project', project.projectId);
    setRefunds([]);
    setRefundSettlements([]);
    setBrokers([]);
    setBrokerCompanyId('');
    setCommissions([]);
    setCommissionSettlements([]);
    setSuccess('');
    void loadProject(project);
  }, [project, loadProject]);

  useEffect(() => {
    if (!project || !brokerCompanyId || !canCommission) return;
    void loadCommission(project, brokerCompanyId);
  }, [project, brokerCompanyId, canCommission, loadCommission]);

  useEffect(() => {
    if (!project) return;
    const timer = window.setInterval(() => {
      void loadProject(project);
      if (brokerCompanyId && canCommission) void loadCommission(project, brokerCompanyId);
    }, 15000);
    return () => window.clearInterval(timer);
  }, [project, brokerCompanyId, canCommission, loadProject, loadCommission]);

  async function createRefundSettlement(request: EoiRefundRequestSnapshot): Promise<void> {
    if (!project || busy) return;
    setBusy(`refund:${request.refundRequestId}`);
    setError('');
    setSuccess('');
    try {
      await apiFetch<SettlementSnapshot>(
        `/v1/tenants/${project.tenantId}/projects/${project.projectId}/refunds/${request.refundRequestId}/settlements`,
        { method: 'POST', body: JSON.stringify({ idempotencyKey: crypto.randomUUID() }) },
      );
      setSuccess('Refund payout record created. Submit the external transfer reference next.');
      await loadProject(project);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to create refund payout.');
    } finally { setBusy(''); }
  }

  async function createCommissionSettlement(item: CommissionCaseSnapshot): Promise<void> {
    if (!project || !brokerCompanyId || busy) return;
    setBusy(`commission:${item.commissionCaseId}`);
    setError('');
    setSuccess('');
    try {
      await apiFetch<SettlementSnapshot>(
        `/v1/tenants/${project.tenantId}/projects/${project.projectId}/brokers/${brokerCompanyId}/commissions/${item.commissionCaseId}/settlements`,
        { method: 'POST', body: JSON.stringify({ idempotencyKey: crypto.randomUUID() }) },
      );
      setSuccess('Commission payout record created. Submit the external transfer reference next.');
      await loadCommission(project, brokerCompanyId);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to create commission payout.');
    } finally { setBusy(''); }
  }

  async function submitSettlement(settlement: SettlementSummarySnapshot): Promise<void> {
    if (!project || busy) return;
    const draft = drafts[settlement.settlementId] ?? { provider: '', reference: '' };
    if (!draft.provider.trim() || !draft.reference.trim()) {
      setError('Provider and external transfer/reference ID are required before submission.');
      return;
    }
    setBusy(`submit:${settlement.settlementId}`);
    setError('');
    setSuccess('');
    try {
      await apiFetch<SettlementSnapshot>(
        `/v1/tenants/${project.tenantId}/projects/${project.projectId}/settlements/${settlement.settlementId}/submit`,
        {
          method: 'POST',
          body: JSON.stringify({ provider: draft.provider.trim(), providerReference: draft.reference.trim() }),
        },
      );
      setSuccess('Payout submitted. PRENEURA will mark it paid only after provider settlement evidence arrives.');
      setDrafts((current) => {
        const next = { ...current };
        delete next[settlement.settlementId];
        return next;
      });
      await loadProject(project);
      if (brokerCompanyId && canCommission) await loadCommission(project, brokerCompanyId);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to submit payout.');
    } finally { setBusy(''); }
  }

  function updateDraft(settlementId: string, field: keyof SubmissionDraft, value: string): void {
    setDrafts((current) => ({
      ...current,
      [settlementId]: { provider: '', reference: '', ...current[settlementId], [field]: value },
    }));
  }

  if (!workspace && loading) {
    return <main className={styles.statePage}><div className={styles.loadingMark}>P</div><p>Loading settlement operations…</p></main>;
  }

  return (
    <main className={styles.page}>
      <header className={styles.topbar}>
        <a href="/workspace" className={styles.back}>←</a>
        <div className={styles.brand}>P</div>
        <div><strong>PRENEURA Settlement Center</strong><span>Controlled outgoing money</span></div>
        <select value={projectId} onChange={(event) => setProjectId(event.target.value)}>
          {projects.map((item) => <option key={item.projectId} value={item.projectId}>{item.projectName}</option>)}
        </select>
      </header>

      <section className={styles.content}>
        <div className={styles.hero}>
          <div><span>Financial control</span><h1>Approve elsewhere. Pay here. Confirm only from evidence.</h1></div>
          <p>Creating or submitting a payout never marks money paid. Only immutable bank/ERP/provider settlement evidence can close the obligation.</p>
        </div>
        {error ? <div className={styles.error}>{error}</div> : null}
        {success ? <div className={styles.success}>{success}</div> : null}

        {canRefund ? (
          <section className={styles.panel}>
            <div className={styles.panelHeading}><div><span>EOI refunds</span><h2>Approved buyer refunds</h2></div><small>{refunds.filter((item) => item.status === 'APPROVED').length} approved</small></div>
            <div className={styles.grid}>
              {refunds.filter((item) => ['APPROVED','PAID'].includes(item.status)).map((request) => {
                const settlement = latestRefundSettlement.get(request.refundRequestId) ?? null;
                return (
                  <article className={styles.card} key={request.refundRequestId}>
                    <div className={styles.cardHead}><div><span>{request.buyerDisplayName}</span><strong>{money(Number(request.requestedAmount), request.currency)}</strong></div><Status value={settlement?.status ?? request.status} /></div>
                    <p>Refund #{shortId(request.refundRequestId)} · {request.stage.replaceAll('_', ' ').toLowerCase()}</p>
                    <SettlementActions settlement={settlement} busy={busy} drafts={drafts} onCreate={() => void createRefundSettlement(request)} onDraft={updateDraft} onSubmit={submitSettlement} canCreate={request.status === 'APPROVED'} />
                  </article>
                );
              })}
            </div>
          </section>
        ) : null}

        {canCommission ? (
          <section className={styles.panel}>
            <div className={styles.panelHeading}>
              <div><span>Broker commissions</span><h2>Developer payout queue</h2></div>
              <select value={brokerCompanyId} onChange={(event) => setBrokerCompanyId(event.target.value)}>
                {brokers.length === 0 ? <option value="">No broker companies</option> : null}
                {brokers.map((item) => <option key={item.brokerCompanyId} value={item.brokerCompanyId}>{item.name}</option>)}
              </select>
            </div>
            <div className={styles.grid}>
              {commissions.filter((item) => ['INVOICED','DUE','PAID'].includes(item.status)).map((item) => {
                const settlement = latestCommissionSettlement.get(item.commissionCaseId) ?? null;
                return (
                  <article className={styles.card} key={item.commissionCaseId}>
                    <div className={styles.cardHead}><div><span>Transaction {shortId(item.transactionId)}</span><strong>{item.commissionAmount ? money(Number(item.commissionAmount), project?.currency ?? 'EGP') : 'Commission payout'}</strong></div><Status value={settlement?.status ?? item.status} /></div>
                    <p>Commission case #{shortId(item.commissionCaseId)} · {item.status.toLowerCase().replaceAll('_', ' ')}</p>
                    <SettlementActions settlement={settlement} busy={busy} drafts={drafts} onCreate={() => void createCommissionSettlement(item)} onDraft={updateDraft} onSubmit={submitSettlement} canCreate={['INVOICED','DUE'].includes(item.status)} />
                  </article>
                );
              })}
            </div>
          </section>
        ) : null}
      </section>
    </main>
  );
}

function SettlementActions(props: {
  settlement: SettlementSummarySnapshot | null;
  busy: string;
  drafts: Record<string, SubmissionDraft>;
  onCreate: () => void;
  onDraft: (settlementId: string, field: keyof SubmissionDraft, value: string) => void;
  onSubmit: (settlement: SettlementSummarySnapshot) => Promise<void>;
  canCreate: boolean;
}) {
  if (!props.settlement || ['FAILED','REVERSED','CANCELLED'].includes(props.settlement.status)) {
    return props.canCreate ? <button className={styles.primary} type="button" disabled={Boolean(props.busy)} onClick={props.onCreate}>Create payout record</button> : null;
  }
  if (props.settlement.status === 'PENDING_SUBMISSION') {
    const draft = props.drafts[props.settlement.settlementId] ?? { provider: '', reference: '' };
    return (
      <div className={styles.submitBox}>
        <input placeholder="Provider / bank / ERP" value={draft.provider} onChange={(event) => props.onDraft(props.settlement!.settlementId, 'provider', event.target.value)} />
        <input placeholder="External transfer/reference ID" value={draft.reference} onChange={(event) => props.onDraft(props.settlement!.settlementId, 'reference', event.target.value)} />
        <button className={styles.primary} type="button" disabled={Boolean(props.busy)} onClick={() => void props.onSubmit(props.settlement!)}>Submit payout</button>
      </div>
    );
  }
  return (
    <div className={styles.evidence}>
      <strong>{props.settlement.status === 'SETTLED' ? 'Provider-confirmed settlement' : 'Awaiting provider outcome'}</strong>
      <span>{props.settlement.provider ?? 'Provider pending'}{props.settlement.providerReference ? ` · ${props.settlement.providerReference}` : ''}</span>
      <small>{props.settlement.settledAt ? `Settled ${formatDate(props.settlement.settledAt)}` : props.settlement.submittedAt ? `Submitted ${formatDate(props.settlement.submittedAt)}` : ''}</small>
    </div>
  );
}

function Status({ value }: { value: string }) {
  return <span className={styles.status}>{value.toLowerCase().replaceAll('_', ' ')}</span>;
}

function latestBySource(items: SettlementSummarySnapshot[], key: 'eoiRefundRequestId' | 'commissionCaseId'): Map<string, SettlementSummarySnapshot> {
  const map = new Map<string, SettlementSummarySnapshot>();
  for (const item of items) {
    const source = item[key];
    if (source && !map.has(source)) map.set(source, item);
  }
  return map;
}

function shortId(value: string): string { return value.length > 12 ? `${value.slice(0, 6)}…${value.slice(-4)}` : value; }
function formatDate(value: string): string { return new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)); }
function money(value: number, currency: string): string { return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 0 }).format(value); }
