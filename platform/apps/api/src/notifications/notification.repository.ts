import { Inject, Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import type { Database, JsonValue } from '@preneura/database';
import type {
  MilestoneSlaSnapshot,
  UpsertMilestoneSlaInput,
  UserNotificationSnapshot,
} from '@preneura/contracts/notifications';
import { DATABASE } from '../database/database.module.js';

@Injectable()
export class NotificationRepository {
  constructor(@Inject(DATABASE) private readonly db: Kysely<Database>) {}

  async upsertMilestoneSla(input: UpsertMilestoneSlaInput): Promise<void> {
    await this.db
      .insertInto('project_milestone_slas')
      .values({
        tenant_id: input.tenantId,
        project_id: input.projectId,
        milestone_code: input.milestoneCode,
        target_hours_after_open: input.targetHoursAfterOpen,
        reminder_hours_before: input.reminderHoursBefore,
        audience: input.audience,
        channel: input.channel,
        template_code: input.templateCode,
        enabled: input.enabled,
      })
      .onConflict((oc) => oc.columns(['project_id', 'milestone_code']).doUpdateSet({
        target_hours_after_open: input.targetHoursAfterOpen,
        reminder_hours_before: input.reminderHoursBefore,
        audience: input.audience,
        channel: input.channel,
        template_code: input.templateCode,
        enabled: input.enabled,
        updated_at: new Date(),
      }))
      .execute();
  }

  async listMilestoneSlas(input: {
    tenantId: string;
    projectId: string;
  }): Promise<MilestoneSlaSnapshot[]> {
    const rows = await this.db
      .selectFrom('project_milestone_slas')
      .select([
        'milestone_code', 'target_hours_after_open', 'reminder_hours_before',
        'audience', 'channel', 'template_code', 'enabled',
      ])
      .where('tenant_id', '=', input.tenantId)
      .where('project_id', '=', input.projectId)
      .orderBy('milestone_code', 'asc')
      .execute();
    return rows.map((row) => ({
      milestoneCode: row.milestone_code,
      targetHoursAfterOpen: row.target_hours_after_open,
      reminderHoursBefore: row.reminder_hours_before,
      audience: row.audience,
      channel: row.channel,
      templateCode: row.template_code,
      enabled: row.enabled,
    }));
  }

  async latestUserSequence(userId: string): Promise<string | null> {
    const row = await this.db
      .selectFrom('user_notifications')
      .select(sql<string | null>`max(sequence)::text`.as('latest'))
      .where('recipient_user_id', '=', userId)
      .executeTakeFirst();
    return row?.latest ?? null;
  }

  async listUserNotifications(input: {
    userId: string;
    afterSequence: string;
    throughSequence?: string | null;
    limit?: number;
  }): Promise<UserNotificationSnapshot[]> {
    let query = this.db
      .selectFrom('user_notifications')
      .select([
        'id',
        sql<string>`sequence::text`.as('sequence_text'),
        'tenant_id', 'project_id', 'template_code', 'locale', 'payload', 'created_at', 'read_at',
      ])
      .where('recipient_user_id', '=', input.userId)
      .where(sql<boolean>`sequence > ${input.afterSequence}::bigint`);
    if (input.throughSequence) {
      query = query.where(sql<boolean>`sequence <= ${input.throughSequence}::bigint`);
    }
    const rows = await query
      .orderBy('sequence', 'asc')
      .limit(input.limit ?? 100)
      .execute();
    return rows.map((row) => this.notification(row));
  }

  async getUserNotificationBySequence(input: {
    userId: string;
    sequence: string;
  }): Promise<UserNotificationSnapshot | null> {
    const row = await this.db
      .selectFrom('user_notifications')
      .select([
        'id',
        sql<string>`sequence::text`.as('sequence_text'),
        'tenant_id', 'project_id', 'template_code', 'locale', 'payload', 'created_at', 'read_at',
      ])
      .where('recipient_user_id', '=', input.userId)
      .where(sql<boolean>`sequence = ${input.sequence}::bigint`)
      .executeTakeFirst();
    return row ? this.notification(row) : null;
  }

  async markRead(input: { userId: string; notificationId: string; now: Date }): Promise<boolean> {
    const result = await this.db
      .updateTable('user_notifications')
      .set({ read_at: input.now })
      .where('id', '=', input.notificationId)
      .where('recipient_user_id', '=', input.userId)
      .where('read_at', 'is', null)
      .executeTakeFirst();
    return Number(result.numUpdatedRows) > 0;
  }

  private notification(row: {
    id: string;
    sequence_text: string;
    tenant_id: string;
    project_id: string | null;
    template_code: string;
    locale: string;
    payload: JsonValue;
    created_at: Date;
    read_at: Date | null;
  }): UserNotificationSnapshot {
    return {
      notificationId: row.id,
      sequence: row.sequence_text,
      tenantId: row.tenant_id,
      projectId: row.project_id,
      templateCode: row.template_code,
      locale: row.locale,
      payload: this.objectPayload(row.payload),
      createdAt: (row.created_at as Date).toISOString(),
      readAt: row.read_at ? (row.read_at as Date).toISOString() : null,
    };
  }

  private objectPayload(payload: JsonValue): Record<string, unknown> {
    return payload !== null && typeof payload === 'object' && !Array.isArray(payload)
      ? payload as Record<string, unknown>
      : { value: payload };
  }
}
