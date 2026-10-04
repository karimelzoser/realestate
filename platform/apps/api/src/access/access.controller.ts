import { Controller, Get, UseGuards } from '@nestjs/common';
import type { WorkspaceContextSnapshot } from '@preneura/contracts/access';
import type { ResolvedSession } from '../auth/auth.repository.js';
import { CurrentSession, SessionAuthGuard } from '../auth/session-auth.guard.js';
import { AccessService } from './access.service.js';

@UseGuards(SessionAuthGuard)
@Controller('me')
export class AccessController {
  constructor(private readonly access: AccessService) {}

  @Get('workspace')
  workspace(@CurrentSession() session: ResolvedSession): Promise<WorkspaceContextSnapshot> {
    return this.access.workspaceContext(session.userId);
  }
}
