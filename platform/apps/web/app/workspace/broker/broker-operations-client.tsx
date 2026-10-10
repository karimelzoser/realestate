'use client';

import { roleHasPermission, type WorkspaceContextSnapshot, type WorkspaceProjectSnapshot } from '@preneura/contracts/access';
import type { BrokerCommissionContextSnapshot, CommissionCaseSnapshot } from '@preneura/contracts/commissions';
import type { TransactionListItemSnapshot } from '@preneura/contracts/sales';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ApiError, apiFetch } from '../../lib/api';
import styles from './broker.module.css';

type BrokerMode = 'AGENT' | 'MANAGER' | 'FINANCE';

export default function BrokerOperationsClient() {
  const [workspace, setWorkspace] = useState<WorkspaceContextSnapshot | null>(null);
  const [projectId, setProjectId] = useState('');
  const [brokers, setBrokers] = useState<BrokerCommissionContextSnapshot[]>([]);
  const [brokerCompanyId, setBrokerCompanyId] = useState('');
  const [transactions, setTransactions] = useState<TransactionListItemSnapshot[]>([]);
  const [cases, setCases] = useState<CommissionCaseSnapshot[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [, tick] = useState(0);

  const projects = useMemo(() => workspace?.projects.filter((project) =>
    project.roles.some((role) => ['BROKER_MANAGER', 'BROKER_FINANCE', 'BROKER_AGENT'].includes(role)),
  ) ?? [], [workspace]);
  const project = projects.find((item) => item.projectId === projectId) ?? null;
  const roles = project?.roles ?? [];
  const mode: BrokerMode = roles.includes('BROKER_MANAGER') ? 'MANAGER' : roles.includes('BROKER_FINANCE') ? 'FINANCE' : 'AGENT';
  const canManageUsers = roles.some((role) => roleHasPermission(role, 'broker.users.manage'));
  const canManagePayment = roles.some((role) => roleHasPermission(role, 'commission.payment.manage'));
  const canSeeAmount = roles.some((role) => roleHasPermission(role, 'commission.amount.read'));
  const canSeeRate = roles.some((role) => roleHasPermission(role, 'commission.rate.read'));
  const selectedBroker = brokers.find((item) => item.brokerCompanyId === brokerCompanyId) ?? null;

  const loadProject = useCallback(async (selected: WorkspaceProjectSnapshot) => {
    setLoading(true); setError('');
    try {
      const [brokerContexts, transactionRows] = await Promise.all([
        apiFetch<BrokerCommissionContextSnapshot[]>(`/v1/tenants/${selected.tenantId}/projects/${selected.projectId}/commission-brokers`),
        apiFetch<TransactionListItemSnapshot[]>(`/v1/tenants/${selected.tenantId}/projects/${selected.projectId}/transactions`),
      ]);
      setBrokers(brokerContexts);
      setTransactions(transactionRows);
      setBrokerCompanyId((current) => brokerContexts.some((item) => item.brokerCompanyId === current) ? current : brokerContexts[0]?.brokerCompanyId ?? '');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to load broker portfolio.');
    } finally { setLoading(false); }
  }, []);

  const loadCases = useCallback(async (selected: WorkspaceProjectSnapshot, companyId: string) => {
    if (!companyId) { setCases([]); return; }
    try {
      setCases(await apiFetch<CommissionCaseSnapshot[]>(`/v1/tenants/${selected.tenantId}/projects/${selected.projectId}/brokers/${companyId}/commissions`));
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to load commission cases.'); }
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => tick((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void apiFetch<WorkspaceContextSnapshot>('/v1/me/workspace').then((context) => {
      if (cancelled) return;
      const allowed = context.projects.filter((candidate) => candidate.roles.some((role) => ['BROKER_MANAGER', 'BROKER_FINANCE', 'BROKER_AGENT'].includes(role)));
      if (allowed.length === 0) { setError('No broker role is assigned to this account.'); setLoading(false); return; }
      setWorkspace(context);
      const stored = window.localStorage.getItem('preneura:selected-project');
      setProjectId(allowed.find((item) => item.projectId === stored)?.projectId ?? allowed[0]!.projectId);
    }).catch((reason) => {
      if (reason instanceof ApiError && reason.status === 401) { window.location.replace('/login'); return; }
      setError(reason instanceof Error ? reason.message : 'Unable to load broker workspace.'); setLoading(false);
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => { if (project) { window.localStorage.setItem('preneura:selected-project', project.projectId); void loadProject(project); } }, [project, loadProject]);
  useEffect(() => { if (project && brokerCompanyId) void loadCases(project, brokerCompanyId); }, [project, brokerCompanyId, loadCases]);

  const caseByTransaction = useMemo(() => new Map(cases.map((item) => [item.transactionId, item])), [cases]);
  const brokerTransactions = useMemo(() => brokerCompanyId ? transactions.filter((item) => item.brokerCompanyId === brokerCompanyId) : transactions, [transactions, brokerCompanyId]);
  const agents = useMemo(() => {
    const map = new Map<string, { id: string; name: string; buyers: number; completed: number }>();
    for (const row of brokerTransactions) {
      if (!row.brokerAgentUserId) continue;
      const current = map.get(row.brokerAgentUserId) ?? { id: row.brokerAgentUserId, name: row.brokerAgentDisplayName ?? 'Broker agent', buyers: 0, completed: 0 };
      current.buyers += 1;
      if (row.status === 'COMPLETED') current.completed += 1;
      map.set(row.brokerAgentUserId, current);
    }
    return [...map.values()];
  }, [brokerTransactions]);
  const overdue = cases.filter((item) => item.overdueSeconds && item.overdueSeconds > 0 && item.status !== 'PAID').length;
  const eligible = cases.filter((item) => ['ELIGIBLE', 'INVOICED', 'DUE'].includes(item.status)).length;
  const collected = cases.filter((item) => item.status === 'PAID').length;

  function exportCsv() {
    if (!project || !selectedBroker) return;
    const headers = ['Buyer', 'Agent', 'Unit type', 'Transaction status', 'Completion %', 'Commission status', 'Commission due', 'Countdown', ...(canSeeAmount ? ['Commission amount'] : []), ...(canSeeRate ? ['Rate %'] : [])];
    const rows = brokerTransactions.map((row) => {
      const commission = caseByTransaction.get(row.transactionId);
      return [row.buyerDisplayName, row.brokerAgentDisplayName ?? '', row.unitTypeName, row.status, row.completionPercent, commission?.status ?? 'NOT_CREATED', commission?.dueAt ?? '', commission ? countdown(commission) : '', ...(canSeeAmount ? [commission?.commissionAmount ?? ''] : []), ...(canSeeRate ? [commission?.ratePercent ?? ''] : [])];
    });
    const csv = [headers, ...rows].map((row) => row.map(csvCell).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = `${project.projectCode}-${selectedBroker.code}-broker-portfolio.csv`; anchor.click(); URL.revokeObjectURL(url);
  }

  return <main className={styles.page}>
    <header className={styles.header}>
      <div><a href="/workspace" className={styles.back}>← Workspace</a><p className={styles.eyebrow}>BROKER OPERATIONS</p><h1>{selectedBroker?.name ?? 'Broker workspace'}</h1><p>{mode === 'AGENT' ? 'Your buyers, completion progress and commission timing. Financial rate and amount are intentionally hidden.' : mode === 'FINANCE' ? 'Commission eligibility, invoices, due dates, collection and settlement.' : 'Company buyers, agents, completion performance and commission operations.'}</p></div>
      <div className={styles.controls}>{projects.length > 1 ? <select value={projectId} onChange={(event) => setProjectId(event.target.value)}>{projects.map((item) => <option key={item.projectId} value={item.projectId}>{item.projectName}</option>)}</select> : null}{brokers.length > 1 ? <select value={brokerCompanyId} onChange={(event) => setBrokerCompanyId(event.target.value)}>{brokers.map((item) => <option key={item.brokerCompanyId} value={item.brokerCompanyId}>{item.name}</option>)}</select> : null}<button onClick={exportCsv} disabled={!selectedBroker}>Export CSV</button></div>
    </header>
    {error ? <div className={styles.error}>{error}</div> : null}
    {loading ? <div className={styles.loading}>Loading broker portfolio…</div> : null}
    {!loading ? <>
      <section className={styles.metrics}><Metric label="Buyers" value={brokerTransactions.length}/><Metric label="Commission eligible" value={eligible}/><Metric label="Overdue" value={overdue}/><Metric label="Collected" value={collected}/></section>
      <section className={styles.tools}>{canManageUsers ? <a href="/workspace/accounts">Manage broker agents</a> : null}<a href="/workspace/commissions">Commission control</a>{canManagePayment ? <a href="/workspace/settlements">Settlement & payout</a> : null}</section>
      {mode !== 'AGENT' && agents.length > 0 ? <section className={styles.panel}><div className={styles.panelHead}><div><p className={styles.eyebrow}>TEAM</p><h2>Agent performance</h2></div></div><div className={styles.agentGrid}>{agents.map((agent) => <article key={agent.id}><strong>{agent.name}</strong><span>{agent.buyers} buyer{agent.buyers === 1 ? '' : 's'}</span><small>{agent.completed} completed</small></article>)}</div></section> : null}
      <section className={styles.panel}><div className={styles.panelHead}><div><p className={styles.eyebrow}>BUYER PIPELINE</p><h2>{mode === 'AGENT' ? 'My buyers' : 'Company buyers'}</h2></div><span className={styles.privacy}>{canSeeAmount || canSeeRate ? 'Financial fields follow your role.' : 'Commission percentage and amount hidden.'}</span></div><div className={styles.tableWrap}><table><thead><tr><th>Buyer</th><th>Agent</th><th>Unit</th><th>Completion</th><th>Next step</th><th>Commission</th><th>Countdown</th>{canSeeAmount ? <th>Amount</th> : null}{canSeeRate ? <th>Rate</th> : null}</tr></thead><tbody>{brokerTransactions.map((row) => { const commission = caseByTransaction.get(row.transactionId); return <tr key={row.transactionId}><td><a href={`/workspace/transactions/${row.transactionId}?tenantId=${project?.tenantId ?? ''}&projectId=${project?.projectId ?? ''}`}>{row.buyerDisplayName}</a><small>{row.status}</small></td><td>{row.brokerAgentDisplayName ?? '—'}</td><td>{row.unitTypeName}</td><td><div className={styles.progress}><span style={{ width: `${Math.min(100, Math.max(0, Number(row.completionPercent)))}%` }}/></div><small>{Number(row.completionPercent).toFixed(0)}%</small></td><td>{nextStep(row.completionPercent, commission)}</td><td><Status value={commission?.status ?? 'NOT_CREATED'}/></td><td>{commission ? countdown(commission) : '—'}</td>{canSeeAmount ? <td>{commission?.commissionAmount ?? '—'}</td> : null}{canSeeRate ? <td>{commission?.ratePercent ? `${commission.ratePercent}%` : '—'}</td> : null}</tr>; })}</tbody></table>{brokerTransactions.length === 0 ? <p className={styles.empty}>No broker-attributed transactions are visible to this role.</p> : null}</div></section>
    </> : null}
  </main>;
}

function Metric({ label, value }: { label: string; value: number }) { return <div className={styles.metric}><span>{label}</span><strong>{value}</strong></div>; }
function Status({ value }: { value: string }) { return <span className={styles.status}>{value.replaceAll('_', ' ')}</span>; }
function nextStep(completion: string, commission?: CommissionCaseSnapshot) { if (commission?.prerequisitesComplete) return commission.status === 'PAID' ? 'Commission collected' : 'Finance follow-up'; const value = Number(completion); if (value < 20) return 'Documents'; if (value < 45) return 'Down payment'; if (value < 65) return 'Cheques'; if (value < 85) return 'Contract signatures'; if (value < 100) return 'Company stamp'; return 'Commission eligibility'; }
function countdown(item: CommissionCaseSnapshot): string { if (item.status === 'PAID') return 'Paid'; if (item.overdueSeconds && item.overdueSeconds > 0) return `${Math.ceil(item.overdueSeconds / 86400)}d overdue`; if (item.dueInSeconds !== null && item.dueInSeconds >= 0) return `${Math.ceil(item.dueInSeconds / 86400)}d remaining`; return item.prerequisitesComplete ? 'Due date pending' : 'Waiting prerequisites'; }
function csvCell(value: unknown) { const text = String(value ?? ''); return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text; }
