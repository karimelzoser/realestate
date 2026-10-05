'use client';

import {
  roleHasPermission,
  type WorkspaceContextSnapshot,
  type WorkspaceProjectSnapshot,
} from '@preneura/contracts/access';
import type {
  AiProjectSettingsSnapshot,
  BuyerRecommendationResponse,
  ManagerInsightResponse,
  OutdoorPreference,
} from '@preneura/contracts/ai';
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { ApiError, apiFetch } from '../../../lib/api';
import styles from './ai-workspace.module.css';

export default function AiWorkspaceClient() {
  const [workspace, setWorkspace] = useState<WorkspaceContextSnapshot | null>(null);
  const [projectId, setProjectId] = useState('');
  const [settings, setSettings] = useState<AiProjectSettingsSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const [budgetMax, setBudgetMax] = useState('');
  const [bedrooms, setBedrooms] = useState('');
  const [minArea, setMinArea] = useState('');
  const [gardenPreference, setGardenPreference] = useState<OutdoorPreference>('NONE');
  const [roofPreference, setRoofPreference] = useState<OutdoorPreference>('NONE');
  const [recommendations, setRecommendations] = useState<BuyerRecommendationResponse | null>(null);

  const [question, setQuestion] = useState('What needs attention right now?');
  const [insight, setInsight] = useState<ManagerInsightResponse | null>(null);

  const projects = useMemo(
    () => workspace?.projects.filter((project) => project.roles.some((role) =>
      roleHasPermission(role, 'ai.buyer.use') ||
      roleHasPermission(role, 'ai.manager.use') ||
      roleHasPermission(role, 'ai.settings.manage'),
    )) ?? [],
    [workspace],
  );
  const project = useMemo(
    () => projects.find((candidate) => candidate.projectId === projectId) ?? null,
    [projects, projectId],
  );
  const canBuyer = Boolean(project?.roles.some((role) => roleHasPermission(role, 'ai.buyer.use')));
  const canManager = Boolean(project?.roles.some((role) => roleHasPermission(role, 'ai.manager.use')));
  const canManage = Boolean(project?.roles.some((role) => roleHasPermission(role, 'ai.settings.manage')));

  useEffect(() => {
    let cancelled = false;
    void apiFetch<WorkspaceContextSnapshot>('/v1/me/workspace')
      .then((context) => {
        if (cancelled) return;
        const allowed = context.projects.filter((candidate) => candidate.roles.some((role) =>
          roleHasPermission(role, 'ai.buyer.use') ||
          roleHasPermission(role, 'ai.manager.use') ||
          roleHasPermission(role, 'ai.settings.manage'),
        ));
        if (allowed.length === 0) {
          setError('Your account does not have AI access in any project.');
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
        setError(reason instanceof Error ? reason.message : 'Unable to load AI workspace.');
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const loadSettings = useCallback(async (selectedProject: WorkspaceProjectSnapshot): Promise<void> => {
    setLoading(true);
    setError('');
    try {
      const result = await apiFetch<AiProjectSettingsSnapshot>(
        `/v1/tenants/${selectedProject.tenantId}/projects/${selectedProject.projectId}/ai/settings`,
      );
      setSettings(result);
    } catch (reason: unknown) {
      setSettings(null);
      setError(reason instanceof Error ? reason.message : 'Unable to load AI settings.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!project) return;
    window.localStorage.setItem('preneura:selected-project', project.projectId);
    setRecommendations(null);
    setInsight(null);
    setSuccess('');
    void loadSettings(project);
  }, [project, loadSettings]);

  async function saveSettings(next: Partial<Pick<AiProjectSettingsSnapshot, 'buyerEnabled' | 'managerEnabled' | 'providerCode' | 'model'>>): Promise<void> {
    if (!project || !settings || saving || !canManage) return;
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      const providerCode = next.providerCode ?? settings.providerCode;
      const result = await apiFetch<AiProjectSettingsSnapshot>(
        `/v1/tenants/${project.tenantId}/projects/${project.projectId}/ai/settings`,
        {
          method: 'PATCH',
          body: JSON.stringify({
            buyerEnabled: next.buyerEnabled ?? settings.buyerEnabled,
            managerEnabled: next.managerEnabled ?? settings.managerEnabled,
            providerCode,
            model: providerCode === 'DETERMINISTIC' ? null : (next.model ?? settings.model),
          }),
        },
      );
      setSettings(result);
      setSuccess('AI project settings saved.');
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : 'Unable to save AI settings.');
    } finally {
      setSaving(false);
    }
  }

  async function runRecommendation(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!project || running || !canBuyer) return;
    setRunning(true);
    setError('');
    setSuccess('');
    try {
      const result = await apiFetch<BuyerRecommendationResponse>(
        `/v1/tenants/${project.tenantId}/projects/${project.projectId}/ai/recommendations`,
        {
          method: 'POST',
          body: JSON.stringify({
            budgetMax: optionalNumber(budgetMax),
            bedrooms: optionalInteger(bedrooms),
            minIndoorAreaSqm: optionalNumber(minArea),
            gardenPreference,
            roofPreference,
            maxResults: 5,
          }),
        },
      );
      setRecommendations(result);
    } catch (reason: unknown) {
      setRecommendations(null);
      setError(reason instanceof Error ? reason.message : 'Unable to generate recommendations.');
    } finally {
      setRunning(false);
    }
  }

  async function runManagerInsight(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!project || running || !canManager) return;
    setRunning(true);
    setError('');
    setSuccess('');
    try {
      const result = await apiFetch<ManagerInsightResponse>(
        `/v1/tenants/${project.tenantId}/projects/${project.projectId}/ai/manager-insight`,
        { method: 'POST', body: JSON.stringify({ question }) },
      );
      setInsight(result);
    } catch (reason: unknown) {
      setInsight(null);
      setError(reason instanceof Error ? reason.message : 'Unable to generate manager insight.');
    } finally {
      setRunning(false);
    }
  }

  return (
    <main className={styles.shell}>
      <header className={styles.hero}>
        <div>
          <p className={styles.eyebrow}>PRENEURA intelligence</p>
          <h1>AI workspace</h1>
          <p>
            Advisory recommendations and operational insight built on live PRENEURA data. AI cannot lock units,
            change prices, alter queue order, verify payments, approve refunds, or modify transaction state.
          </p>
        </div>
        <a className={styles.backLink} href="/workspace">Back to workspace</a>
      </header>

      <section className={styles.toolbar}>
        <label>
          Project
          <select value={projectId} onChange={(event) => setProjectId(event.target.value)} disabled={projects.length < 2}>
            {projects.map((candidate) => (
              <option key={candidate.projectId} value={candidate.projectId}>{candidate.projectName}</option>
            ))}
          </select>
        </label>
        <div className={styles.statusStrip}>
          <span>{settings?.providerCode === 'EXTERNAL_HTTP' ? 'External reranking enabled' : 'Deterministic engine'}</span>
          <span>{settings?.externalProviderConfigured ? 'Provider endpoint configured' : 'No external provider required'}</span>
        </div>
      </section>

      {error ? <div className={styles.error}>{error}</div> : null}
      {success ? <div className={styles.success}>{success}</div> : null}
      {loading ? <div className={styles.loading}>Loading AI policy and project context…</div> : null}

      {!loading && settings ? (
        <div className={styles.grid}>
          {canBuyer ? (
            <section className={styles.panel}>
              <div className={styles.panelHeader}>
                <div>
                  <p className={styles.kicker}>Buyer advisor</p>
                  <h2>Find the strongest unit types</h2>
                </div>
                <span className={settings.buyerEnabled ? styles.enabled : styles.disabled}>
                  {settings.buyerEnabled ? 'Enabled' : 'Disabled'}
                </span>
              </div>
              {settings.buyerEnabled ? (
                <form className={styles.form} onSubmit={runRecommendation}>
                  <div className={styles.formGrid}>
                    <label>Maximum budget<input inputMode="decimal" value={budgetMax} onChange={(event) => setBudgetMax(event.target.value)} placeholder="e.g. 8500000" /></label>
                    <label>Bedrooms<input inputMode="numeric" value={bedrooms} onChange={(event) => setBedrooms(event.target.value)} placeholder="e.g. 3" /></label>
                    <label>Minimum indoor area<input inputMode="decimal" value={minArea} onChange={(event) => setMinArea(event.target.value)} placeholder="sqm" /></label>
                    <label>Garden<select value={gardenPreference} onChange={(event) => setGardenPreference(event.target.value as OutdoorPreference)}><option value="NONE">No preference</option><option value="PREFER">Prefer</option><option value="REQUIRED">Required</option></select></label>
                    <label>Roof<select value={roofPreference} onChange={(event) => setRoofPreference(event.target.value as OutdoorPreference)}><option value="NONE">No preference</option><option value="PREFER">Prefer</option><option value="REQUIRED">Required</option></select></label>
                  </div>
                  <button type="submit" disabled={running}>{running ? 'Analyzing…' : 'Recommend available unit types'}</button>
                </form>
              ) : <p className={styles.muted}>Buyer recommendations are disabled by the project manager.</p>}

              {recommendations ? (
                <div className={styles.results}>
                  <div className={styles.resultMeta}>
                    <span>{recommendations.providerUsed}</span>
                    {recommendations.fallbackUsed ? <span>Provider fallback used</span> : null}
                    <span>Advisory only</span>
                  </div>
                  {recommendations.results.length === 0 ? <p className={styles.muted}>No currently available unit type matches all selected hard filters.</p> : null}
                  {recommendations.results.map((item, index) => (
                    <article className={styles.recommendation} key={item.unitTypeId}>
                      <div className={styles.rank}>{index + 1}</div>
                      <div className={styles.recommendationBody}>
                        <div className={styles.recommendationTitle}><h3>{item.name}</h3><strong>{item.score.toFixed(1)}</strong></div>
                        <p>{item.bedroomCount ?? '—'} beds · {item.indoorAreaSqm} sqm indoor · {item.availableQuantity} available</p>
                        <p>{item.currentTotalPrice ? `${Number(item.currentTotalPrice).toLocaleString()} ${item.currency}` : 'Current price not available to this role'}</p>
                        <ul>{item.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>
                      </div>
                    </article>
                  ))}
                </div>
              ) : null}
            </section>
          ) : null}

          {canManager ? (
            <section className={styles.panel}>
              <div className={styles.panelHeader}>
                <div><p className={styles.kicker}>Manager assistant</p><h2>Explain the operational picture</h2></div>
                <span className={settings.managerEnabled ? styles.enabled : styles.disabled}>{settings.managerEnabled ? 'Enabled' : 'Disabled'}</span>
              </div>
              {settings.managerEnabled ? (
                <form className={styles.form} onSubmit={runManagerInsight}>
                  <label>Question<textarea rows={3} value={question} maxLength={500} onChange={(event) => setQuestion(event.target.value)} /></label>
                  <p className={styles.privacyNote}>Your raw question remains inside PRENEURA. External providers receive only a coarse topic and aggregate project metrics.</p>
                  <button type="submit" disabled={running || question.trim().length < 3}>{running ? 'Analyzing…' : 'Generate insight'}</button>
                </form>
              ) : <p className={styles.muted}>Manager AI is disabled for this project.</p>}

              {insight ? (
                <div className={styles.insight}>
                  <div className={styles.resultMeta}><span>{insight.providerUsed}</span>{insight.fallbackUsed ? <span>Provider fallback used</span> : null}<span>Advisory only</span></div>
                  <h3>{insight.answer}</h3>
                  <ul>{insight.findings.map((finding) => <li key={finding}>{finding}</li>)}</ul>
                  <div className={styles.metrics}>
                    <Metric label="Available" value={insight.metrics.availableInventory} />
                    <Metric label="Open + ready" value={insight.metrics.transactionsOpen + insight.metrics.transactionsReady} />
                    <Metric label="Overdue payments" value={insight.metrics.overduePaymentItems} />
                    <Metric label="Due commissions" value={insight.metrics.dueCommissionCases} />
                    <Metric label="Failed messages" value={insight.metrics.failedNotificationJobs} />
                    <Metric label="Document gaps" value={insight.metrics.pendingDocumentRequirements} />
                  </div>
                </div>
              ) : null}
            </section>
          ) : null}

          {canManage ? (
            <section className={`${styles.panel} ${styles.settingsPanel}`}>
              <div className={styles.panelHeader}><div><p className={styles.kicker}>Project policy</p><h2>AI controls</h2></div></div>
              <div className={styles.settingRows}>
                <label className={styles.toggleRow}><span><strong>Buyer recommendations</strong><small>Ranks currently available unit types only.</small></span><input type="checkbox" checked={settings.buyerEnabled} disabled={saving} onChange={(event) => void saveSettings({ buyerEnabled: event.target.checked })} /></label>
                <label className={styles.toggleRow}><span><strong>Manager assistant</strong><small>Reads aggregate operational metrics only.</small></span><input type="checkbox" checked={settings.managerEnabled} disabled={saving} onChange={(event) => void saveSettings({ managerEnabled: event.target.checked })} /></label>
                <label>Provider mode<select value={settings.providerCode} disabled={saving} onChange={(event) => void saveSettings({ providerCode: event.target.value as AiProjectSettingsSnapshot['providerCode'] })}><option value="DETERMINISTIC">Deterministic PRENEURA engine</option><option value="EXTERNAL_HTTP">External HTTP reranker / explainer</option></select></label>
                {settings.providerCode === 'EXTERNAL_HTTP' ? (
                  <label>Model label<input value={settings.model ?? ''} disabled={saving} placeholder="Optional provider model" onBlur={(event) => void saveSettings({ model: event.target.value.trim() || null })} onChange={(event) => setSettings({ ...settings, model: event.target.value })} /></label>
                ) : null}
              </div>
              <p className={styles.privacyNote}>Provider credentials stay server-side. External AI receives sanitized candidate data or project aggregates and has no operational write path.</p>
            </section>
          ) : null}
        </div>
      ) : null}
    </main>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return <div><strong>{value}</strong><span>{label}</span></div>;
}

function optionalNumber(value: string): number | null {
  if (!value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function optionalInteger(value: string): number | null {
  if (!value.trim()) return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : null;
}
