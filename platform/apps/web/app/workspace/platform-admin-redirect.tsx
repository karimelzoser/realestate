'use client';

import type { WorkspaceContextSnapshot } from '@preneura/contracts/access';
import { useEffect } from 'react';
import { apiFetch } from '../../lib/api';

export default function PlatformAdminRedirect() {
  useEffect(() => {
    let cancelled = false;
    void apiFetch<WorkspaceContextSnapshot>('/v1/me/workspace')
      .then((workspace) => {
        if (cancelled) return;
        const isPlatformAdmin = workspace.assignments.some((assignment) =>
          assignment.scopeType === 'PLATFORM' && assignment.role === 'PRENEURA_SUPER_ADMIN',
        );
        if (isPlatformAdmin) window.location.replace('/admin');
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, []);

  return null;
}
