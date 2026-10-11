'use client';

import { useEffect, useMemo, useState } from 'react';
import type { WorkspaceContextSnapshot } from '@preneura/contracts/access';
import type { PlatformControlPlaneSnapshot } from '@preneura/contracts/platform-admin';
import type { DeveloperOnboardingSnapshot } from '@preneura/contracts/onboarding';
import { apiFetch } from '../../lib/api';
import { useLocale } from '../locale-provider';
import styles from './onboarding.module.css';

type Mode = 'platform' | 'workspace';
type TenantOption = { tenantId: string; label: string };
type ProjectStatus = 'DRAFT' | 'ACTIVE' | 'PAUSED' | 'CLOSED' | 'ARCHIVED';

const copy = {
  en: {
    eyebrow: 'Developer onboarding', title: 'Bring a developer tenant to operational readiness',
    intro: 'Brand the organization and projects, bootstrap the first Operations Director, then hand normal staff administration to Account Center.',
    tenant: 'Developer tenant', refresh: 'Refresh', readiness: 'Readiness', brand: 'Developer branding', projects: 'Projects', staff: 'Staff',
    complete: 'Complete onboarding', completed: 'Onboarding completed', save: 'Save', createProject: 'Create project', bootstrap: 'Invite first Operations Director',
    accountCenter: 'Open Account Center', back: 'Back', loading: 'Loading…', noTenant: 'No manageable developer tenant is available.',
    brandConfigured: 'Developer branding', directorAssigned: 'Operations Director', projectCreated: 'Project created', projectBranding: 'Project branding',
    ready: 'Ready', pending: 'Pending', englishName: 'English name', arabicName: 'Arabic name', legalName: 'Legal name', website: 'Website',
    primaryColor: 'Primary color', secondaryColor: 'Secondary color', projectCode: 'Project code', projectName: 'Project name', currency: 'Currency', timezone: 'Timezone',
    descriptionEn: 'English description', descriptionAr: 'Arabic description', status: 'Status', displayName: 'Full name', phone: 'Phone', channel: 'Verification channel',
    opsDirectors: 'Operations Directors', pendingDirectors: 'Pending directors', activeStaff: 'Active staff', invitedStaff: 'Invited staff',
    saveProjectBrand: 'Save project branding', updateStatus: 'Update project status', create: 'Create', invite: 'Send invitation',
    tenantActive: 'Tenant must be active and all four onboarding checks must be ready before completion.',
  },
  ar: {
    eyebrow: 'تهيئة المطور', title: 'جهّز حساب المطور للعمل التشغيلي',
    intro: 'أكمل هوية المطور والمشروعات، فعّل أول مدير عمليات، ثم استخدم مركز الحسابات لإدارة باقي الفريق.',
    tenant: 'حساب المطور', refresh: 'تحديث', readiness: 'جاهزية التشغيل', brand: 'هوية المطور', projects: 'المشروعات', staff: 'الفريق',
    complete: 'إكمال التهيئة', completed: 'تم إكمال التهيئة', save: 'حفظ', createProject: 'إنشاء مشروع', bootstrap: 'دعوة أول مدير عمليات',
    accountCenter: 'فتح مركز الحسابات', back: 'رجوع', loading: 'جارٍ التحميل…', noTenant: 'لا يوجد حساب مطور متاح لإدارته.',
    brandConfigured: 'هوية المطور', directorAssigned: 'مدير العمليات', projectCreated: 'إنشاء مشروع', projectBranding: 'هوية المشروع',
    ready: 'جاهز', pending: 'غير مكتمل', englishName: 'الاسم بالإنجليزية', arabicName: 'الاسم بالعربية', legalName: 'الاسم القانوني', website: 'الموقع الإلكتروني',
    primaryColor: 'اللون الرئيسي', secondaryColor: 'اللون الثانوي', projectCode: 'كود المشروع', projectName: 'اسم المشروع', currency: 'العملة', timezone: 'المنطقة الزمنية',
    descriptionEn: 'الوصف بالإنجليزية', descriptionAr: 'الوصف بالعربية', status: 'الحالة', displayName: 'الاسم الكامل', phone: 'رقم الهاتف', channel: 'قناة التحقق',
    opsDirectors: 'مديرو العمليات', pendingDirectors: 'مديرو العمليات قيد التفعيل', activeStaff: 'الفريق النشط', invitedStaff: 'الدعوات المعلقة',
    saveProjectBrand: 'حفظ هوية المشروع', updateStatus: 'تحديث حالة المشروع', create: 'إنشاء', invite: 'إرسال الدعوة',
    tenantActive: 'يجب أن يكون حساب المطور نشطًا وأن تكتمل عناصر الجاهزية الأربعة قبل إنهاء التهيئة.',
  },
} as const;

