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
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [projectId, tenantId]);

  if (!canUpload) return null;

  const href = `/workspace/transactions/${transactionId}/documents/upload?tenantId=${encodeURIComponent(tenantId)}&projectId=${encodeURIComponent(projectId)}`;
  return <a className={styles.uploadShortcut} href={href}>Upload document</a>;
}
