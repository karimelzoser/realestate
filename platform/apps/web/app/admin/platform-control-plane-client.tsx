'use client';

import type {
  PlatformControlPlaneSnapshot,
  PlatformProjectSnapshot,
  PlatformTenantSnapshot,
  SupportAccessSessionSnapshot,
} from '@preneura/contracts/platform-admin';
import { useEffect, useMemo, useState } from 'react';
import { ApiError, apiFetch } from '../lib/api';
import styles from './platform-control-plane.module.css';

type TenantForm = { code: string; name: string; currency: string; timezone: string };
type ProjectForm = { code: string; name: string; currency: string; timezone: string };

const initialTenant: TenantForm = { code: '', name: '', currency: 'EGP', timezone: 'Africa/Cairo' };
const initialProject: ProjectForm = { code: '', name: '', currency: 'EGP', timezone: 'Africa/Cairo' };

export default function PlatformControlPlaneClient() {
  const [snapshot, setSnapshot] = useState<PlatformControlPlaneSnapshot | null>(null);
  const [tenantId, setTenantId] = useState('');
  const [projects, setProjects] = useState<PlatformProjectSnapshot[]>([]);
  const [tenantForm, setTenantForm] = useState<TenantForm>(initialTenant);
  const [projectForm, setProjectForm] = useState<ProjectForm>(initialProject);
  const [supportProjectId, setSupportProjectId] = useState('');
  const [supportReason, setSupportReason] = useState('');
  const [supportMinutes, setSupportMinutes] = useState(30);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const selectedTenant = useMemo(
    () => snapshot?.tenants.find((tenant) => tenant.tenantId === tenantId) ?? null,
    [snapshot, tenantId],
  );

  useEffect(() => {
    void refresh();
  }, []);

  useEffect(() => {
    if (!tenantId) {
      setProjects([]);
      return;
    }
    void loadProjects(tenantId);
  }, [tenantId]);

  async function refresh(): Promise<void> {
    setError('');
    try {
      const next = await apiFetch<PlatformControlPlaneSnapshot>('/v1/platform/control-plane');
      setSnapshot(next);
      setTenantId((current) => current && next.tenants.some((tenant) => tenant.tenantId === current)
        ? current
        : next.tenants[0]?.tenantId ?? '');
    } catch (reason) {
      if (reason instanceof ApiError && reason.status === 401) {
        window.location.replace('/login');
        return;
      }
      setError(reason instanceof Error ? reason.message : 'Unable to load PRENEURA control plane.');
    }
  }

  async function loadProjects(nextTenantId: string): Promise<void> {
    try {
      setProjects(await apiFetch<PlatformProjectSnapshot[]>(`/v1/platform/tenants/${nextTenantId}/projects`));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to load tenant projects.');
    }
  }

  async function createTenant(): Promise<void> {
    if (busy) return;
    setBusy('tenant'); setError(''); setNotice('');
    try {
      const result = await apiFetch<{ tenantId: string }>('/v1/platform/tenants', {
        method: 'POST',
        body: JSON.stringify({
          code: tenantForm.code,
          name: tenantForm.name,
          defaultCurrency: tenantForm.currency,
          defaultTimezone: tenantForm.timezone,
        }),
      });
      setTenantForm(initialTenant);
      setNotice('Client tenant created. Add projects before operational onboarding.');
      await refresh();
      setTenantId(result.tenantId);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to create tenant.');
    } finally { setBusy(''); }
  }

  async function createProject(): Promise<void> {
    if (!tenantId || busy) return;
    setBusy('project'); setError(''); setNotice('');
    try {
      await apiFetch(`/v1/platform/tenants/${tenantId}/projects`, {
        method: 'POST',
        body: JSON.stringify(projectForm),
      });
      setProjectForm({ ...initialProject, currency: selectedTenant?.defaultCurrency ?? 'EGP' });
      setNotice('Project created in DRAFT state.');
      await Promise.all([refresh(), loadProjects(tenantId)]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to create project.');
    } finally { setBusy(''); }
  }

  async function changeTenantStatus(tenant: PlatformTenantSnapshot, status: PlatformTenantSnapshot['status']): Promise<void> {
    if (busy) return;
    setBusy(tenant.tenantId); setError('');
    try {
      await apiFetch(`/v1/platform/tenants/${tenant.tenantId}/status`, {
        method: 'POST', body: JSON.stringify({ status }),
      });
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to update tenant status.');
    } finally { setBusy(''); }
  }

  async function changeProjectStatus(project: PlatformProjectSnapshot, status: PlatformProjectSnapshot['status']): Promise<void> {
    if (busy) return;
    setBusy(project.projectId); setError('');
    try {
      await apiFetch(`/v1/platform/tenants/${project.tenantId}/projects/${project.projectId}/status`, {
        method: 'POST', body: JSON.stringify({ status }),
      });
      await Promise.all([refresh(), loadProjects(project.tenantId)]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to update project status.');
    } finally { setBusy(''); }
  }

  async function startSupportAccess(): Promise<void> {
    if (!tenantId || supportReason.trim().length < 8 || busy) return;
    setBusy('support'); setError(''); setNotice('');
    try {
      const session = await apiFetch<SupportAccessSessionSnapshot>('/v1/platform/support-access', {
        method: 'POST',
        body: JSON.stringify({
          tenantId,
          projectId: supportProjectId || null,
          reason: supportReason,
          durationMinutes: supportMinutes,
        }),
      });
      setSupportReason('');
      setNotice(`Read-only support access active until ${formatDate(session.expiresAt)}.`);
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to start support access.');
    } finally { setBusy(''); }
  }

  async function endSupportAccess(sessionId: string): Promise<void> {
    if (busy) return;
    setBusy(sessionId); setError('');
    try {
      await apiFetch(`/v1/platform/support-access/${sessionId}/end`, { method: 'POST' });
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to end support access.');
    } finally { setBusy(''); }
  }

  const metrics = snapshot?.metrics;
  return (
    <main className={styles.page}>
      <header className={styles.topbar}>
        <div className={styles.brandMark}>P</div>
        <div><strong>PRENEURA</strong><span>Platform Control Plane</span></div>
        <a href="/workspace">Operational workspace</a>
      </header>

      <section className={styles.content}>
        <div className={styles.hero}>
          <div><span className={styles.eyebrow}>Super Admin</span><h1>Multi-client platform control</h1><p>Provision clients and projects, monitor platform health, and open explicitly audited support access only when tenant-level inspection is required.</p></div>
          <div className={styles.boundary}><strong>Data-access boundary</strong><span>Control-plane metrics do not grant silent buyer-data access. Tenant operational reads require a reasoned, expiring support session.</span></div>
        </div>

        {error ? <div className={styles.error}>{error}</div> : null}
        {notice ? <div className={styles.notice}>{notice}</div> : null}

        {metrics ? <section className={styles.metrics}>
          <Metric label="Clients" value={`${metrics.activeTenants}/${metrics.tenants}`} detail="active / total" />
          <Metric label="Projects" value={`${metrics.activeProjects}/${metrics.projects}`} detail="active / total" />
          <Metric label="Users" value={String(metrics.users)} detail="platform identities" />
          <Metric label="Open transactions" value={String(metrics.openTransactions)} detail={`${metrics.transactions} total`} />
          <Metric label="Failed delivery" value={String(metrics.failedNotifications)} detail="notification jobs" warn={metrics.failedNotifications > 0} />
          <Metric label="Due commissions" value={String(metrics.dueCommissions)} detail="cases requiring settlement" warn={metrics.dueCommissions > 0} />
        </section> : null}

        <section className={styles.layout}>
          <article className={styles.panel}>
            <div className={styles.panelHeading}><div><span className={styles.eyebrow}>Clients</span><h2>Tenant portfolio</h2></div><span>{snapshot?.tenants.length ?? 0}</span></div>
            <div className={styles.tenantList}>
              {snapshot?.tenants.map((tenant) => <button key={tenant.tenantId} type="button" className={tenant.tenantId === tenantId ? styles.selectedTenant : styles.tenantRow} onClick={() => setTenantId(tenant.tenantId)}>
                <div><strong>{tenant.name}</strong><span>{tenant.code} · {tenant.status}</span></div>
                <div className={styles.rowStats}><span>{tenant.projectCount} projects</span><span>{tenant.userCount} users</span><span>{tenant.openTransactionCount} open</span></div>
              </button>)}
            </div>
          </article>

          <article className={styles.panel}>
            <div className={styles.panelHeading}><div><span className={styles.eyebrow}>Provisioning</span><h2>New client</h2></div><span>Platform</span></div>
            <div className={styles.formGrid}>
              <Field label="Code" value={tenantForm.code} onChange={(value) => setTenantForm((current) => ({ ...current, code: value }))} />
              <Field label="Name" value={tenantForm.name} onChange={(value) => setTenantForm((current) => ({ ...current, name: value }))} />
              <Field label="Currency" value={tenantForm.currency} onChange={(value) => setTenantForm((current) => ({ ...current, currency: value.toUpperCase() }))} />
              <Field label="Timezone" value={tenantForm.timezone} onChange={(value) => setTenantForm((current) => ({ ...current, timezone: value }))} />
            </div>
            <button className={styles.primary} type="button" disabled={busy === 'tenant' || !tenantForm.code || !tenantForm.name} onClick={() => void createTenant()}>{busy === 'tenant' ? 'Creating…' : 'Create tenant'}</button>
          </article>
        </section>

        {selectedTenant ? <section className={styles.panel}>
          <div className={styles.panelHeading}><div><span className={styles.eyebrow}>Selected client</span><h2>{selectedTenant.name}</h2></div><select value={selectedTenant.status} disabled={Boolean(busy)} onChange={(event) => void changeTenantStatus(selectedTenant, event.target.value as PlatformTenantSnapshot['status'])}><option>ACTIVE</option><option>SUSPENDED</option><option>ARCHIVED</option></select></div>
          <div className={styles.clientSummary}><span>{selectedTenant.defaultCurrency}</span><span>{selectedTenant.defaultTimezone}</span><span>{selectedTenant.transactionCount} transactions</span><span>{selectedTenant.failedNotificationCount} failed deliveries</span></div>

          <div className={styles.projectArea}>
            <div className={styles.projects}>
              {projects.map((project) => <article className={styles.projectCard} key={project.projectId}>
                <div><strong>{project.name}</strong><span>{project.code} · {project.currency}</span></div>
                <div className={styles.projectNumbers}><span>{project.openTransactionCount} open transactions</span><span>{project.transactionCount} total</span><span>{project.brokerCompanyCount} brokers</span></div>
                <select value={project.status} disabled={Boolean(busy)} onChange={(event) => void changeProjectStatus(project, event.target.value as PlatformProjectSnapshot['status'])}><option>DRAFT</option><option>ACTIVE</option><option>PAUSED</option><option>CLOSED</option><option>ARCHIVED</option></select>
              </article>)}
              {projects.length === 0 ? <div className={styles.empty}>No projects yet.</div> : null}
            </div>
            <div className={styles.projectForm}>
              <h3>Create project</h3>
              <Field label="Code" value={projectForm.code} onChange={(value) => setProjectForm((current) => ({ ...current, code: value }))} />
              <Field label="Name" value={projectForm.name} onChange={(value) => setProjectForm((current) => ({ ...current, name: value }))} />
              <Field label="Currency" value={projectForm.currency} onChange={(value) => setProjectForm((current) => ({ ...current, currency: value.toUpperCase() }))} />
              <Field label="Timezone" value={projectForm.timezone} onChange={(value) => setProjectForm((current) => ({ ...current, timezone: value }))} />
              <button className={styles.primary} type="button" disabled={busy === 'project' || !projectForm.code || !projectForm.name} onClick={() => void createProject()}>{busy === 'project' ? 'Creating…' : 'Create draft project'}</button>
            </div>
          </div>
        </section> : null}

        <section className={styles.supportGrid}>
          <article className={styles.panel}>
            <div className={styles.panelHeading}><div><span className={styles.eyebrow}>Break-glass support</span><h2>Open read-only access</h2></div><span>Max 4h</span></div>
            <label><span>Client</span><select value={tenantId} onChange={(event) => setTenantId(event.target.value)}>{snapshot?.tenants.map((tenant) => <option value={tenant.tenantId} key={tenant.tenantId}>{tenant.name}</option>)}</select></label>
            <label><span>Scope</span><select value={supportProjectId} onChange={(event) => setSupportProjectId(event.target.value)}><option value="">Entire tenant</option>{projects.map((project) => <option value={project.projectId} key={project.projectId}>{project.name}</option>)}</select></label>
            <label><span>Reason</span><textarea value={supportReason} onChange={(event) => setSupportReason(event.target.value)} placeholder="Incident, support ticket, reconciliation investigation…" /></label>
            <label><span>Duration</span><select value={supportMinutes} onChange={(event) => setSupportMinutes(Number(event.target.value))}><option value={15}>15 minutes</option><option value={30}>30 minutes</option><option value={60}>1 hour</option><option value={120}>2 hours</option><option value={240}>4 hours</option></select></label>
            <button className={styles.primary} type="button" disabled={busy === 'support' || !tenantId || supportReason.trim().length < 8} onClick={() => void startSupportAccess()}>{busy === 'support' ? 'Opening…' : 'Start support session'}</button>
          </article>

          <article className={styles.panel}>
            <div className={styles.panelHeading}><div><span className={styles.eyebrow}>Audited access</span><h2>Active sessions</h2></div><span>{snapshot?.activeSupportSessions.length ?? 0}</span></div>
            <div className={styles.sessions}>
              {snapshot?.activeSupportSessions.map((session) => <div className={styles.session} key={session.sessionId}>
                <div><strong>{session.tenantName}{session.projectName ? ` · ${session.projectName}` : ''}</strong><span>{session.reason}</span><small>Expires {formatDate(session.expiresAt)}</small></div>
                <button type="button" disabled={busy === session.sessionId} onClick={() => void endSupportAccess(session.sessionId)}>End</button>
              </div>)}
              {snapshot?.activeSupportSessions.length === 0 ? <div className={styles.empty}>No active support access.</div> : null}
            </div>
          </article>
        </section>
      </section>
    </main>
  );
}

function Metric(props: { label: string; value: string; detail: string; warn?: boolean }) {
  return <article className={props.warn ? styles.metricWarn : styles.metric}><span>{props.label}</span><strong>{props.value}</strong><small>{props.detail}</small></article>;
}

function Field(props: { label: string; value: string; onChange: (value: string) => void }) {
  return <label><span>{props.label}</span><input value={props.value} onChange={(event) => props.onChange(event.target.value)} /></label>;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}
