'use client';

import { roleHasPermission, type WorkspaceContextSnapshot } from '@preneura/contracts/access';
import type { InvitedProjectBuyerSnapshot, ProjectBuyerSnapshot } from '@preneura/contracts/sales';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ApiError, apiFetch } from '../../lib/api';
import styles from './sales.module.css';

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
  const [workspace, setWorkspace] = useState<WorkspaceContextSnapshot | null>(null);
  const [projectId, setProjectId] = useState('');
  const [buyers, setBuyers] = useState<ProjectBuyerSnapshot[]>([]);
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
    void loadBuyers(project.tenantId, project.projectId)
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
    if (!project || !canCreateEoi) return;
    setBusy(`eoi:${buyer.buyerProfileId}`);
    setError('');
    setMessage('');
    try {
      const result = await apiFetch<{ eoiId: string; amount: string; currency: string }>(
        `/v1/tenants/${project.tenantId}/projects/${project.projectId}/buyers/${buyer.buyerProfileId}/eois`,
        { method: 'POST' },
      );
      setMessage(`EOI created for ${buyer.displayName}: ${money(result.amount, result.currency)}. Payment remains pending finance verification.`);
      await loadBuyers(project.tenantId, project.projectId);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to create EOI.');
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
            const canStartEoi = canCreateEoi && (!buyer.latestEoi || ['REFUNDED', 'CANCELLED', 'EXPIRED'].includes(buyer.latestEoi.status));
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
                      <strong>{money(buyer.latestEoi.amount, buyer.latestEoi.currency)}</strong>
                      <span data-eoi={buyer.latestEoi.status}>{human(buyer.latestEoi.status)}</span>
                    </>
                  ) : (
                    <span>No EOI</span>
                  )}
                </div>
                <div className={styles.actions}>
                  {canStartEoi ? (
                    <button type="button" disabled={busy === `eoi:${buyer.buyerProfileId}`} onClick={() => void createEoi(buyer)}>
                      {busy === `eoi:${buyer.buyerProfileId}` ? 'Creating…' : 'Initiate EOI'}
                    </button>
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

function money(value: string, currency: string): string {
  const parsed = Number(value);
  return Number.isFinite(parsed)
    ? new Intl.NumberFormat('en-EG', { style: 'currency', currency, maximumFractionDigits: 2 }).format(parsed)
    : `${value} ${currency}`;
}

function human(value: string): string {
  return value.toLowerCase().replaceAll('_', ' ').replace(/^./, (letter) => letter.toUpperCase());
}
