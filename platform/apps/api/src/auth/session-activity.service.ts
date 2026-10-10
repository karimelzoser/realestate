import { Inject, Injectable } from '@nestjs/common';
import type { Database } from '@preneura/database';
import type { Kysely } from 'kysely';
import { DATABASE } from '../database/database.module.js';

@Injectable()
export class SessionActivityService {
  constructor(@Inject(DATABASE) private readonly db: Kysely<Database>) {}

  async isActive(input: {
    sessionId: string;
    userId: string;
    now?: Date;
  }): Promise<boolean> {
    const now = input.now ?? new Date();
    const row = await this.db
      .selectFrom('auth_sessions as session')
      .innerJoin('users as user', 'user.id', 'session.user_id')
      .select('session.id')
      .where('session.id', '=', input.sessionId)
      .where('session.user_id', '=', input.userId)
      .where('session.revoked_at', 'is', null)
      .where('session.expires_at', '>', now)
      .where('user.status', '=', 'ACTIVE')
      .executeTakeFirst();
    return Boolean(row);
  }
}
