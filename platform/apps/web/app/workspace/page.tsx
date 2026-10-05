import PlatformAdminRedirect from './platform-admin-redirect';
import WorkspaceClient from './workspace-client';
import WorkspaceOperationsShortcuts from './workspace-operations-shortcuts';

export default function WorkspacePage() {
  return (
    <>
      <PlatformAdminRedirect />
      <WorkspaceClient />
      <WorkspaceOperationsShortcuts />
    </>
  );
}
