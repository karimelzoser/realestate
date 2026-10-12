import { Inject, Injectable } from '@nestjs/common';
import type { Database } from '@preneura/database';
import type { Kysely } from 'kysely';
import { DATABASE } from '../database/database.module.js';
import { PostgresAuthRepository } from './auth.repository.js';

@Injectable()
export class SessionActivityService {
  private readonly auth: PostgresAuthRepository;

  constructor(@Inject(DATABASE) private readonly db: Kysely<Database>) {
    this.auth = new PostgresAuthRepository(db);
  }

  async isActive(input: {
    sessionId: string;
    userId: string;
    now?: Date;
  }): Promise<boolean> {
    const now = input.now ?? new Date();
    const row = await this.db
      .selectFrom('auth_sessions as session')
      .innerJoin('users as user', 'user.id', 'session.user_id')
      .leftJoin('auth_session_assurance as assurance', 'assurance.session_id', 'session.id')
      .select(['session.id', 'assurance.assurance_level'])
      .where('session.id', '=', input.sessionId)
      .where('session.user_id', '=', input.userId)
      .where('session.revoked_at', 'is', null)
      .where('session.expires_at', '>', now)
      .where('user.status', '=', 'ACTIVE')
      .executeTakeFirst();
    if (!row) return false;
    // Match the HTTP guard when a privileged role is added while an AAL1
    // connection is already open. Active-session checks alone miss escalation.
    return row.assurance_level === 'AAL2' || !await this.auth.userRequiresPrivilegedAssurance(input.userId);
  }
}
