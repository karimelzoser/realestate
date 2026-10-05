import { Inject, Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import type { Database } from '@preneura/database';
import type {
  MilestoneReminderPolicySnapshot,
  UpsertMilestoneReminderPolicyInput,
} from '@preneura/contracts/notifications';
import { DATABASE } from '../database/database.module.js';

interface PolicyRow {
  id: string;
  milestone_code: UpsertMilestoneReminderPolicyInput['milestoneCode'];
  target_hours_after_open: number;
  reminder_hours_before: number;
  audience: UpsertMilestoneReminderPolicyInput['audience'];
  channel: UpsertMilestoneReminderPolicyInput['channel'];
  template_code: string;
  locale: string;
  enabled: boolean;
  updated_at: Date;
}

@Injectable()
export class MilestoneReminderRepository {
  constructor(@Inject(DATABASE) private readonly db: Kysely<Database>) {}

  async list(input: {
    tenantId: string;
    projectId: string;
  }): Promise<MilestoneReminderPolicySnapshot[]> {
    const result = await sql<PolicyRow>`
      SELECT
        id,
        milestone_code,
        target_hours_after_open,
        reminder_hours_before,
        audience,
        channel,
        template_code,
        locale,
        enabled,
        updated_at
      FROM project_milestone_reminder_policies
      WHERE tenant_id = ${input.tenantId}::uuid
        AND project_id = ${input.projectId}::uuid
      ORDER BY milestone_code, audience, channel
    `.execute(this.db);
    return result.rows.map((row) => this.snapshot(row));
  }

  async upsert(input: {
    actorUserId: string;
    data: UpsertMilestoneReminderPolicyInput;
    now: Date;
  }): Promise<MilestoneReminderPolicySnapshot> {
    return this.db.transaction().execute(async (trx) => {
      const result = await sql<PolicyRow>`
        INSERT INTO project_milestone_reminder_policies (
          tenant_id,
          project_id,
          milestone_code,
          target_hours_after_open,
          reminder_hours_before,
          audience,
          channel,
          template_code,
          locale,
          enabled,
          updated_at
        ) VALUES (
          ${input.data.tenantId}::uuid,
          ${input.data.projectId}::uuid,
          ${input.data.milestoneCode},
          ${input.data.targetHoursAfterOpen},
          ${input.data.reminderHoursBefore},
          ${input.data.audience},
          ${input.data.channel},
          ${input.data.templateCode},
          ${input.data.locale},
          ${input.data.enabled},
          ${input.now}
        )
        ON CONFLICT (project_id, milestone_code, audience, channel)
        DO UPDATE SET
          target_hours_after_open = EXCLUDED.target_hours_after_open,
          reminder_hours_before = EXCLUDED.reminder_hours_before,
          template_code = EXCLUDED.template_code,
          locale = EXCLUDED.locale,
          enabled = EXCLUDED.enabled,
          updated_at = EXCLUDED.updated_at
        RETURNING
          id,
          milestone_code,
          target_hours_after_open,
          reminder_hours_before,
          audience,
          channel,
          template_code,
          locale,
          enabled,
          updated_at
      `.execute(trx);
      const row = result.rows[0];
      if (!row) throw new Error('Milestone reminder policy upsert did not return a row.');

      await trx.insertInto('domain_outbox_events').values({
        tenant_id: input.data.tenantId,
        project_id: input.data.projectId,
        aggregate_type: 'MILESTONE_REMINDER_POLICY',
        aggregate_id: row.id,
        event_type: 'notifications.milestone_policy.upserted',
        payload: {
          milestoneCode: input.data.milestoneCode,
          audience: input.data.audience,
          channel: input.data.channel,
          targetHoursAfterOpen: input.data.targetHoursAfterOpen,
          reminderHoursBefore: input.data.reminderHoursBefore,
          enabled: input.data.enabled,
          actorUserId: input.actorUserId,
        },
        published_at: null,
        attempts: 0,
      }).execute();

      return this.snapshot(row);
    });
  }

  private snapshot(row: PolicyRow): MilestoneReminderPolicySnapshot {
    return {
      policyId: row.id,
      milestoneCode: row.milestone_code,
      targetHoursAfterOpen: row.target_hours_after_open,
      reminderHoursBefore: row.reminder_hours_before,
      audience: row.audience,
      channel: row.channel,
      templateCode: row.template_code,
      locale: row.locale,
      enabled: row.enabled,
      updatedAt: (row.updated_at as Date).toISOString(),
    };
  }
}
