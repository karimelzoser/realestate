'use client';

import {
  roleHasPermission,
  type RoleCode,
  type WorkspaceContextSnapshot,
} from '@preneura/contracts/access';
import type {
  AccountAdminScopeSnapshot,
  AccountSnapshot,
} from '@preneura/contracts/accounts';
import { useEffect, useMemo, useState } from 'react';
import { ApiError, apiFetch } from '../../lib/api';
import styles from './account-center.module.css';

const internalRoles: RoleCode[] = [
  'OPERATIONS_DIRECTOR',
  'MANAGER',
  'SALES',
  'QUEUE_RECEPTIONIST',
  'ALLOCATOR',
  'TRANSACTION_OPERATOR',
];
const brokerRoles: RoleCode[] = ['BROKER_MANAGER', 'BROKER_FINANCE', 'BROKER_AGENT'];

export default function AccountCenterClient() {
  const [workspace, setWorkspace] = useState<WorkspaceContextSnapshot | null>(null);
  const [tenantId, setTenantId] = useState('');
  const [scope, setScope] = useState<AccountAdminScopeSnapshot | null>(null);
  const [accounts, setAccounts] = useState<AccountSnapshot[]>([]);
  const [displayName, setDisplayName] = useState('');
  const [phone, setPhone] = useState('');
  const [role, setRole] = useState<RoleCode>('MANAGER');
  const [resourceId, setResourceId] = useState('');
  const [channel, setChannel] = useState<'WHATSAPP' | 'SMS'>('WHATSAPP');
  const [grantUserId, setGrantUserId] = useState('');
  const [grantRole, setGrantRole] = useState<RoleCode>('MANAGER');
  const [grantResourceId, setGrantResourceId] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const tenantOptions = useMemo(() => {
    if (!workspace) return [];
    const map = new Map<string, { tenantId: string; tenantName: string }>();
    for (const project of workspace.projects) {
      if (!project.roles.some((candidate) =>
        roleHasPermission(candidate, 'tenant.users.manage') || roleHasPermission(candidate, 'broker.users.manage'),
      )) continue;
      map.set(project.tenantId, { tenantId: project.tenantId, tenantName: project.tenantName });
    }
    return [...map.values()].sort((a, b) => a.tenantName.localeCompare(b.tenantName));
  }, [workspace]);

  const roleOptions = useMemo(() => {
    if (!scope) return [] as RoleCode[];
    const options: RoleCode[] = [];
    if (scope.canManageTenantUsers) options.push(...internalRoles);
    if (scope.brokerCompanies.length > 0) {
      options.push(...(scope.canManageTenantUsers ? brokerRoles : ['BROKER_FINANCE', 'BROKER_AGENT']));
    }
    return [...new Set(options)];
  }, [scope]);

  useEffect(() => {
    let cancelled = false;
    void apiFetch<WorkspaceContextSnapshot>('/v1/me/workspace')
      .then((context) => {
        if (cancelled) return;
        setWorkspace(context);
        const candidates = context.projects.filter((project) => project.roles.some((candidate) =>
          roleHasPermission(candidate, 'tenant.users.manage') || roleHasPermission(candidate, 'broker.users.manage'),
        ));
        const first = candidates[0];
        if (!first) {
          setError('Your account does not have Account Center access.');
          setLoading(false);
          return;
        }
        const stored = window.localStorage.getItem('preneura:account-tenant');
        const selected = candidates.find((project) => project.tenantId === stored) ?? first;
        setTenantId(selected.tenantId);
      })
      .catch((reason) => {
        if (reason instanceof ApiError && reason.status === 401) {
          window.location.replace('/login');
          return;
        }
        setError(reason instanceof Error ? reason.message : 'Unable to load account workspace.');
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!tenantId) return;
    window.localStorage.setItem('preneura:account-tenant', tenantId);
    void refresh(tenantId);
  }, [tenantId]);

  useEffect(() => {
    if (!scope || roleOptions.length === 0) return;
    if (!roleOptions.includes(role)) setRole(roleOptions[0]!);
    if (!roleOptions.includes(grantRole)) setGrantRole(roleOptions[0]!);
  }, [scope, roleOptions, role, grantRole]);

  useEffect(() => {
    if (!scope) return;
    setResourceId(defaultResource(scope, role));
  }, [scope, role]);

  useEffect(() => {
    if (!scope) return;
    setGrantResourceId(defaultResource(scope, grantRole));
  }, [scope, grantRole]);

  async function refresh(selectedTenantId = tenantId): Promise<void> {
    if (!selectedTenantId) return;
    setLoading(true);
    setError('');
    try {
      const [nextScope, nextAccounts] = await Promise.all([
        apiFetch<AccountAdminScopeSnapshot>(`/v1/tenants/${selectedTenantId}/account-admin/scopes`),
        apiFetch<AccountSnapshot[]>(`/v1/tenants/${selectedTenantId}/accounts`),
      ]);
      setScope(nextScope);
      setAccounts(nextAccounts);
      setGrantUserId((current) => nextAccounts.some((account) => account.userId === current)
        ? current
        : nextAccounts[0]?.userId ?? '');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to load accounts.');
    } finally {
      setLoading(false);
    }
  }

  async function provision(): Promise<void> {
    if (!tenantId || !scope || busy) return;
    setBusy('provision');
    setError('');
    setNotice('');
    try {
      const scopeType = scopeTypeForRole(role);
      const result = await apiFetch<{
        userId: string;
        contactDisplayHint: string;
        verificationDispatched: boolean;
      }>(`/v1/tenants/${tenantId}/accounts`, {
        method: 'POST',
        body: JSON.stringify({
          displayName,
          phone,
          role,
          scopeType,
          projectId: scopeType === 'PROJECT' ? resourceId : null,
          brokerCompanyId: scopeType === 'BROKER_COMPANY' ? resourceId : null,
          verificationChannel: channel,
        }),
      });
      setDisplayName('');
      setPhone('');
      setNotice(result.verificationDispatched
        ? `Pending account created. Verification code sent to ${result.contactDisplayHint}.`
        : `Pending account created for ${result.contactDisplayHint}, but the verification gateway did not accept the message. Use Resend after the gateway is available.`);
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to provision account.');
    } finally {
      setBusy('');
    }
  }

  async function grant(): Promise<void> {
    if (!tenantId || !scope || !grantUserId || busy) return;
    setBusy('grant');
    setError('');
    setNotice('');
    try {
      const scopeType = scopeTypeForRole(grantRole);
      await apiFetch(`/v1/tenants/${tenantId}/accounts/${grantUserId}/roles`, {
        method: 'POST',
        body: JSON.stringify({
          role: grantRole,
          scopeType,
          projectId: scopeType === 'PROJECT' ? grantResourceId : null,
          brokerCompanyId: scopeType === 'BROKER_COMPANY' ? grantResourceId : null,
        }),
      });
      setNotice('Role assignment added.');
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to grant role.');
    } finally {
      setBusy('');
    }
  }

  async function revoke(assignmentId: string): Promise<void> {
    if (!tenantId || busy) return;
    setBusy(assignmentId);
    setError('');
    try {
      await apiFetch(`/v1/tenants/${tenantId}/account-roles/${assignmentId}/revoke`, { method: 'POST' });
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to revoke role.');
    } finally {
      setBusy('');
    }
  }

  async function setStatus(account: AccountSnapshot, status: 'ACTIVE' | 'DISABLED'): Promise<void> {
    if (!tenantId || busy) return;
    setBusy(account.userId);
    setError('');
    try {
      await apiFetch(`/v1/tenants/${tenantId}/accounts/${account.userId}/status`, {
        method: 'POST',
        body: JSON.stringify({ status }),
      });
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to update account status.');
    } finally {
      setBusy('');
    }
  }

  async function resend(account: AccountSnapshot): Promise<void> {
    if (!tenantId || busy) return;
    setBusy(account.userId);
    setError('');
    setNotice('');
    try {
      const result = await apiFetch<{ sent: boolean }>(
        `/v1/tenants/${tenantId}/accounts/${account.userId}/verification/resend`,
        { method: 'POST', body: JSON.stringify({ channel }) },
      );
      setNotice(result.sent ? 'Verification code resent.' : 'Verification challenge created, but the gateway did not accept delivery.');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to resend verification.');
    } finally {
      setBusy('');
    }
  }

  if (!workspace && loading) {
    return <main className={styles.statePage}><div className={styles.brandMark}>P</div><p>Loading Account Center…</p></main>;
  }

  return (
    <main className={styles.page}>
      <header className={styles.topbar}>
        <a href="/workspace" className={styles.backButton}>←</a>
        <div className={styles.brandMark}>P</div>
        <div className={styles.brandText}><strong>PRENEURA</strong><span>Account Center</span></div>
        <select value={tenantId} onChange={(event) => setTenantId(event.target.value)} aria-label="Tenant">
          {tenantOptions.map((tenant) => <option key={tenant.tenantId} value={tenant.tenantId}>{tenant.tenantName}</option>)}
        </select>
      </header>

      <section className={styles.content}>
        <div className={styles.heading}>
          <div><span className={styles.eyebrow}>Identity & access</span><h1>{scope?.tenantName ?? 'Accounts'}</h1><p>Provision verified phone identities and assign only the roles allowed by your administration scope.</p></div>
          <div className={styles.securityNote}><strong>Privacy boundary</strong><span>Phone numbers are write-only here. Listings expose masked hints and verification state, never raw contact values.</span></div>
        </div>

        {error ? <div className={styles.error}>{error}</div> : null}
        {notice ? <div className={styles.notice}>{notice}</div> : null}

        <section className={styles.grid}>
          <article className={styles.panel}>
            <div className={styles.panelHeading}><div><span className={styles.eyebrow}>New account</span><h2>Provision user</h2></div><span>OTP verified</span></div>
            <div className={styles.formGrid}>
              <label><span>Display name</span><input value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="Full name" /></label>
              <label><span>Phone</span><input value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="+20…" inputMode="tel" /></label>
              <label><span>Role</span><select value={role} onChange={(event) => setRole(event.target.value as RoleCode)}>{roleOptions.map((candidate) => <option value={candidate} key={candidate}>{pretty(candidate)}</option>)}</select></label>
              <ResourceField scope={scope} role={role} value={resourceId} onChange={setResourceId} />
              <label><span>Verification channel</span><select value={channel} onChange={(event) => setChannel(event.target.value as 'WHATSAPP' | 'SMS')}><option value="WHATSAPP">WhatsApp</option><option value="SMS">SMS</option></select></label>
            </div>
            <button className={styles.primary} type="button" disabled={busy === 'provision' || !displayName || !phone || (scopeTypeForRole(role) !== 'TENANT' && !resourceId)} onClick={() => void provision()}>{busy === 'provision' ? 'Creating…' : 'Create pending account'}</button>
          </article>

          <article className={styles.panel}>
            <div className={styles.panelHeading}><div><span className={styles.eyebrow}>Existing account</span><h2>Add role</h2></div><span>Server-authorized</span></div>
            <div className={styles.formGrid}>
              <label className={styles.wide}><span>User</span><select value={grantUserId} onChange={(event) => setGrantUserId(event.target.value)}>{accounts.map((account) => <option value={account.userId} key={account.userId}>{account.displayName} · {account.status}</option>)}</select></label>
              <label><span>Role</span><select value={grantRole} onChange={(event) => setGrantRole(event.target.value as RoleCode)}>{roleOptions.map((candidate) => <option value={candidate} key={candidate}>{pretty(candidate)}</option>)}</select></label>
              <ResourceField scope={scope} role={grantRole} value={grantResourceId} onChange={setGrantResourceId} />
            </div>
            <button className={styles.primary} type="button" disabled={busy === 'grant' || !grantUserId || (scopeTypeForRole(grantRole) !== 'TENANT' && !grantResourceId)} onClick={() => void grant()}>{busy === 'grant' ? 'Adding…' : 'Add role assignment'}</button>
          </article>
        </section>

        <section className={styles.panel}>
          <div className={styles.panelHeading}><div><span className={styles.eyebrow}>Directory</span><h2>Managed accounts</h2></div><span>{loading ? 'Refreshing…' : `${accounts.length} account${accounts.length === 1 ? '' : 's'}`}</span></div>
          <div className={styles.accountGrid}>
            {accounts.map((account) => (
              <article className={styles.accountCard} key={account.userId}>
                <div className={styles.accountTop}>
                  <div><h3>{account.displayName}</h3><span>{account.contacts.find((contact) => contact.kind === 'PHONE')?.displayHint ?? 'No phone hint'}</span></div>
                  <span className={`${styles.status} ${styles[`status${account.status}`]}`}>{account.status}</span>
                </div>
                <div className={styles.contactState}>
                  {account.contacts.map((contact) => <span key={`${contact.kind}-${contact.displayHint ?? ''}`}>{contact.kind}: {contact.verifiedAt ? 'Verified' : 'Pending verification'}</span>)}
                </div>
                <div className={styles.roles}>
                  {account.roles.map((assignment) => (
                    <div className={styles.roleRow} key={assignment.assignmentId}>
                      <div><strong>{pretty(assignment.role)}</strong><span>{scopeLabel(assignment.scopeType, assignment.projectId, assignment.brokerCompanyId, scope)}</span></div>
                      <button type="button" disabled={busy === assignment.assignmentId} onClick={() => void revoke(assignment.assignmentId)}>Revoke</button>
                    </div>
                  ))}
                </div>
                <div className={styles.cardActions}>
                  {account.status === 'PENDING' ? <button type="button" disabled={busy === account.userId} onClick={() => void resend(account)}>Resend verification</button> : null}
                  {account.status === 'ACTIVE' ? <button type="button" className={styles.danger} disabled={busy === account.userId} onClick={() => void setStatus(account, 'DISABLED')}>Disable</button> : null}
                  {account.status === 'DISABLED' ? <button type="button" disabled={busy === account.userId} onClick={() => void setStatus(account, 'ACTIVE')}>Enable</button> : null}
                </div>
              </article>
            ))}
          </div>
          {!loading && accounts.length === 0 ? <div className={styles.empty}>No accounts are visible in your administration scope.</div> : null}
        </section>
      </section>
    </main>
  );
}

function ResourceField(props: {
  scope: AccountAdminScopeSnapshot | null;
  role: RoleCode;
  value: string;
  onChange: (value: string) => void;
}) {
  const type = scopeTypeForRole(props.role);
  if (type === 'TENANT') return <div className={styles.scopeReadout}><span>Scope</span><strong>Entire tenant</strong></div>;
  if (type === 'PROJECT') {
    return <label><span>Project</span><select value={props.value} onChange={(event) => props.onChange(event.target.value)}>{props.scope?.projects.map((project) => <option key={project.projectId} value={project.projectId}>{project.name}</option>)}</select></label>;
  }
  return <label><span>Broker company</span><select value={props.value} onChange={(event) => props.onChange(event.target.value)}>{props.scope?.brokerCompanies.map((broker) => <option key={broker.brokerCompanyId} value={broker.brokerCompanyId}>{broker.name}</option>)}</select></label>;
}

function scopeTypeForRole(role: RoleCode): 'TENANT' | 'PROJECT' | 'BROKER_COMPANY' {
  if (role === 'OPERATIONS_DIRECTOR') return 'TENANT';
  if (brokerRoles.includes(role)) return 'BROKER_COMPANY';
  return 'PROJECT';
}

function defaultResource(scope: AccountAdminScopeSnapshot, role: RoleCode): string {
  const type = scopeTypeForRole(role);
  if (type === 'PROJECT') return scope.projects[0]?.projectId ?? '';
  if (type === 'BROKER_COMPANY') return scope.brokerCompanies[0]?.brokerCompanyId ?? '';
  return '';
}

function pretty(value: string): string {
  return value.toLowerCase().split('_').map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
}

function scopeLabel(
  type: string,
  projectId: string | null,
  brokerCompanyId: string | null,
  scope: AccountAdminScopeSnapshot | null,
): string {
  if (type === 'TENANT') return 'Tenant';
  if (type === 'PROJECT') return scope?.projects.find((project) => project.projectId === projectId)?.name ?? 'Project';
  if (type === 'BROKER_COMPANY') return scope?.brokerCompanies.find((broker) => broker.brokerCompanyId === brokerCompanyId)?.name ?? 'Broker company';
  return type;
}
