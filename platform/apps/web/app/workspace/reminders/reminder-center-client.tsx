'use client';

import {
  roleHasPermission,
  type WorkspaceContextSnapshot,
  type WorkspaceProjectSnapshot,
} from '@preneura/contracts/access';
import type {
  InstallmentReminderItemType,
  InstallmentReminderPolicySnapshot,
  MilestoneReminderPolicySnapshot,
  NotificationAudience,
  NotificationChannel,
} from '@preneura/contracts/notifications';
import type { TransactionMilestoneCode } from '@preneura/contracts/sales';
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { ApiError, apiFetch } from '../../../lib/api';
import styles from './reminder-center.module.css';

const audiences: NotificationAudience[] = [
  'BUYER',
  'BROKER_AGENT',
  'BROKER_MANAGER',
  'BROKER_FINANCE',
  'SALES',
  'TRANSACTION_OPERATOR',
  'MANAGER',
];
const channels: NotificationChannel[] = ['WHATSAPP', 'SMS', 'EMAIL', 'IN_APP'];
const milestones: TransactionMilestoneCode[] = [
  'BUYER_DOCUMENTS_COMPLETE',
  'DOWN_PAYMENT_RECEIVED',
  'CHEQUES_RECEIVED',
  'CONTRACT_GENERATED',
  'CONTRACT_SIGNED',
  'CONTRACT_STAMPED',
];
const paymentTypes: InstallmentReminderItemType[] = ['DOWN_PAYMENT', 'INSTALLMENT', 'FEE'];

