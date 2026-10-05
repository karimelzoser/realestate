'use client';

import {
  roleHasPermission,
  type WorkspaceContextSnapshot,
  type WorkspaceProjectSnapshot,
} from '@preneura/contracts/access';
import type {
  ProjectHierarchySnapshot,
  ProjectImportJobSnapshot,
  ProjectImportPreviewSnapshot,
  ProjectImportSourceFormat,
  ProjectImportType,
} from '@preneura/contracts/project-catalog';
import { useCallback, useEffect, useMemo, useState, type ChangeEvent } from 'react';
import { ApiError, apiFetch } from '../../../lib/api';
import styles from './project-setup.module.css';

type Row = Record<string, unknown>;
type ParsedFile = {
  sourceFormat: ProjectImportSourceFormat;
  fileName: string;
  sha256Hex: string;
  headers: string[];
  rows: Row[];
};

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_ROWS = 2000;

const fieldsByType: Record<ProjectImportType, Array<{ key: string; label: string; required?: boolean }>> = {
  HIERARCHY: [
    { key: 'phaseCode', label: 'Phase code' },
    { key: 'phaseName', label: 'Phase name' },
    { key: 'phaseSortOrder', label: 'Phase sort order' },
    { key: 'buildingCode', label: 'Building code' },
    { key: 'buildingName', label: 'Building name' },
    { key: 'clusterName', label: 'Cluster name' },
    { key: 'buildingSortOrder', label: 'Building sort order' },
    { key: 'floorCode', label: 'Floor code' },
    { key: 'floorName', label: 'Floor name' },
    { key: 'levelNumber', label: 'Floor level' },
    { key: 'floorSortOrder', label: 'Floor sort order' },
  ],
  UNIT_TYPES: [
    { key: 'code', label: 'Unit type code', required: true },
    { key: 'name', label: 'Unit type name', required: true },
    { key: 'description', label: 'Description' },
    { key: 'bedroomCount', label: 'Bedrooms' },
    { key: 'indoorAreaSqm', label: 'Indoor area sqm', required: true },
    { key: 'roofAreaSqm', label: 'Roof area sqm' },
    { key: 'gardenAreaSqm', label: 'Garden area sqm' },
    { key: 'sortOrder', label: 'Sort order' },
  ],
  PHYSICAL_UNITS: [
    { key: 'internalReference', label: 'Internal unit reference', required: true },
    { key: 'displayReference', label: 'Display reference' },
    { key: 'buildingCode', label: 'Building code', required: true },
    { key: 'floorCode', label: 'Floor code', required: true },
    { key: 'unitTypeCode', label: 'Unit type code', required: true },
    { key: 'orientation', label: 'Orientation' },
    { key: 'viewCode', label: 'View code' },
    { key: 'cornerPosition', label: 'Corner position' },
  ],
  PRICING: [
    { key: 'pricingLabel', label: 'Pricing version label', required: true },
    { key: 'effectiveAt', label: 'Effective at', required: true },
    { key: 'unitTypeCode', label: 'Unit type code', required: true },
    { key: 'component', label: 'Component (INDOOR/ROOF/GARDEN)', required: true },
    { key: 'ratePerSqm', label: 'Rate per sqm', required: true },
  ],
  PAYMENT_PLANS: [
    { key: 'code', label: 'Plan code', required: true },
    { key: 'name', label: 'Plan name', required: true },
    { key: 'versionNumber', label: 'Version', required: true },
    { key: 'effectiveAt', label: 'Effective at', required: true },
    { key: 'downPaymentPercent', label: 'Down payment %', required: true },
    { key: 'installmentCount', label: 'Installment count', required: true },
    { key: 'installmentIntervalMonths', label: 'Interval months' },
    { key: 'finalPaymentPercent', label: 'Final payment %' },
    { key: 'maintenancePercent', label: 'Maintenance %' },
    { key: 'notes', label: 'Notes' },
  ],
};

