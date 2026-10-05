'use client';

import {
  roleHasPermission,
  type WorkspaceContextSnapshot,
} from '@preneura/contracts/access';
import { useEffect, useState } from 'react';
import { apiFetch } from '../../lib/api';
import styles from './workspace-operations-shortcuts.module.css';

export default function WorkspaceOperationsShortcuts() {
  const [showAdmin, setShowAdmin] = useState(false);
  const [showAccounts, setShowAccounts] = useState(false);
  const [showRefunds, setShowRefunds] = useState(false);
  const [showDocumentPolicy, setShowDocumentPolicy] = useState(false);
  const [showDocumentTemplates, setShowDocumentTemplates] = useState(false);
  const [showCommissions, setShowCommissions] = useState(false);
  const [showReminders, setShowReminders] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void apiFetch<WorkspaceContextSnapshot>('/v1/me/workspace')
      .then((workspace) => {
        if (cancelled) return;
        setShowAdmin(workspace.assignments.some((assignment) =>
          roleHasPermission(assignment.role, 'platform.tenants.read'),
        ));
        setShowAccounts(workspace.projects.some((project) => project.roles.some((role) =>
          roleHasPermission(role, 'tenant.users.manage') || roleHasPermission(role, 'broker.users.manage'),
        )));
        setShowRefunds(workspace.projects.some((project) => project.roles.some((role) =>
          roleHasPermission(role, 'refund.read') || roleHasPermission(role, 'refund.request'),
        )));
        const canManageTemplates = workspace.projects.some((project) => project.roles.some((role) =>
          roleHasPermission(role, 'documents.templates.manage'),
        ));
        setShowDocumentPolicy(canManageTemplates);
        setShowDocumentTemplates(canManageTemplates);
        setShowCommissions(workspace.projects.some((project) => project.roles.some((role) =>
          roleHasPermission(role, 'commission.status.read'),
        )));
        setShowReminders(workspace.projects.some((project) => project.roles.some((role) =>
          roleHasPermission(role, 'notifications.manage'),
        )));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  if (!showAdmin && !showAccounts && !showRefunds && !showDocumentPolicy && !showDocumentTemplates && !showCommissions && !showReminders) return null;

  return (
    <nav className={styles.shortcuts} aria-label="Additional operations">
      {showAdmin ? <a href="/admin">Platform Admin</a> : null}
      {showAdmin ? <a href="/admin/support">Support View</a> : null}
      {showAccounts ? <a href="/workspace/accounts">Accounts</a> : null}
      {showRefunds ? <a href="/workspace/refunds">Refunds</a> : null}
      {showCommissions ? <a href="/workspace/commissions">Commissions</a> : null}
      {showReminders ? <a href="/workspace/reminders">Reminders</a> : null}
      {showDocumentPolicy ? <a href="/workspace/document-requirements">Document policy</a> : null}
      {showDocumentTemplates ? <a href="/workspace/document-templates">Templates</a> : null}
    </nav>
  );
}