export default function ReminderCenterClient() {
  const [workspace, setWorkspace] = useState<WorkspaceContextSnapshot | null>(null);
  const [projectId, setProjectId] = useState('');
  const [milestonePolicies, setMilestonePolicies] = useState<MilestoneReminderPolicySnapshot[]>([]);
  const [installmentPolicies, setInstallmentPolicies] = useState<InstallmentReminderPolicySnapshot[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const [milestoneCode, setMilestoneCode] = useState<TransactionMilestoneCode>('BUYER_DOCUMENTS_COMPLETE');
  const [targetHours, setTargetHours] = useState(72);
  const [milestoneLeadHours, setMilestoneLeadHours] = useState(24);
  const [milestoneAudience, setMilestoneAudience] = useState<NotificationAudience>('TRANSACTION_OPERATOR');
  const [milestoneChannel, setMilestoneChannel] = useState<NotificationChannel>('IN_APP');
  const [milestoneTemplate, setMilestoneTemplate] = useState('transaction.milestone.sla');
  const [milestoneLocale, setMilestoneLocale] = useState('ar-EG');

  const [itemType, setItemType] = useState<InstallmentReminderItemType>('INSTALLMENT');
  const [installmentLeadHours, setInstallmentLeadHours] = useState(24);
  const [installmentAudience, setInstallmentAudience] = useState<NotificationAudience>('BUYER');
  const [installmentChannel, setInstallmentChannel] = useState<NotificationChannel>('WHATSAPP');
  const [installmentTemplate, setInstallmentTemplate] = useState('payment.installment.due');
  const [installmentLocale, setInstallmentLocale] = useState('ar-EG');

  const projects = useMemo(
    () => workspace?.projects.filter((project) =>
      project.roles.some((role) => roleHasPermission(role, 'notifications.manage')),
    ) ?? [],
    [workspace],
  );
  const project = useMemo(
    () => projects.find((candidate) => candidate.projectId === projectId) ?? null,
    [projects, projectId],
  );

  useEffect(() => {
    let cancelled = false;
    void apiFetch<WorkspaceContextSnapshot>('/v1/me/workspace')
      .then((context) => {
        if (cancelled) return;
        const allowed = context.projects.filter((candidate) =>
          candidate.roles.some((role) => roleHasPermission(role, 'notifications.manage')),
        );
        if (allowed.length === 0) {
          setError('Your account does not have reminder-management permission in any project.');
          setLoading(false);
          return;
        }
        setWorkspace(context);
        const stored = window.localStorage.getItem('preneura:selected-project');
        const initial = allowed.find((candidate) => candidate.projectId === stored) ?? allowed[0]!;
        setProjectId(initial.projectId);
      })
      .catch((reason: unknown) => {
        if (reason instanceof ApiError && reason.status === 401) {
          window.location.replace('/login');
          return;
        }
        setError(reason instanceof Error ? reason.message : 'Unable to load reminder workspace.');
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const loadPolicies = useCallback(async (selectedProject: WorkspaceProjectSnapshot): Promise<void> => {
    setLoading(true);
    setError('');
    try {
      const [milestonesResult, installmentsResult] = await Promise.all([
        apiFetch<MilestoneReminderPolicySnapshot[]>(
          `/v1/tenants/${selectedProject.tenantId}/projects/${selectedProject.projectId}/milestone-reminder-policies`,
        ),
        apiFetch<InstallmentReminderPolicySnapshot[]>(
          `/v1/tenants/${selectedProject.tenantId}/projects/${selectedProject.projectId}/installment-reminder-policies`,
        ),
      ]);
      setMilestonePolicies(milestonesResult);
      setInstallmentPolicies(installmentsResult);
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : 'Unable to load reminder policies.');
      setMilestonePolicies([]);
      setInstallmentPolicies([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!project) return;
    window.localStorage.setItem('preneura:selected-project', project.projectId);
    void loadPolicies(project);
  }, [project, loadPolicies]);

  async function saveMilestone(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!project || saving) return;
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      await apiFetch<MilestoneReminderPolicySnapshot>(
        `/v1/tenants/${project.tenantId}/projects/${project.projectId}/milestone-reminder-policies`,
        {
          method: 'POST',
          body: JSON.stringify({
            milestoneCode,
            targetHoursAfterOpen: targetHours,
            reminderHoursBefore: milestoneLeadHours,
            audience: milestoneAudience,
            channel: milestoneChannel,
            templateCode: milestoneTemplate,
            locale: milestoneLocale,
            enabled: true,
          }),
        },
      );
      await loadPolicies(project);
      setSuccess('Missing-step reminder policy saved.');
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : 'Unable to save milestone reminder.');
    } finally {
      setSaving(false);
    }
  }

  async function saveInstallment(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!project || saving) return;
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      await apiFetch<InstallmentReminderPolicySnapshot>(
        `/v1/tenants/${project.tenantId}/projects/${project.projectId}/installment-reminder-policies`,
        {
          method: 'POST',
          body: JSON.stringify({
            itemType,
            reminderHoursBefore: installmentLeadHours,
            audience: installmentAudience,
            channel: installmentChannel,
            templateCode: installmentTemplate,
            locale: installmentLocale,
            enabled: true,
          }),
        },
      );
      await loadPolicies(project);
      setSuccess('Payment-due reminder policy saved.');
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : 'Unable to save installment reminder.');
    } finally {
      setSaving(false);
    }
  }

  async function toggleMilestone(policy: MilestoneReminderPolicySnapshot): Promise<void> {
    if (!project || saving) return;
    setSaving(true);
    setError('');
    try {
      await apiFetch<MilestoneReminderPolicySnapshot>(
        `/v1/tenants/${project.tenantId}/projects/${project.projectId}/milestone-reminder-policies`,
        {
          method: 'POST',
          body: JSON.stringify({
            milestoneCode: policy.milestoneCode,
            targetHoursAfterOpen: policy.targetHoursAfterOpen,
            reminderHoursBefore: policy.reminderHoursBefore,
            audience: policy.audience,
            channel: policy.channel,
            templateCode: policy.templateCode,
            locale: policy.locale,
            enabled: !policy.enabled,
          }),
        },
      );
      await loadPolicies(project);
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : 'Unable to update milestone reminder.');
    } finally {
      setSaving(false);
    }
  }

  async function toggleInstallment(policy: InstallmentReminderPolicySnapshot): Promise<void> {
    if (!project || saving) return;
    setSaving(true);
    setError('');
    try {
      await apiFetch<InstallmentReminderPolicySnapshot>(
        `/v1/tenants/${project.tenantId}/projects/${project.projectId}/installment-reminder-policies`,
        {
          method: 'POST',
          body: JSON.stringify({
            itemType: policy.itemType,
            reminderHoursBefore: policy.reminderHoursBefore,
            audience: policy.audience,
            channel: policy.channel,
            templateCode: policy.templateCode,
            locale: policy.locale,
            enabled: !policy.enabled,
          }),
        },
      );
      await loadPolicies(project);
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : 'Unable to update payment reminder.');
    } finally {
      setSaving(false);
    }
  }

  if (!workspace && loading) {
    return <main className={styles.statePage}><div className={styles.brandMark}>P</div><p>Loading Reminder Center…</p></main>;
  }

  return (
    <main className={styles.page}>
      <header className={styles.topbar}>
        <a href="/workspace" className={styles.backButton}>←</a>
        <div className={styles.brandMark}>P</div>
        <div className={styles.brandText}><strong>PRENEURA</strong><span>Reminder Center</span></div>
        <div className={styles.projectPicker}>
          <label htmlFor="reminder-project">Project</label>
          <select id="reminder-project" value={projectId} onChange={(event) => setProjectId(event.target.value)}>
            {projects.map((item) => <option key={item.projectId} value={item.projectId}>{item.projectName}</option>)}
          </select>
        </div>
      </header>

      <section className={styles.content}>
        <div className={styles.heading}>
          <div>
            <span className={styles.eyebrow}>Operations automation</span>
            <h1>Reminder Center</h1>
            <p>
              Configure who is reminded, when, and through which channel. Policies are reconciled by the durable worker,
              so completed milestones and paid installments automatically cancel stale pending reminders.
            </p>
          </div>
          <div className={styles.gatewayCard}>
            <strong>External channel contract</strong>
            <span>WhatsApp, SMS and email are dispatched through the configured Notification Gateway with idempotency and retry audit. In-app delivery is native.</span>
          </div>
        </div>

        {error ? <div className={styles.error}>{error}</div> : null}
        {success ? <div className={styles.success}>{success}</div> : null}

        <section className={styles.twoColumn}>
          <form className={styles.formCard} onSubmit={saveMilestone}>
            <div className={styles.cardHeading}>
              <span className={styles.eyebrow}>Missing steps</span>
              <h2>Milestone reminder</h2>
              <p>One milestone may have several policies—for example buyer WhatsApp plus manager in-app.</p>
            </div>
            <SelectField label="Milestone" value={milestoneCode} onChange={(value) => setMilestoneCode(value as TransactionMilestoneCode)} options={milestones} />
            <div className={styles.fieldRow}>
              <NumberField label="Target after open (hours)" value={targetHours} min={1} onChange={setTargetHours} />
              <NumberField label="Remind before target (hours)" value={milestoneLeadHours} min={0} onChange={setMilestoneLeadHours} />
            </div>
            <div className={styles.fieldRow}>
              <SelectField label="Audience" value={milestoneAudience} onChange={(value) => setMilestoneAudience(value as NotificationAudience)} options={audiences} />
              <SelectField label="Channel" value={milestoneChannel} onChange={(value) => setMilestoneChannel(value as NotificationChannel)} options={channels} />
            </div>
            <TextField label="Template code" value={milestoneTemplate} onChange={setMilestoneTemplate} />
            <TextField label="Locale" value={milestoneLocale} onChange={setMilestoneLocale} />
            <button type="submit" disabled={saving || !project}>{saving ? 'Saving…' : 'Save milestone policy'}</button>
          </form>

          <form className={styles.formCard} onSubmit={saveInstallment}>
            <div className={styles.cardHeading}>
              <span className={styles.eyebrow}>Finance reminders</span>
              <h2>Payment due reminder</h2>
              <p>Anchored directly to each schedule item due date, not the transaction start time.</p>
            </div>
            <SelectField label="Payment item" value={itemType} onChange={(value) => setItemType(value as InstallmentReminderItemType)} options={paymentTypes} />
            <NumberField label="Remind before due date (hours)" value={installmentLeadHours} min={0} onChange={setInstallmentLeadHours} />
            <div className={styles.fieldRow}>
              <SelectField label="Audience" value={installmentAudience} onChange={(value) => setInstallmentAudience(value as NotificationAudience)} options={audiences} />
              <SelectField label="Channel" value={installmentChannel} onChange={(value) => setInstallmentChannel(value as NotificationChannel)} options={channels} />
            </div>
            <TextField label="Template code" value={installmentTemplate} onChange={setInstallmentTemplate} />
            <TextField label="Locale" value={installmentLocale} onChange={setInstallmentLocale} />
            <button type="submit" disabled={saving || !project}>{saving ? 'Saving…' : 'Save payment policy'}</button>
          </form>
        </section>

        <section className={styles.policySection}>
          <div className={styles.sectionHeading}>
            <div><span className={styles.eyebrow}>Active configuration</span><h2>Missing-step policies</h2></div>
            <span>{milestonePolicies.length} configured</span>
          </div>
          {milestonePolicies.length === 0 && !loading ? <div className={styles.empty}>No milestone reminder policies configured yet.</div> : null}
          <div className={styles.policyGrid}>
            {milestonePolicies.map((policy) => (
              <article className={styles.policyCard} key={policy.policyId}>
                <PolicyHeader title={formatToken(policy.milestoneCode)} enabled={policy.enabled} channel={policy.channel} />
                <div className={styles.policyData}>
                  <Data label="Audience" value={formatToken(policy.audience)} />
                  <Data label="Target" value={`${policy.targetHoursAfterOpen}h after open`} />
                  <Data label="Lead" value={`${policy.reminderHoursBefore}h before`} />
                  <Data label="Locale" value={policy.locale} />
                </div>
                <code>{policy.templateCode}</code>
                <button type="button" onClick={() => void toggleMilestone(policy)} disabled={saving}>{policy.enabled ? 'Disable' : 'Enable'}</button>
              </article>
            ))}
          </div>
        </section>

        <section className={styles.policySection}>
          <div className={styles.sectionHeading}>
            <div><span className={styles.eyebrow}>Finance schedule</span><h2>Payment-due policies</h2></div>
            <span>{installmentPolicies.length} configured</span>
          </div>
          {installmentPolicies.length === 0 && !loading ? <div className={styles.empty}>No payment reminder policies configured yet.</div> : null}
          <div className={styles.policyGrid}>
            {installmentPolicies.map((policy) => (
              <article className={styles.policyCard} key={policy.policyId}>
                <PolicyHeader title={formatToken(policy.itemType)} enabled={policy.enabled} channel={policy.channel} />
                <div className={styles.policyData}>
                  <Data label="Audience" value={formatToken(policy.audience)} />
                  <Data label="Lead" value={`${policy.reminderHoursBefore}h before due`} />
                  <Data label="Locale" value={policy.locale} />
                  <Data label="Status" value={policy.enabled ? 'Enabled' : 'Disabled'} />
                </div>
                <code>{policy.templateCode}</code>
                <button type="button" onClick={() => void toggleInstallment(policy)} disabled={saving}>{policy.enabled ? 'Disable' : 'Enable'}</button>
              </article>
            ))}
          </div>
        </section>
      </section>
    </main>
  );
}

