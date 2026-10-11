'use client';

import { roleHasPermission, type WorkspaceContextSnapshot } from '@preneura/contracts/access';
import type { EoiPolicySnapshot, InvitedProjectBuyerSnapshot, ProjectBuyerSnapshot } from '@preneura/contracts/sales';
import type { UnitTypeCommercialSnapshot } from '@preneura/contracts/catalog';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ApiError, apiFetch } from '../../lib/api';
import styles from './sales.module.css';
import { useLocale } from '../../locale-provider';
import { eoiMessages } from '../../../lib/eoi-messages';

const projectStorageKey = 'preneura:selected-project';

type InviteForm = {
  displayName: string;
  phone: string;
  verificationChannel: 'WHATSAPP' | 'SMS';
  source: 'DIRECT' | 'INTERNAL';
};

const emptyInvite: InviteForm = {
  displayName: '',
  phone: '',
  verificationChannel: 'WHATSAPP',
  source: 'INTERNAL',
};

export default function SalesBuyersClient() {
  const { locale, formatAmount } = useLocale();
  const copy = eoiMessages[locale];
  const [workspace, setWorkspace] = useState<WorkspaceContextSnapshot | null>(null);
  const [projectId, setProjectId] = useState('');
  const [buyers, setBuyers] = useState<ProjectBuyerSnapshot[]>([]);
  const [catalog, setCatalog] = useState<UnitTypeCommercialSnapshot[]>([]);
  const [eoiPolicy, setEoiPolicy] = useState<EoiPolicySnapshot | null>(null);
  const [eoiChoices, setEoiChoices] = useState<Record<string, { unitTypeId: string; accepted: boolean }>>({});
  const [invite, setInvite] = useState<InviteForm>(emptyInvite);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const projects = useMemo(() => workspace?.projects.filter((project) =>
    project.roles.some((role) =>
      roleHasPermission(role, 'buyers.read') ||
      roleHasPermission(role, 'buyers.manage') ||
      roleHasPermission(role, 'eoi.manage'),
    ),
  ) ?? [], [workspace]);
  const project = projects.find((item) => item.projectId === projectId) ?? null;
  const canInvite = Boolean(project?.roles.some((role) => roleHasPermission(role, 'buyers.manage')));
  const canCreateEoi = Boolean(project?.roles.some((role) => roleHasPermission(role, 'eoi.manage')));

  const loadBuyers = useCallback(async (tenantId: string, selectedProjectId: string) => {
    const data = await apiFetch<ProjectBuyerSnapshot[]>(
      `/v1/tenants/${tenantId}/projects/${selectedProjectId}/buyers`,
    );
    setBuyers(data);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void apiFetch<WorkspaceContextSnapshot>('/v1/me/workspace')
      .then((context) => {
        if (cancelled) return;
        const eligible = context.projects.filter((candidate) => candidate.roles.some((role) =>
          roleHasPermission(role, 'buyers.read') ||
          roleHasPermission(role, 'buyers.manage') ||
          roleHasPermission(role, 'eoi.manage'),
        ));
        setWorkspace(context);
        if (eligible.length === 0) {
          setError('Sales buyer operations are not available for this account.');
          setLoading(false);
          return;
        }
        const stored = window.localStorage.getItem(projectStorageKey);
        setProjectId(eligible.some((candidate) => candidate.projectId === stored)
          ? stored!
          : eligible[0]!.projectId);
      })
      .catch((reason: unknown) => {
        if (reason instanceof ApiError && reason.status === 401) {
          window.location.replace('/login');
          return;
        }
        setError(reason instanceof Error ? reason.message : 'Unable to load sales workspace.');
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!project) return;
    let cancelled = false;
    window.localStorage.setItem(projectStorageKey, project.projectId);
    setLoading(true);
    setError('');
    setEoiPolicy(null);
    setCatalog([]);
    setEoiChoices({});
    void Promise.all([
      loadBuyers(project.tenantId, project.projectId),
      apiFetch<UnitTypeCommercialSnapshot[]>(`/v1/tenants/${project.tenantId}/projects/${project.projectId}/catalog`),
      apiFetch<EoiPolicySnapshot | null>(`/v1/tenants/${project.tenantId}/projects/${project.projectId}/eoi-policy`),
    ]).then(([, units, policy]) => {
      if (!cancelled) { setCatalog(units); setEoiPolicy(policy); }
    })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : 'Unable to load project buyers.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [project, loadBuyers]);

  async function inviteBuyer(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!project || !canInvite) return;
    setBusy('invite');
    setError('');
    setMessage('');
    try {
      const result = await apiFetch<InvitedProjectBuyerSnapshot>(
        `/v1/tenants/${project.tenantId}/projects/${project.projectId}/buyers/invite`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(invite),
        },
      );
      setInvite(emptyInvite);
      setMessage(
        result.verificationDispatched
          ? `Buyer invited. Verification was sent to ${result.contactDisplayHint}.`
          : `Buyer created as pending (${result.contactDisplayHint}), but verification delivery needs retry by an account administrator.`,
      );
      await loadBuyers(project.tenantId, project.projectId);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to invite buyer.');
    } finally {
      setBusy(null);
    }
  }

  async function createEoi(buyer: ProjectBuyerSnapshot): Promise<void> {
    const choice = eoiChoices[buyer.buyerProfileId];
    if (!project || !canCreateEoi || !eoiPolicy || !choice?.unitTypeId || !choice.accepted) return;
    setBusy(`eoi:${buyer.buyerProfileId}`);
    setError('');
    setMessage('');
    try {
      const result = await apiFetch<{ eoiId: string; amount: string; currency: string }>(
        `/v1/tenants/${project.tenantId}/projects/${project.projectId}/buyers/${buyer.buyerProfileId}/eois`,
        { method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ unitTypeId: choice.unitTypeId, refundPolicyId: eoiPolicy.refundPolicyId, acceptedPolicy: true }) },
      );
      setMessage(`${buyer.displayName} · ${formatAmount(result.amount, result.currency)} · ${copy.pending}`);
      await loadBuyers(project.tenantId, project.projectId);
    } catch (reason) {
      setError(copy.failed);
      setEoiChoices((current) => ({ ...current, [buyer.buyerProfileId]: { unitTypeId: choice.unitTypeId, accepted: false } }));
      const freshPolicy = await apiFetch<EoiPolicySnapshot | null>(`/v1/tenants/${project.tenantId}/projects/${project.projectId}/eoi-policy`).catch(() => null);
      setEoiPolicy(freshPolicy);
    } finally {
      setBusy(null);
    }
  }

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <a href="/workspace" className={styles.back}>← Workspace</a>
          <p className={styles.eyebrow}>SALES</p>
          <h1>Buyers & EOIs</h1>
          <p className={styles.subtitle}>Onboard customer identities securely, follow verification state and initiate EOI. Money verification remains separated from Sales.</p>
        </div>
        {projects.length > 1 ? (
          <label className={styles.projectPicker}>
            <span>Project</span>
            <select value={projectId} onChange={(event) => setProjectId(event.target.value)}>
              {projects.map((candidate) => <option key={candidate.projectId} value={candidate.projectId}>{candidate.projectName}</option>)}
            </select>
          </label>
        ) : null}
      </header>

      {message ? <div className={styles.success}>{message}</div> : null}
      {error ? <div className={styles.error}>{error}</div> : null}

      {canCreateEoi ? <section className={styles.policyCard} aria-label={copy.title}>
        <h2>{copy.title}</h2><p>{copy.distinction}</p>
        {eoiPolicy ? <dl>
          <div><dt>{copy.amount}</dt><dd>{formatAmount(eoiPolicy.amount, eoiPolicy.currency)}</dd></div>
          <div><dt>{copy.policy}</dt><dd>{eoiPolicy.name} · {copy.version} {eoiPolicy.versionNumber}</dd></div>
          <div><dt>{copy.before}</dt><dd>{eoiPolicy.beforeReservationRefundPercent}%</dd></div>
          <div><dt>{copy.after}</dt><dd>{eoiPolicy.afterReservationBeforeContractRefundPercent}%</dd></div>
          <div><dt>{copy.contract}</dt><dd>{eoiPolicy.afterContractRefundPercent}%</dd></div>
          <div><dt>{copy.fee}</dt><dd>{formatAmount(eoiPolicy.processingFee, eoiPolicy.currency)}</dd></div>
        </dl> : <p>{copy.unavailable}</p>}
      </section> : null}

      {canInvite ? (
        <section className={styles.inviteCard}>
          <div>
            <p className={styles.sectionLabel}>NEW BUYER</p>
            <h2>Invite customer</h2>
            <p>The phone is encrypted at rest. The account stays pending until the buyer verifies the one-time enrollment code.</p>
          </div>
          <form className={styles.inviteForm} onSubmit={(event) => void inviteBuyer(event)}>
            <label>
              <span>Customer name</span>
              <input required minLength={2} maxLength={160} value={invite.displayName} onChange={(event) => setInvite((current) => ({ ...current, displayName: event.target.value }))} />
            </label>
            <label>
              <span>Phone</span>
              <input required inputMode="tel" placeholder="+20…" value={invite.phone} onChange={(event) => setInvite((current) => ({ ...current, phone: event.target.value }))} />
            </label>
            <label>
              <span>Verification</span>
              <select value={invite.verificationChannel} onChange={(event) => setInvite((current) => ({ ...current, verificationChannel: event.target.value as InviteForm['verificationChannel'] }))}>
                <option value="WHATSAPP">WhatsApp</option>
                <option value="SMS">SMS</option>
              </select>
            </label>
            <label>
              <span>Source</span>
              <select value={invite.source} onChange={(event) => setInvite((current) => ({ ...current, source: event.target.value as InviteForm['source'] }))}>
                <option value="INTERNAL">Sales / internal</option>
                <option value="DIRECT">Direct customer</option>
              </select>
            </label>
            <button type="submit" disabled={busy === 'invite'}>{busy === 'invite' ? 'Creating…' : 'Create & send verification'}</button>
          </form>
        </section>
      ) : null}

      <section className={styles.listCard}>
        <div className={styles.listHeader}>
          <div>
            <p className={styles.sectionLabel}>PROJECT BUYERS</p>
            <h2>{buyers.length} buyer{buyers.length === 1 ? '' : 's'}</h2>
          </div>
          <span className={styles.separation}>Sales cannot mark EOI payments paid</span>
        </div>
        {loading ? <div className={styles.empty}>Loading buyers…</div> : null}
        {!loading && buyers.length === 0 ? <div className={styles.empty}>No buyers are attached to this project yet.</div> : null}
        <div className={styles.buyers}>
          {buyers.map((buyer) => {
            const canStartEoi = !loading && canCreateEoi && (!buyer.latestEoi || ['REFUNDED', 'CANCELLED', 'EXPIRED'].includes(buyer.latestEoi.status));
            const choice = eoiChoices[buyer.buyerProfileId];
            const selectedType = catalog.find((item) => item.unitTypeId === choice?.unitTypeId);
            return (
              <article className={styles.buyer} key={buyer.buyerProfileId}>
                <div className={styles.identity}>
                  <strong>{buyer.displayName}</strong>
                  <span>{buyer.contactDisplayHint ?? 'Phone not available'} · {buyer.contactVerified ? 'verified' : 'verification pending'}</span>
                </div>
                <div className={styles.meta}>
                  <span data-state={buyer.accountStatus}>{buyer.accountStatus}</span>
                  <span>{buyer.source}</span>
                </div>
                <div className={styles.eoi}>
                  {buyer.latestEoi ? (
                    <>
                      <strong>{formatAmount(buyer.latestEoi.amount, buyer.latestEoi.currency)}</strong>
                      <span>{buyer.latestEoi.selectedUnitTypeName ?? copy.legacy}</span>
                      <span data-eoi={buyer.latestEoi.status}>{human(buyer.latestEoi.status)}</span>
                    </>
                  ) : (
                    <span>No EOI</span>
                  )}
                </div>
                <div className={styles.actions}>
                  {canStartEoi ? (
                    <form className={styles.eoiChoice} onSubmit={(event) => { event.preventDefault(); void createEoi(buyer); }}>
                      <label><span>{copy.type}</span><select required value={choice?.unitTypeId ?? ''}
                        onChange={(event) => setEoiChoices((current) => ({ ...current, [buyer.buyerProfileId]: { unitTypeId: event.target.value, accepted: false } }))}>
                        <option value="">{copy.choose}</option>
                        {catalog.map((item) => <option key={item.unitTypeId} value={item.unitTypeId}>{item.name} · {item.code}</option>)}
                      </select></label>
                      {selectedType ? <small>{copy.current}: {selectedType.currentTotalPrice ? formatAmount(selectedType.currentTotalPrice, selectedType.currency) : copy.noPrice}</small> : null}
                      <label className={styles.acceptPolicy}><input type="checkbox" required checked={choice?.accepted ?? false}
                        onChange={(event) => setEoiChoices((current) => ({ ...current, [buyer.buyerProfileId]: { unitTypeId: choice?.unitTypeId ?? '', accepted: event.target.checked } }))} />{copy.accept}</label>
                      <button type="submit" disabled={!eoiPolicy || !choice?.accepted || !choice.unitTypeId || busy !== null || buyer.accountStatus !== 'ACTIVE' || buyer.membershipStatus !== 'ACTIVE'}>
                        {busy === `eoi:${buyer.buyerProfileId}` ? copy.creating : copy.create}
                      </button>
                    </form>
                  ) : (
                    <span>{buyer.latestEoi ? 'EOI active' : 'No EOI permission'}</span>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      </section>
    </main>
  );
}

function human(value: string): string {
  return value.toLowerCase().replaceAll('_', ' ').replace(/^./, (letter) => letter.toUpperCase());
}
