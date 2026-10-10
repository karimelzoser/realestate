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
  const [showManagement, setShowManagement] = useState(false);
  const [showProjectSetup, setShowProjectSetup] = useState(false);
  const [showAccounts, setShowAccounts] = useState(false);
  const [showProperty, setShowProperty] = useState(false);
  const [showSales, setShowSales] = useState(false);
  const [showAllocation, setShowAllocation] = useState(false);
  const [showBroker, setShowBroker] = useState(false);
  const [showTransactionOps, setShowTransactionOps] = useState(false);
  const [showRefunds, setShowRefunds] = useState(false);
  const [showSettlements, setShowSettlements] = useState(false);
  const [showDocumentPolicy, setShowDocumentPolicy] = useState(false);
  const [showDocumentTemplates, setShowDocumentTemplates] = useState(false);
  const [showCommissions, setShowCommissions] = useState(false);
  const [showReminders, setShowReminders] = useState(false);
  const [showAi, setShowAi] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void apiFetch<WorkspaceContextSnapshot>('/v1/me/workspace')
      .then((workspace) => {
        if (cancelled) return;
        setShowAdmin(workspace.assignments.some((assignment) =>
          roleHasPermission(assignment.role, 'platform.tenants.read'),
        ));
        setShowManagement(workspace.projects.some((project) => project.roles.some((role) =>
          roleHasPermission(role, 'project.manage'),
        )));
        setShowProjectSetup(workspace.projects.some((project) => project.roles.some((role) =>
          roleHasPermission(role, 'project.import.manage') || roleHasPermission(role, 'project.manage'),
        )));
        setShowAccounts(workspace.projects.some((project) => project.roles.some((role) =>
          roleHasPermission(role, 'tenant.users.manage') || roleHasPermission(role, 'broker.users.manage'),
        )));
        setShowProperty(workspace.projects.some((project) => project.roles.some((role) =>
          roleHasPermission(role, 'property.read.self'),
        )));
        setShowSales(workspace.projects.some((project) => project.roles.some((role) =>
          roleHasPermission(role, 'buyers.read') || roleHasPermission(role, 'buyers.manage') || roleHasPermission(role, 'eoi.manage'),
        )));
        setShowAllocation(workspace.projects.some((project) => project.roles.some((role) =>
          roleHasPermission(role, 'queue.manage') || roleHasPermission(role, 'allocation.assist'),
        )));
        setShowBroker(workspace.projects.some((project) => project.roles.some((role) =>
          role === 'BROKER_MANAGER' || role === 'BROKER_FINANCE' || role === 'BROKER_AGENT',
        )));
        setShowTransactionOps(workspace.projects.some((project) => project.roles.some((role) =>
          roleHasPermission(role, 'transaction.manage'),
        )));
        setShowRefunds(workspace.projects.some((project) => project.roles.some((role) =>
          roleHasPermission(role, 'refund.read') || roleHasPermission(role, 'refund.request'),
        )));
        setShowSettlements(workspace.projects.some((project) => project.roles.some((role) =>
          roleHasPermission(role, 'refund.payout.manage') || roleHasPermission(role, 'commission.payment.manage'),
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
        setShowAi(workspace.projects.some((project) => project.roles.some((role) =>
          roleHasPermission(role, 'ai.buyer.use') ||
          roleHasPermission(role, 'ai.manager.use') ||
          roleHasPermission(role, 'ai.settings.manage'),
        )));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  if (!showAdmin && !showManagement && !showProjectSetup && !showAccounts && !showProperty && !showSales && !showAllocation && !showBroker && !showTransactionOps && !showRefunds && !showSettlements && !showDocumentPolicy && !showDocumentTemplates && !showCommissions && !showReminders && !showAi) return null;

  return (
    <nav className={styles.shortcuts} aria-label="Additional operations">
      {showAdmin ? <a href="/admin">Platform Admin</a> : null}
      {showAdmin ? <a href="/admin/support">Support View</a> : null}
      {showManagement ? <a href="/workspace/management">Management</a> : null}
      {showProperty ? <a href="/workspace/property">My Property</a> : null}
      {showSales ? <a href="/workspace/sales">Buyers & EOIs</a> : null}
      {showAllocation ? <a href="/workspace/allocation">Reception & Allocation</a> : null}
      {showBroker ? <a href="/workspace/broker">Broker Operations</a> : null}
      {showTransactionOps ? <a href="/workspace/transaction-operations">Transaction Operations</a> : null}
      {showProjectSetup ? <a href="/workspace/project-setup">Project Setup</a> : null}
      {showAi ? <a href="/workspace/ai">AI Workspace</a> : null}
      {showAccounts ? <a href="/workspace/accounts">Accounts</a> : null}
      {showRefunds ? <a href="/workspace/refunds">Refunds</a> : null}
      {showCommissions ? <a href="/workspace/commissions">Commissions</a> : null}
      {showSettlements ? <a href="/workspace/settlements">Settlements</a> : null}
      {showReminders ? <a href="/workspace/reminders">Reminders</a> : null}
      {showDocumentPolicy ? <a href="/workspace/document-requirements">Document policy</a> : null}
      {showDocumentTemplates ? <a href="/workspace/document-templates">Templates</a> : null}
    </nav>
  );
}
