'use client';

import {
  roleHasPermission,
  type WorkspaceContextSnapshot,
} from '@preneura/contracts/access';
import { useEffect, useState } from 'react';
import { apiFetch } from '../../lib/api';
import styles from './workspace-operations-shortcuts.module.css';

export default function WorkspaceOperationsShortcuts() {
  const [showRefunds, setShowRefunds] = useState(false);
  const [showDocumentPolicy, setShowDocumentPolicy] = useState(false);
  const [showDocumentTemplates, setShowDocumentTemplates] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void apiFetch<WorkspaceContextSnapshot>('/v1/me/workspace')
      .then((workspace) => {
        if (cancelled) return;
        setShowRefunds(workspace.projects.some((project) => project.roles.some((role) =>
          roleHasPermission(role, 'refund.read') || roleHasPermission(role, 'refund.request'),
        )));
        const canManageTemplates = workspace.projects.some((project) => project.roles.some((role) =>
          roleHasPermission(role, 'documents.templates.manage'),
        ));
        setShowDocumentPolicy(canManageTemplates);
        setShowDocumentTemplates(canManageTemplates);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  if (!showRefunds && !showDocumentPolicy && !showDocumentTemplates) return null;

  return (
    <nav className={styles.shortcuts} aria-label="Additional operations">
      {showRefunds ? <a href="/workspace/refunds">Refunds</a> : null}
      {showDocumentPolicy ? <a href="/workspace/document-requirements">Document policy</a> : null}
      {showDocumentTemplates ? <a href="/workspace/document-templates">Templates</a> : null}
    </nav>
  );
}