export default function ProjectSetupClient() {
  const [workspace, setWorkspace] = useState<WorkspaceContextSnapshot | null>(null);
  const [projectId, setProjectId] = useState('');
  const [hierarchy, setHierarchy] = useState<ProjectHierarchySnapshot | null>(null);
  const [jobs, setJobs] = useState<ProjectImportJobSnapshot[]>([]);
  const [importType, setImportType] = useState<ProjectImportType>('HIERARCHY');
  const [parsedFile, setParsedFile] = useState<ParsedFile | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<ProjectImportPreviewSnapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const projects = useMemo(
    () => workspace?.projects.filter((project) => project.roles.some((role) =>
      roleHasPermission(role, 'project.import.manage') || roleHasPermission(role, 'project.manage'),
    )) ?? [],
    [workspace],
  );
  const project = useMemo(() => projects.find((item) => item.projectId === projectId) ?? null, [projects, projectId]);
  const canImport = Boolean(project?.roles.some((role) => roleHasPermission(role, 'project.import.manage')));

  useEffect(() => {
    let cancelled = false;
    void apiFetch<WorkspaceContextSnapshot>('/v1/me/workspace')
      .then((context) => {
        if (cancelled) return;
        const allowed = context.projects.filter((candidate) => candidate.roles.some((role) =>
          roleHasPermission(role, 'project.import.manage') || roleHasPermission(role, 'project.manage'),
        ));
        if (allowed.length === 0) {
          setError('Your account does not have project setup access.');
          setLoading(false);
          return;
        }
        setWorkspace(context);
        const stored = window.localStorage.getItem('preneura:selected-project');
        setProjectId((allowed.find((item) => item.projectId === stored) ?? allowed[0]!).projectId);
      })
      .catch((reason: unknown) => {
        if (reason instanceof ApiError && reason.status === 401) {
          window.location.replace('/login');
          return;
        }
        setError(message(reason, 'Unable to load project setup.'));
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  const refresh = useCallback(async (selected: WorkspaceProjectSnapshot): Promise<void> => {
    setLoading(true);
    setError('');
    try {
      const [nextHierarchy, nextJobs] = await Promise.all([
        apiFetch<ProjectHierarchySnapshot>(`/v1/tenants/${selected.tenantId}/projects/${selected.projectId}/project-catalog`),
        canProjectImport(selected)
          ? apiFetch<ProjectImportJobSnapshot[]>(`/v1/tenants/${selected.tenantId}/projects/${selected.projectId}/project-catalog/imports`)
          : Promise.resolve([]),
      ]);
      setHierarchy(nextHierarchy);
      setJobs(nextJobs);
    } catch (reason: unknown) {
      setError(message(reason, 'Unable to load project catalog.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!project) return;
    window.localStorage.setItem('preneura:selected-project', project.projectId);
    setPreview(null);
    setParsedFile(null);
    setMapping({});
    setSuccess('');
    void refresh(project);
  }, [project, refresh]);

  async function onFile(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setError('');
    setSuccess('');
    setPreview(null);
    try {
      const parsed = await parseImportFile(file);
      if (parsed.rows.length === 0) throw new Error('The file does not contain data rows.');
      if (parsed.rows.length > MAX_ROWS) throw new Error(`A single import is limited to ${MAX_ROWS.toLocaleString()} rows.`);
      setParsedFile(parsed);
      setMapping(autoMap(fieldsByType[importType].map((field) => field.key), parsed.headers));
    } catch (reason: unknown) {
      setParsedFile(null);
      setMapping({});
      setError(message(reason, 'Unable to read the import file.'));
    } finally {
      setBusy(false);
    }
  }

  function changeImportType(next: ProjectImportType): void {
    setImportType(next);
    setPreview(null);
    if (parsedFile) setMapping(autoMap(fieldsByType[next].map((field) => field.key), parsedFile.headers));
  }

  async function validateFile(): Promise<void> {
    if (!project || !parsedFile || busy || !canImport) return;
    const missingRequired = fieldsByType[importType].filter((field) => field.required && !mapping[field.key]);
    if (missingRequired.length > 0) {
      setError(`Map required fields: ${missingRequired.map((field) => field.label).join(', ')}.`);
      return;
    }
    setBusy(true);
    setError('');
    setSuccess('');
    try {
      const job = await apiFetch<ProjectImportJobSnapshot>(
        `/v1/tenants/${project.tenantId}/projects/${project.projectId}/project-catalog/imports`,
        {
          method: 'POST',
          body: JSON.stringify({
            importType,
            sourceFormat: parsedFile.sourceFormat,
            sourceFileName: parsedFile.fileName,
            sourceSha256Hex: parsedFile.sha256Hex,
            sourceObjectKey: null,
            mapping,
          }),
        },
      );
      await apiFetch(
        `/v1/tenants/${project.tenantId}/projects/${project.projectId}/project-catalog/imports/${job.id}/rows`,
        {
          method: 'POST',
          body: JSON.stringify({ rows: parsedFile.rows.map((data, index) => ({ rowNumber: index + 2, data })) }),
        },
      );
      const validated = await apiFetch<ProjectImportPreviewSnapshot>(
        `/v1/tenants/${project.tenantId}/projects/${project.projectId}/project-catalog/imports/${job.id}/validate`,
        { method: 'POST' },
      );
      setPreview(validated);
      setJobs((current) => [validated.job, ...current.filter((item) => item.id !== validated.job.id)]);
      setSuccess(validated.job.invalidRows === 0 ? 'Validation passed. Review the preview before publishing.' : 'Validation completed with errors. Nothing has been published.');
    } catch (reason: unknown) {
      setError(message(reason, 'Import validation failed.'));
    } finally {
      setBusy(false);
    }
  }

  async function publish(): Promise<void> {
    if (!project || !preview || busy || preview.job.invalidRows !== 0) return;
    if (!window.confirm(`Publish ${preview.job.validRows.toLocaleString()} validated ${labelType(preview.job.importType)} rows?`)) return;
    setBusy(true);
    setError('');
    setSuccess('');
    try {
      await apiFetch(`/v1/tenants/${project.tenantId}/projects/${project.projectId}/project-catalog/imports/${preview.job.id}/publish`, { method: 'POST' });
      setSuccess('Import published atomically. Project data has been refreshed.');
      setPreview(null);
      setParsedFile(null);
      setMapping({});
      await refresh(project);
    } catch (reason: unknown) {
      setError(message(reason, 'Import publication failed. No partial publication was committed.'));
    } finally {
      setBusy(false);
    }
  }

  async function openJob(jobId: string): Promise<void> {
    if (!project || busy) return;
    setBusy(true);
    setError('');
    try {
      setPreview(await apiFetch<ProjectImportPreviewSnapshot>(`/v1/tenants/${project.tenantId}/projects/${project.projectId}/project-catalog/imports/${jobId}`));
    } catch (reason: unknown) {
      setError(message(reason, 'Unable to load import preview.'));
    } finally {
      setBusy(false);
    }
  }

  async function rollback(job: ProjectImportJobSnapshot): Promise<void> {
    if (!project || busy || job.status !== 'PUBLISHED') return;
    if (!window.confirm('Roll back this import? This is allowed only while every imported record is still unused/reversible.')) return;
    setBusy(true);
    setError('');
    setSuccess('');
    try {
      await apiFetch(`/v1/tenants/${project.tenantId}/projects/${project.projectId}/project-catalog/imports/${job.id}/rollback`, { method: 'POST' });
      setSuccess('Import rollback completed. Imported records that belonged to this publication were removed atomically.');
      await refresh(project);
    } catch (reason: unknown) {
      setError(message(reason, 'Rollback was blocked. No partial rollback was committed.'));
    } finally {
      setBusy(false);
    }
  }

  const stats = hierarchy ? {
    phases: hierarchy.phases.length,
    buildings: hierarchy.buildings.length,
    floors: hierarchy.floors.length,
    units: hierarchy.physicalUnits.length,
    saleable: hierarchy.physicalUnits.filter((unit) => unit.inventorySlotId && unit.inventoryState !== 'WITHDRAWN').length,
  } : null;

  return (
    <main className={styles.shell}>
      <header className={styles.hero}>
        <div>
          <p className={styles.eyebrow}>PROJECT CONTROL</p>
          <h1>Project setup & imports</h1>
          <p>Build the internal master-plan hierarchy and publish commercial data through mapped, validated, reversible imports. Buyers still select unit types; physical unit references remain an internal inventory layer.</p>
        </div>
        <a className={styles.backLink} href="/workspace">Back to workspace</a>
      </header>

      <section className={styles.projectBar}>
        <label>Project<select value={projectId} onChange={(event) => setProjectId(event.target.value)}>{projects.map((item) => <option key={item.projectId} value={item.projectId}>{item.projectName}</option>)}</select></label>
        <div className={styles.guardrail}>Type-based selling stays authoritative · internal physical mapping is not a buyer selector</div>
      </section>

      {error ? <div className={styles.error}>{error}</div> : null}
      {success ? <div className={styles.success}>{success}</div> : null}
      {loading ? <div className={styles.loading}>Loading project catalog…</div> : null}

      {!loading && hierarchy && stats ? (
        <>
          <section className={styles.stats}>
            <Stat label="Phases" value={stats.phases} />
            <Stat label="Buildings" value={stats.buildings} />
            <Stat label="Floors" value={stats.floors} />
            <Stat label="Physical units" value={stats.units} />
            <Stat label="Mapped saleable slots" value={stats.saleable} />
          </section>

          <section className={styles.layout}>
            <article className={styles.panel}>
              <div className={styles.panelHead}><div><p className={styles.kicker}>Structure</p><h2>Master-plan hierarchy</h2></div><span>{hierarchy.assets.length} assets</span></div>
              {hierarchy.buildings.length === 0 ? <p className={styles.muted}>No hierarchy published yet. Start with a hierarchy import.</p> : (
                <div className={styles.tree}>
                  {hierarchy.phases.map((phase) => <HierarchyPhase key={phase.id} phase={phase} hierarchy={hierarchy} />)}
                  {hierarchy.buildings.filter((building) => !building.phaseId).map((building) => <BuildingRow key={building.id} building={building} hierarchy={hierarchy} />)}
                </div>
              )}
            </article>

            {canImport ? (
              <article className={styles.panel}>
                <div className={styles.panelHead}><div><p className={styles.kicker}>Controlled publication</p><h2>New import</h2></div><span>Max {MAX_ROWS.toLocaleString()} rows</span></div>
                <div className={styles.formGrid}>
                  <label>Data family<select value={importType} onChange={(event) => changeImportType(event.target.value as ProjectImportType)}><option value="HIERARCHY">Hierarchy</option><option value="UNIT_TYPES">Unit types</option><option value="PHYSICAL_UNITS">Physical units + inventory mapping</option><option value="PRICING">Pricing draft</option><option value="PAYMENT_PLANS">Payment-plan drafts</option></select></label>
                  <label>Source file<input type="file" accept=".csv,.json,.xlsx" onChange={(event) => void onFile(event)} disabled={busy} /></label>
                </div>
                <p className={styles.note}>CSV, JSON, and XLSX are parsed locally, capped at 5 MB, SHA-256 fingerprinted, then staged as structured rows. Publication never trusts the file directly.</p>

                {parsedFile ? (
                  <>
                    <div className={styles.fileMeta}><strong>{parsedFile.fileName}</strong><span>{parsedFile.sourceFormat}</span><span>{parsedFile.rows.length.toLocaleString()} rows</span><code>{parsedFile.sha256Hex.slice(0, 12)}…</code></div>
                    <div className={styles.mappingGrid}>
                      {fieldsByType[importType].map((field) => (
                        <label key={field.key}>{field.label}{field.required ? <em>required</em> : null}<select value={mapping[field.key] ?? ''} onChange={(event) => setMapping((current) => ({ ...current, [field.key]: event.target.value }))}><option value="">Not mapped</option>{parsedFile.headers.map((header) => <option key={header} value={header}>{header}</option>)}</select></label>
                      ))}
                    </div>
                    <button className={styles.primary} type="button" onClick={() => void validateFile()} disabled={busy}>{busy ? 'Validating…' : 'Stage & validate'}</button>
                  </>
                ) : null}
              </article>
            ) : null}
          </section>

          {preview ? (
            <section className={styles.panelWide}>
              <div className={styles.panelHead}>
                <div><p className={styles.kicker}>Preview</p><h2>{preview.job.sourceFileName}</h2></div>
                <div className={styles.previewCounts}><span>{preview.job.validRows} valid</span><span className={preview.job.invalidRows ? styles.badgeBad : styles.badgeGood}>{preview.job.invalidRows} invalid</span></div>
              </div>
              <div className={styles.tableWrap}><table><thead><tr><th>Row</th><th>Status</th><th>Normalized preview</th><th>Errors</th></tr></thead><tbody>{preview.rows.slice(0, 100).map((row) => <tr key={row.rowNumber}><td>{row.rowNumber}</td><td><span className={row.status === 'INVALID' ? styles.badgeBad : styles.badgeGood}>{row.status}</span></td><td><code>{compactJson(row.normalizedData ?? row.rawData)}</code></td><td>{row.errors.length ? <ul>{row.errors.map((item) => <li key={item}>{item}</li>)}</ul> : '—'}</td></tr>)}</tbody></table></div>
              {preview.rows.length > 100 ? <p className={styles.muted}>Showing first 100 of {preview.rows.length.toLocaleString()} rows.</p> : null}
              {preview.job.status === 'VALIDATED' && preview.job.invalidRows === 0 ? <button className={styles.primary} type="button" onClick={() => void publish()} disabled={busy}>{busy ? 'Publishing…' : 'Publish validated import'}</button> : null}
            </section>
          ) : null}

          {canImport ? (
            <section className={styles.panelWide}>
              <div className={styles.panelHead}><div><p className={styles.kicker}>Audit</p><h2>Import history</h2></div><span>{jobs.length} jobs</span></div>
              {jobs.length === 0 ? <p className={styles.muted}>No import jobs yet.</p> : <div className={styles.jobs}>{jobs.map((job) => <div className={styles.job} key={job.id}><div><strong>{job.sourceFileName}</strong><span>{labelType(job.importType)} · {job.sourceFormat}</span></div><div className={styles.jobCounts}><span>{job.status}</span><span>{job.validRows} valid</span><span>{job.invalidRows} invalid</span></div><div className={styles.jobActions}><button type="button" onClick={() => void openJob(job.id)} disabled={busy}>Preview</button>{job.status === 'PUBLISHED' ? <button type="button" onClick={() => void rollback(job)} disabled={busy}>Rollback</button> : null}</div></div>)}</div>}
            </section>
          ) : null}
        </>
      ) : null}
    </main>
  );
}

function Stat({ label, value }: { label: string; value: number }) { return <div className={styles.stat}><strong>{value.toLocaleString()}</strong><span>{label}</span></div>; }

function HierarchyPhase({ phase, hierarchy }: { phase: ProjectHierarchySnapshot['phases'][number]; hierarchy: ProjectHierarchySnapshot }) {
  const buildings = hierarchy.buildings.filter((building) => building.phaseId === phase.id);
  return <div className={styles.phase}><div className={styles.nodeTitle}><strong>{phase.name}</strong><span>{phase.code}</span></div>{buildings.map((building) => <BuildingRow key={building.id} building={building} hierarchy={hierarchy} />)}</div>;
}

function BuildingRow({ building, hierarchy }: { building: ProjectHierarchySnapshot['buildings'][number]; hierarchy: ProjectHierarchySnapshot }) {
  const floors = hierarchy.floors.filter((floor) => floor.buildingId === building.id);
  const units = hierarchy.physicalUnits.filter((unit) => unit.buildingId === building.id);
  return <div className={styles.building}><div className={styles.nodeTitle}><strong>{building.name}</strong><span>{building.code}{building.clusterName ? ` · ${building.clusterName}` : ''}</span></div><div className={styles.nodeMeta}><span>{floors.length} floors</span><span>{units.length} physical units</span><span>{units.filter((unit) => unit.inventoryState === 'AVAILABLE').length} available</span></div></div>;
}

function canProjectImport(project: WorkspaceProjectSnapshot): boolean {
  return project.roles.some((role) => roleHasPermission(role, 'project.import.manage'));
}

async function parseImportFile(file: File): Promise<ParsedFile> {
  if (file.size > MAX_FILE_BYTES) throw new Error('Import files are limited to 5 MB.');
  const extension = file.name.split('.').pop()?.toLowerCase();
  const buffer = await file.arrayBuffer();
  const sha256Hex = await sha256(buffer);
  let rows: Row[];
  let sourceFormat: ProjectImportSourceFormat;
  if (extension === 'csv') {
    sourceFormat = 'CSV';
    rows = parseCsv(new TextDecoder().decode(buffer));
  } else if (extension === 'json') {
    sourceFormat = 'JSON';
    const value = JSON.parse(new TextDecoder().decode(buffer)) as unknown;
    if (!Array.isArray(value) || value.some((row) => row == null || typeof row !== 'object' || Array.isArray(row))) throw new Error('JSON import must be an array of objects.');
    rows = value as Row[];
  } else if (extension === 'xlsx') {
    sourceFormat = 'XLSX';
    rows = await parseXlsx(buffer);
  } else {
    throw new Error('Use a CSV, JSON, or XLSX file.');
  }
  if (rows.length > MAX_ROWS) throw new Error(`A single import is limited to ${MAX_ROWS.toLocaleString()} rows.`);
  const headers = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  return { sourceFormat, fileName: file.name, sha256Hex, headers, rows };
}

async function parseXlsx(buffer: ArrayBuffer): Promise<Row[]> {
  const ExcelJS = await import('exceljs');
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as never);
  const sheet = workbook.worksheets[0];
  if (!sheet) return [];
  const headerRow = sheet.getRow(1);
  const headers: string[] = [];
  headerRow.eachCell({ includeEmpty: true }, (cell, colNumber) => { headers[colNumber - 1] = cellText(cell.value) || `Column ${colNumber}`; });
  const rows: Row[] = [];
  for (let rowNumber = 2; rowNumber <= Math.min(sheet.rowCount, MAX_ROWS + 1); rowNumber += 1) {
    const row = sheet.getRow(rowNumber);
    const record: Row = {};
    let hasValue = false;
    headers.forEach((header, index) => {
      const value = excelValue(row.getCell(index + 1).value);
      if (value !== null && value !== '') hasValue = true;
      record[header] = value;
    });
    if (hasValue) rows.push(record);
  }
  return rows;
}

function excelValue(value: unknown): unknown {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object' && value !== null) {
    const item = value as { result?: unknown; text?: string; richText?: Array<{ text: string }> };
    if (item.result != null) return item.result;
    if (item.text != null) return item.text;
    if (item.richText) return item.richText.map((entry) => entry.text).join('');
  }
  return value;
}

function cellText(value: unknown): string {
  const normalized = excelValue(value);
  return normalized == null ? '' : String(normalized).trim();
}

function parseCsv(text: string): Row[] {
  const matrix: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]!;
    if (char === '"') {
      if (quoted && text[index + 1] === '"') { field += '"'; index += 1; }
      else quoted = !quoted;
    } else if (char === ',' && !quoted) {
      row.push(field); field = '';
    } else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && text[index + 1] === '\n') index += 1;
      row.push(field); field = '';
      if (row.some((value) => value.trim() !== '')) matrix.push(row);
      row = [];
    } else field += char;
  }
  row.push(field);
  if (row.some((value) => value.trim() !== '')) matrix.push(row);
  if (matrix.length < 2) return [];
  const headers = matrix[0]!.map((value, index) => value.trim() || `Column ${index + 1}`);
  return matrix.slice(1).map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index]?.trim() ?? ''])));
}

function autoMap(targets: string[], headers: string[]): Record<string, string> {
  const normalized = new Map(headers.map((header) => [normalKey(header), header]));
  return Object.fromEntries(targets.map((target) => [target, normalized.get(normalKey(target)) ?? '']).filter(([, source]) => source));
}

function normalKey(value: string): string { return value.toLowerCase().replace(/[^a-z0-9]/g, ''); }
async function sha256(buffer: ArrayBuffer): Promise<string> { return [...new Uint8Array(await crypto.subtle.digest('SHA-256', buffer))].map((byte) => byte.toString(16).padStart(2, '0')).join(''); }
function compactJson(value: unknown): string { const text = JSON.stringify(value); return text.length > 220 ? `${text.slice(0, 217)}…` : text; }
function labelType(type: ProjectImportType): string { return type.toLowerCase().replace(/_/g, ' '); }
function message(reason: unknown, fallback: string): string { return reason instanceof Error ? reason.message : fallback; }