function SelectField(props: { label: string; value: string; options: readonly string[]; onChange(value: string): void }) {
  return (
    <label className={styles.field}>
      <span>{props.label}</span>
      <select value={props.value} onChange={(event) => props.onChange(event.target.value)}>
        {props.options.map((option) => <option key={option} value={option}>{formatToken(option)}</option>)}
      </select>
    </label>
  );
}

function NumberField(props: { label: string; value: number; min: number; onChange(value: number): void }) {
  return (
    <label className={styles.field}>
      <span>{props.label}</span>
      <input type="number" min={props.min} max={87600} value={props.value} onChange={(event) => props.onChange(Number(event.target.value))} />
    </label>
  );
}

function TextField(props: { label: string; value: string; onChange(value: string): void }) {
  return (
    <label className={styles.field}>
      <span>{props.label}</span>
      <input type="text" value={props.value} onChange={(event) => props.onChange(event.target.value)} required />
    </label>
  );
}

function PolicyHeader(props: { title: string; enabled: boolean; channel: NotificationChannel }) {
  return (
    <div className={styles.policyHeader}>
      <div><strong>{props.title}</strong><span>{formatToken(props.channel)}</span></div>
      <span className={props.enabled ? styles.enabled : styles.disabled}>{props.enabled ? 'Enabled' : 'Disabled'}</span>
    </div>
  );
}

function Data(props: { label: string; value: string }) {
  return <div><span>{props.label}</span><strong>{props.value}</strong></div>;
}

function formatToken(value: string): string {
  return value.toLowerCase().split('_').map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ');
}
