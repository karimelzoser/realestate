'use client';

import {
  roleHasPermission,
  type WorkspaceContextSnapshot,
} from '@preneura/contracts/access';
import { useEffect, useState } from 'react';
import { apiFetch } from '../../../../lib/api';
import styles from './transaction-shortcuts.module.css';

type Props = {
  transactionId: string;
  tenantId: string;
  projectId: string;
};

export default function TransactionShortcuts({ transactionId, tenantId, projectId }: Props) {
  const [canUpload, setCanUpload] = useState(false);
  const [canOpenRefunds, setCanOpenRefunds] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void apiFetch<WorkspaceContextSnapshot>('/v1/me/workspace')
      .then((workspace) => {
        if (cancelled) return;
        const project = workspace.projects.find(
          (candidate) => candidate.tenantId === tenantId && candidate.projectId === projectId,
        );
        if (!project) return;
        setCanUpload(project.roles.some(
          (role) => roleHasPermission(role, 'documents.upload') || roleHasPermission(role, 'documents.upload.self'),
        ));
        setCanOpenRefunds(project.roles.some(
          (role) => roleHasPermission(role, 'refund.read') || roleHasPermission(role, 'refund.request'),
        ));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [projectId, tenantId]);

  if (!canUpload && !canOpenRefunds) return null;

  const uploadHref = `/workspace/transactions/${transactionId}/documents/upload?tenantId=${encodeURIComponent(tenantId)}&projectId=${encodeURIComponent(projectId)}`;
  return (
    <div className={styles.shortcuts}>
      {canOpenRefunds ? <a className={styles.secondaryShortcut} href="/workspace/refunds">EOI refunds</a> : null}
      {canUpload ? <a className={styles.primaryShortcut} href={uploadHref}>Upload document</a> : null}
    </div>
  );
}
