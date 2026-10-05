'use client';

import { roleHasPermission, type WorkspaceContextSnapshot, type WorkspaceProjectSnapshot } from '@preneura/contracts/access';
import type { ProjectHierarchySnapshot, ProjectMasterPlanAssetType } from '@preneura/contracts/project-catalog';
import { useEffect, useMemo, useState, type ChangeEvent } from 'react';
import { apiFetch } from '../../../lib/api';
import styles from './project-asset-upload.module.css';

type UploadIntent = {
  objectKey: string;
  uploadUrl: string;
  expiresAt: string;
  requiredHeaders: Record<string, string>;
};

const MAX_ASSET_BYTES = 100 * 1024 * 1024;

export default function ProjectAssetUploadPanel() {
  const [workspace, setWorkspace] = useState<WorkspaceContextSnapshot | null>(null);
  const [projectId, setProjectId] = useState('');
  const [hierarchy, setHierarchy] = useState<ProjectHierarchySnapshot | null>(null);
  const [assetType, setAssetType] = useState<ProjectMasterPlanAssetType>('MASTER_PLAN_IMAGE');
  const [label, setLabel] = useState('');
  const [phaseId, setPhaseId] = useState('');
  const [buildingId, setBuildingId] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');

  const projects = useMemo(
    () => workspace?.projects.filter((project) => project.roles.some((role) => roleHasPermission(role, 'project.manage'))) ?? [],
    [workspace],
  );
  const project = useMemo(() => projects.find((item) => item.projectId === projectId) ?? null, [projects, projectId]);
  const buildings = useMemo(() => hierarchy?.buildings.filter((item) => !phaseId || item.phaseId === phaseId) ?? [], [hierarchy, phaseId]);

  useEffect(() => {
    let cancelled = false;
    void apiFetch<WorkspaceContextSnapshot>('/v1/me/workspace').then((context) => {
      if (cancelled) return;
      const allowed = context.projects.filter((item) => item.roles.some((role) => roleHasPermission(role, 'project.manage')));
      setWorkspace(context);
      const stored = window.localStorage.getItem('preneura:selected-project');
      setProjectId((allowed.find((item) => item.projectId === stored) ?? allowed[0])?.projectId ?? '');
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!project) { setHierarchy(null); return; }
    let cancelled = false;
    void apiFetch<ProjectHierarchySnapshot>(`/v1/tenants/${project.tenantId}/projects/${project.projectId}/project-catalog`)
      .then((value) => { if (!cancelled) setHierarchy(value); })
      .catch(() => { if (!cancelled) setHierarchy(null); });
    return () => { cancelled = true; };
  }, [project]);

  function chooseBuilding(nextBuildingId: string): void {
    setBuildingId(nextBuildingId);
    const building = hierarchy?.buildings.find((item) => item.id === nextBuildingId);
    if (building?.phaseId) setPhaseId(building.phaseId);
  }

  function chooseFile(event: ChangeEvent<HTMLInputElement>): void {
    const selected = event.target.files?.[0] ?? null;
    setError('');
    setStatus('');
    if (selected && selected.size > MAX_ASSET_BYTES) {
      setFile(null);
      setError('Master-plan assets are limited to 100 MB.');
      return;
    }
    setFile(selected);
    if (selected && !label) setLabel(selected.name.replace(/\.[^.]+$/, ''));
  }

  async function upload(): Promise<void> {
    if (!project || !file || !label.trim() || busy) return;
    setBusy(true);
    setError('');
    setStatus('Hashing file…');
    try {
      const buffer = await file.arrayBuffer();
      const sha256Base64 = await digestBase64(buffer);
      const contentType = assetContentType(file);
      const common = {
        assetType,
        label: label.trim(),
        phaseId: phaseId || null,
        buildingId: buildingId || null,
        contentType,
        byteSize: file.size,
        sha256Base64,
        metadata: { originalFilename: file.name },
      };
      setStatus('Creating secure upload intent…');
      const intent = await apiFetch<UploadIntent>(
        `/v1/tenants/${project.tenantId}/projects/${project.projectId}/project-catalog/assets/upload-intent`,
        { method: 'POST', body: JSON.stringify(common) },
      );
      setStatus('Uploading asset…');
      const response = await fetch(intent.uploadUrl, {
        method: 'PUT',
        headers: intent.requiredHeaders,
        body: file,
      });
      if (!response.ok) throw new Error(`Object storage upload failed (${response.status}).`);
      setStatus('Verifying checksum and registering asset…');
      await apiFetch(
        `/v1/tenants/${project.tenantId}/projects/${project.projectId}/project-catalog/assets/finalize`,
        { method: 'POST', body: JSON.stringify({ ...common, objectKey: intent.objectKey }) },
      );
      const refreshed = await apiFetch<ProjectHierarchySnapshot>(`/v1/tenants/${project.tenantId}/projects/${project.projectId}/project-catalog`);
      setHierarchy(refreshed);
      setFile(null);
      setLabel('');
      setStatus('Asset uploaded, verified and registered.');
    } catch (reason: unknown) {
      setStatus('');
      setError(reason instanceof Error ? reason.message : 'Asset upload failed.');
    } finally {
      setBusy(false);
    }
  }

  if (projects.length === 0) return null;

  return (
    <section className={styles.shell}>
      <div className={styles.panel}>
        <div className={styles.head}>
          <div><p>MASTER PLAN ASSETS</p><h2>Upload plans, models & visual assets</h2></div>
          <span>{hierarchy?.assets.length ?? 0} active assets</span>
        </div>
        <p className={styles.explainer}>Files upload directly to project-scoped object storage using a short-lived signed request. PRENEURA verifies byte size, MIME type and SHA-256 before the asset is trusted.</p>
        <div className={styles.grid}>
          <label>Project<select value={projectId} onChange={(event) => setProjectId(event.target.value)}>{projects.map((item) => <option key={item.projectId} value={item.projectId}>{item.projectName}</option>)}</select></label>
          <label>Asset type<select value={assetType} onChange={(event) => setAssetType(event.target.value as ProjectMasterPlanAssetType)}><option value="MASTER_PLAN_IMAGE">Master plan image</option><option value="MASTER_PLAN_3D">Master plan 3D</option><option value="BUILDING_MODEL">Building model</option><option value="FLOOR_PLAN">Floor plan</option><option value="UNIT_MODEL">Unit model</option><option value="OTHER">Other</option></select></label>
          <label>Label<input value={label} onChange={(event) => setLabel(event.target.value)} placeholder="e.g. Phase 1 master plan" /></label>
          <label>Phase<select value={phaseId} onChange={(event) => { setPhaseId(event.target.value); setBuildingId(''); }}><option value="">Whole project / not scoped</option>{hierarchy?.phases.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <label>Building<select value={buildingId} onChange={(event) => chooseBuilding(event.target.value)}><option value="">Not building-specific</option>{buildings.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <label>File<input type="file" accept=".jpg,.jpeg,.png,.webp,.pdf,.glb,.gltf" onChange={chooseFile} disabled={busy} /></label>
        </div>
        <div className={styles.actions}>
          <button type="button" onClick={() => void upload()} disabled={busy || !file || !label.trim()}>{busy ? 'Working…' : 'Secure upload'}</button>
          {file ? <span>{file.name} · {(file.size / 1024 / 1024).toFixed(1)} MB</span> : null}
        </div>
        {status ? <div className={styles.success}>{status}</div> : null}
        {error ? <div className={styles.error}>{error}</div> : null}
        {hierarchy?.assets.length ? <div className={styles.assets}>{hierarchy.assets.slice(0, 8).map((asset) => <div key={asset.id}><strong>{asset.label}</strong><span>{asset.assetType.replace(/_/g, ' ')}</span><code>{asset.sha256Hex.slice(0, 12)}…</code></div>)}</div> : null}
      </div>
    </section>
  );
}

function assetContentType(file: File): string {
  if (file.type) return file.type;
  const extension = file.name.split('.').pop()?.toLowerCase();
  if (extension === 'glb') return 'model/gltf-binary';
  if (extension === 'gltf') return 'model/gltf+json';
  if (extension === 'pdf') return 'application/pdf';
  if (extension === 'png') return 'image/png';
  if (extension === 'webp') return 'image/webp';
  if (extension === 'jpg' || extension === 'jpeg') return 'image/jpeg';
  return 'application/octet-stream';
}

async function digestBase64(buffer: ArrayBuffer): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', buffer));
  let binary = '';
  digest.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary);
}