export default function DeveloperOnboardingClient({ mode }: { mode: Mode }) {
  const { locale } = useLocale();
  const t = copy[locale];
  const [tenants, setTenants] = useState<TenantOption[]>([]);
  const [tenantId, setTenantId] = useState('');
  const [snapshot, setSnapshot] = useState<DeveloperOnboardingSnapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [tenantBrand, setTenantBrand] = useState({ displayNameEn: '', displayNameAr: '', legalName: '', primaryColor: '#111827', secondaryColor: '', websiteUrl: '' });
  const [projectBrand, setProjectBrand] = useState({ displayNameEn: '', displayNameAr: '', shortDescriptionEn: '', shortDescriptionAr: '', primaryColor: '', secondaryColor: '' });
  const [projectDraft, setProjectDraft] = useState({ code: '', name: '', currency: 'EGP', timezone: 'Africa/Cairo' });
  const [director, setDirector] = useState({ displayName: '', phone: '', verificationChannel: 'WHATSAPP' as 'WHATSAPP' | 'SMS' });

  useEffect(() => { void loadTenantOptions(); }, [mode]);
  useEffect(() => { if (tenantId) void loadSnapshot(tenantId); }, [tenantId]);

  useEffect(() => {
    if (!snapshot) return;
    setTenantBrand({
      displayNameEn: snapshot.branding?.displayNameEn ?? snapshot.tenantName,
      displayNameAr: snapshot.branding?.displayNameAr ?? '',
      legalName: snapshot.branding?.legalName ?? '',
      primaryColor: snapshot.branding?.primaryColor ?? '#111827',
      secondaryColor: snapshot.branding?.secondaryColor ?? '',
      websiteUrl: snapshot.branding?.websiteUrl ?? '',
    });
    const current = snapshot.projects.find((project) => project.projectId === selectedProjectId) ?? snapshot.projects[0];
    setSelectedProjectId(current?.projectId ?? '');
    setProjectBrand({
      displayNameEn: current?.branding?.displayNameEn ?? current?.projectName ?? '',
      displayNameAr: current?.branding?.displayNameAr ?? '',
      shortDescriptionEn: current?.branding?.shortDescriptionEn ?? '',
      shortDescriptionAr: current?.branding?.shortDescriptionAr ?? '',
      primaryColor: current?.branding?.primaryColor ?? '',
      secondaryColor: current?.branding?.secondaryColor ?? '',
    });
  }, [snapshot]);

  const selectedProject = useMemo(
    () => snapshot?.projects.find((project) => project.projectId === selectedProjectId) ?? null,
    [snapshot, selectedProjectId],
  );

  async function loadTenantOptions(): Promise<void> {
    setError('');
    try {
      let options: TenantOption[] = [];
      if (mode === 'platform') {
        const control = await apiFetch<PlatformControlPlaneSnapshot>('/v1/platform/control-plane');
        options = control.tenants.map((tenant) => ({ tenantId: tenant.tenantId, label: `${tenant.name} · ${tenant.code}` }));
      } else {
        const workspace = await apiFetch<WorkspaceContextSnapshot>('/v1/me/workspace');
        const labels = new Map<string, string>();
        for (const project of workspace.projects) labels.set(project.tenantId, `${project.tenantName} · ${project.tenantCode}`);
        for (const assignment of workspace.assignments) {
          if (assignment.role === 'OPERATIONS_DIRECTOR' && assignment.tenantId && !labels.has(assignment.tenantId)) {
            labels.set(assignment.tenantId, assignment.tenantId);
          }
        }
        options = [...labels].map(([id, label]) => ({ tenantId: id, label }));
      }
      setTenants(options);
      setTenantId((current) => current && options.some((item) => item.tenantId === current) ? current : options[0]?.tenantId ?? '');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to load onboarding scope.');
    }
  }

  async function loadSnapshot(id = tenantId): Promise<void> {
    if (!id) return;
    setBusy(true); setError(''); setNotice('');
    try {
      setSnapshot(await apiFetch<DeveloperOnboardingSnapshot>(`/v1/tenants/${id}/onboarding`));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to load onboarding state.');
    } finally { setBusy(false); }
  }

  async function mutate(path: string, method: 'POST' | 'PUT', body?: unknown): Promise<DeveloperOnboardingSnapshot> {
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await apiFetch<DeveloperOnboardingSnapshot>(path, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      setSnapshot(result);
      return result;
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : 'Request failed.';
      setError(message); throw reason;
    } finally { setBusy(false); }
  }

  async function saveTenantBrand(): Promise<void> {
    await mutate(`/v1/tenants/${tenantId}/onboarding/branding`, 'PUT', {
      displayNameEn: tenantBrand.displayNameEn,
      displayNameAr: tenantBrand.displayNameAr,
      legalName: tenantBrand.legalName || null,
      primaryColor: tenantBrand.primaryColor,
      secondaryColor: tenantBrand.secondaryColor || null,
      websiteUrl: tenantBrand.websiteUrl || null,
    });
    setNotice(t.save);
  }

  async function createProject(): Promise<void> {
    const response = await apiFetch<{ projectId: string; onboarding: DeveloperOnboardingSnapshot }>(`/v1/tenants/${tenantId}/onboarding/projects`, {
      method: 'POST', body: JSON.stringify(projectDraft),
    });
    setSnapshot(response.onboarding); setSelectedProjectId(response.projectId);
    setProjectDraft({ code: '', name: '', currency: 'EGP', timezone: 'Africa/Cairo' });
  }

  function chooseProject(projectId: string): void {
    setSelectedProjectId(projectId);
    const project = snapshot?.projects.find((item) => item.projectId === projectId);
    setProjectBrand({
      displayNameEn: project?.branding?.displayNameEn ?? project?.projectName ?? '',
      displayNameAr: project?.branding?.displayNameAr ?? '',
      shortDescriptionEn: project?.branding?.shortDescriptionEn ?? '',
      shortDescriptionAr: project?.branding?.shortDescriptionAr ?? '',
      primaryColor: project?.branding?.primaryColor ?? '',
      secondaryColor: project?.branding?.secondaryColor ?? '',
    });
  }

  async function saveProjectBrand(): Promise<void> {
    if (!selectedProjectId) return;
    await mutate(`/v1/tenants/${tenantId}/onboarding/projects/${selectedProjectId}/branding`, 'PUT', {
      displayNameEn: projectBrand.displayNameEn,
      displayNameAr: projectBrand.displayNameAr,
      shortDescriptionEn: projectBrand.shortDescriptionEn || null,
      shortDescriptionAr: projectBrand.shortDescriptionAr || null,
      primaryColor: projectBrand.primaryColor || null,
      secondaryColor: projectBrand.secondaryColor || null,
    });
  }

  async function setProjectStatus(status: ProjectStatus): Promise<void> {
    if (!selectedProjectId) return;
    await mutate(`/v1/tenants/${tenantId}/onboarding/projects/${selectedProjectId}/status`, 'POST', { status });
  }

  async function bootstrapDirector(): Promise<void> {
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await apiFetch<{ verificationDispatched: boolean }>(`/v1/tenants/${tenantId}/onboarding/bootstrap-operations-director`, {
        method: 'POST', body: JSON.stringify(director),
      });
      setNotice(result.verificationDispatched ? t.invite : `${t.invite} — delivery pending`);
      setDirector({ displayName: '', phone: '', verificationChannel: 'WHATSAPP' });
      await loadSnapshot();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to invite Operations Director.');
    } finally { setBusy(false); }
  }

  if (tenants.length === 0 && !busy) {
    return <main className={styles.page}><section className={styles.empty}>{error || t.noTenant}</section></main>;
  }

  const readiness = snapshot?.readiness;
  return (
    <main className={styles.page}>
      <header className={styles.hero}>
        <div><span>{t.eyebrow}</span><h1>{t.title}</h1><p>{t.intro}</p></div>
        <div className={styles.heroActions}>
          <a href={mode === 'platform' ? '/admin' : '/workspace'}>{t.back}</a>
          <button type="button" onClick={() => void loadSnapshot()} disabled={busy}>{t.refresh}</button>
        </div>
      </header>

      {error ? <div className={styles.error} role="alert">{error}</div> : null}
      {notice ? <div className={styles.notice} role="status">{notice}</div> : null}

      <section className={styles.tenantBar}>
        <label><span>{t.tenant}</span><select value={tenantId} onChange={(event) => setTenantId(event.target.value)}>{tenants.map((tenant) => <option key={tenant.tenantId} value={tenant.tenantId}>{tenant.label}</option>)}</select></label>
        <strong>{snapshot ? `${snapshot.tenantName} · ${snapshot.tenantStatus}` : t.loading}</strong>
      </section>

      {snapshot ? <>
        <section className={styles.readiness}>
          <div><span>{t.readiness}</span><strong>{snapshot.status === 'COMPLETED' ? t.completed : readiness?.ready ? t.ready : t.pending}</strong></div>
          {([
            [t.brandConfigured, readiness?.brandingConfigured], [t.directorAssigned, readiness?.operationsDirectorAssigned],
            [t.projectCreated, readiness?.projectCreated], [t.projectBranding, readiness?.projectBrandingConfigured],
          ] as const).map(([label, ok]) => <article key={label} data-ready={ok ? 'true' : 'false'}><b>{ok ? '✓' : '○'}</b><span>{label}</span></article>)}
          <p>{t.tenantActive}</p>
          <button type="button" disabled={busy || !readiness?.ready || snapshot.status === 'COMPLETED'} onClick={() => void mutate(`/v1/tenants/${tenantId}/onboarding/complete`, 'POST')}>{snapshot.status === 'COMPLETED' ? t.completed : t.complete}</button>
        </section>

        <div className={styles.grid}>
          <section className={styles.panel}>
            <h2>{t.brand}</h2>
            <div className={styles.fields}>
              <Field label={t.englishName} value={tenantBrand.displayNameEn} onChange={(value) => setTenantBrand({ ...tenantBrand, displayNameEn: value })} />
              <Field label={t.arabicName} value={tenantBrand.displayNameAr} onChange={(value) => setTenantBrand({ ...tenantBrand, displayNameAr: value })} dir="rtl" />
              <Field label={t.legalName} value={tenantBrand.legalName} onChange={(value) => setTenantBrand({ ...tenantBrand, legalName: value })} />
              <Field label={t.website} value={tenantBrand.websiteUrl} onChange={(value) => setTenantBrand({ ...tenantBrand, websiteUrl: value })} placeholder="https://" />
              <Field label={t.primaryColor} value={tenantBrand.primaryColor} onChange={(value) => setTenantBrand({ ...tenantBrand, primaryColor: value })} />
              <Field label={t.secondaryColor} value={tenantBrand.secondaryColor} onChange={(value) => setTenantBrand({ ...tenantBrand, secondaryColor: value })} />
            </div>
            <button type="button" disabled={busy || !tenantBrand.displayNameEn || !tenantBrand.displayNameAr} onClick={() => void saveTenantBrand()}>{t.save}</button>
          </section>

          <section className={styles.panel}>
            <h2>{t.staff}</h2>
            <div className={styles.metrics}>
              <Metric label={t.opsDirectors} value={snapshot.staff.operationsDirectors} />
              <Metric label={t.pendingDirectors} value={snapshot.staff.pendingOperationsDirectors} />
              <Metric label={t.activeStaff} value={snapshot.staff.activeStaff} />
              <Metric label={t.invitedStaff} value={snapshot.staff.invitedStaff} />
            </div>
            {mode === 'workspace' ? <a className={styles.linkButton} href="/workspace/accounts">{t.accountCenter}</a> : null}
            {mode === 'platform' && snapshot.staff.operationsDirectors === 0 ? <div className={styles.bootstrap}>
              <h3>{t.bootstrap}</h3>
              <Field label={t.displayName} value={director.displayName} onChange={(value) => setDirector({ ...director, displayName: value })} />
              <Field label={t.phone} value={director.phone} onChange={(value) => setDirector({ ...director, phone: value })} placeholder="+20…" />
              <label><span>{t.channel}</span><select value={director.verificationChannel} onChange={(event) => setDirector({ ...director, verificationChannel: event.target.value as 'WHATSAPP' | 'SMS' })}><option value="WHATSAPP">WhatsApp</option><option value="SMS">SMS</option></select></label>
              <button type="button" disabled={busy || !director.displayName || !director.phone} onClick={() => void bootstrapDirector()}>{t.invite}</button>
            </div> : null}
          </section>
        </div>

        <section className={styles.panel}>
          <div className={styles.sectionHead}><h2>{t.projects}</h2><span>{snapshot.projects.length}</span></div>
          <div className={styles.projectCreate}>
            <Field label={t.projectCode} value={projectDraft.code} onChange={(value) => setProjectDraft({ ...projectDraft, code: value })} />
            <Field label={t.projectName} value={projectDraft.name} onChange={(value) => setProjectDraft({ ...projectDraft, name: value })} />
            <Field label={t.currency} value={projectDraft.currency} onChange={(value) => setProjectDraft({ ...projectDraft, currency: value.toUpperCase() })} />
            <Field label={t.timezone} value={projectDraft.timezone} onChange={(value) => setProjectDraft({ ...projectDraft, timezone: value })} />
            <button type="button" disabled={busy || !projectDraft.code || !projectDraft.name} onClick={() => void createProject()}>{t.create}</button>
          </div>

          {snapshot.projects.length ? <div className={styles.projectEditor}>
            <label><span>{t.projects}</span><select value={selectedProjectId} onChange={(event) => chooseProject(event.target.value)}>{snapshot.projects.map((project) => <option key={project.projectId} value={project.projectId}>{project.projectName} · {project.projectStatus}</option>)}</select></label>
            {selectedProject ? <>
              <div className={styles.fields}>
                <Field label={t.englishName} value={projectBrand.displayNameEn} onChange={(value) => setProjectBrand({ ...projectBrand, displayNameEn: value })} />
                <Field label={t.arabicName} value={projectBrand.displayNameAr} onChange={(value) => setProjectBrand({ ...projectBrand, displayNameAr: value })} dir="rtl" />
                <Field label={t.descriptionEn} value={projectBrand.shortDescriptionEn} onChange={(value) => setProjectBrand({ ...projectBrand, shortDescriptionEn: value })} />
                <Field label={t.descriptionAr} value={projectBrand.shortDescriptionAr} onChange={(value) => setProjectBrand({ ...projectBrand, shortDescriptionAr: value })} dir="rtl" />
                <Field label={t.primaryColor} value={projectBrand.primaryColor} onChange={(value) => setProjectBrand({ ...projectBrand, primaryColor: value })} />
                <Field label={t.secondaryColor} value={projectBrand.secondaryColor} onChange={(value) => setProjectBrand({ ...projectBrand, secondaryColor: value })} />
              </div>
              <div className={styles.rowActions}>
                <button type="button" disabled={busy || !projectBrand.displayNameEn || !projectBrand.displayNameAr} onClick={() => void saveProjectBrand()}>{t.saveProjectBrand}</button>
                <label><span>{t.status}</span><select value={selectedProject.projectStatus} onChange={(event) => void setProjectStatus(event.target.value as ProjectStatus)}>{['DRAFT','ACTIVE','PAUSED','CLOSED','ARCHIVED'].map((status) => <option key={status}>{status}</option>)}</select></label>
              </div>
            </> : null}
          </div> : null}
        </section>
      </> : <section className={styles.empty}>{t.loading}</section>}
    </main>
  );
}

function Field({ label, value, onChange, placeholder, dir }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string; dir?: 'rtl' }) {
  return <label><span>{label}</span><input value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} dir={dir} /></label>;
}

function Metric({ label, value }: { label: string; value: number }) {
  return <div><strong>{value}</strong><span>{label}</span></div>;
}
