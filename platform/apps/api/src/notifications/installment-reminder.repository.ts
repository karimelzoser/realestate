import { Inject, Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import type { Database } from '@preneura/database';
import type {
  InstallmentReminderPolicySnapshot,
  UpsertInstallmentReminderPolicyInput,
} from '@preneura/contracts/notifications';
import { DATABASE } from '../database/database.module.js';

interface PolicyRow {
  id: string;
  item_type: UpsertInstallmentReminderPolicyInput['itemType'];
  audience: UpsertInstallmentReminderPolicyInput['audience'];
  channel: UpsertInstallmentReminderPolicyInput['channel'];
  reminder_hours_before: number;
  template_code: string;
  locale: string;
  enabled: boolean;
  updated_at: Date;
}

@Injectable()
export class InstallmentReminderRepository {
  constructor(@Inject(DATABASE) private readonly db: Kysely<Database>) {}

  async list(input: {
    tenantId: string;
    projectId: string;
  }): Promise<InstallmentReminderPolicySnapshot[]> {
    const result = await sql<PolicyRow>`
      SELECT
        id,
        item_type,
        audience,
        channel,
        reminder_hours_before,
        template_code,
        locale,
        enabled,
        updated_at
      FROM project_installment_reminder_policies
      WHERE tenant_id = ${input.tenantId}::uuid
        AND project_id = ${input.projectId}::uuid
      ORDER BY item_type, audience, channel
    `.execute(this.db);

    return result.rows.map((row) => this.snapshot(row));
  }

  async upsert(input: {
    actorUserId: string;
    data: UpsertInstallmentReminderPolicyInput;
    now: Date;
  }): Promise<InstallmentReminderPolicySnapshot> {
    return this.db.transaction().execute(async (trx) => {
      const result = await sql<PolicyRow>`
        INSERT INTO project_installment_reminder_policies (
          tenant_id,
          project_id,
          item_type,
          audience,
          channel,
          reminder_hours_before,
          template_code,
          locale,
          enabled,
          updated_at
        ) VALUES (
          ${input.data.tenantId}::uuid,
          ${input.data.projectId}::uuid,
          ${input.data.itemType},
          ${input.data.audience},
          ${input.data.channel},
          ${input.data.reminderHoursBefore},
          ${input.data.templateCode},
          ${input.data.locale},
          ${input.data.enabled},
          ${input.now}
        )
        ON CONFLICT (project_id, item_type, audience, channel)
        DO UPDATE SET
          reminder_hours_before = EXCLUDED.reminder_hours_before,
          template_code = EXCLUDED.template_code,
          locale = EXCLUDED.locale,
          enabled = EXCLUDED.enabled,
          updated_at = EXCLUDED.updated_at
        RETURNING
          id,
          item_type,
          audience,
          channel,
          reminder_hours_before,
          template_code,
          locale,
          enabled,
          updated_at
      `.execute(trx);
      const row = result.rows[0];
      if (!row) throw new Error('Installment reminder policy upsert did not return a row.');

      await trx.insertInto('domain_outbox_events').values({
        tenant_id: input.data.tenantId,
        project_id: input.data.projectId,
        aggregate_type: 'INSTALLMENT_REMINDER_POLICY',
        aggregate_id: row.id,
        event_type: 'notifications.installment_policy.upserted',
        payload: {
          itemType: input.data.itemType,
          audience: input.data.audience,
          channel: input.data.channel,
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

  private snapshot(row: PolicyRow): InstallmentReminderPolicySnapshot {
    return {
      policyId: row.id,
      itemType: row.item_type,
      audience: row.audience,
      channel: row.channel,
      reminderHoursBefore: row.reminder_hours_before,
      templateCode: row.template_code,
      locale: row.locale,
      enabled: row.enabled,
      updatedAt: (row.updated_at as Date).toISOString(),
    };
  }
}
