import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { SettlementSnapshot } from '@preneura/contracts/settlements';
import type { Database } from '@preneura/database';
import { sql, type Kysely } from 'kysely';
import { DATABASE } from '../database/database.module.js';

interface SettlementContextRow {
  settlement_id: string;
  tenant_id: string;
  project_id: string;
  settlement_type: 'EOI_REFUND' | 'BROKER_COMMISSION';
  broker_company_id: string | null;
}

@Injectable()
export class SettlementRepository {
  constructor(@Inject(DATABASE) private readonly db: Kysely<Database>) {}

  async createEoiRefund(input: {
    refundRequestId: string;
    actorUserId: string;
    idempotencyKey: string;
  }): Promise<string> {
    const result = await sql<{ id: string }>`
      SELECT preneura_create_eoi_refund_settlement(
        ${input.refundRequestId}::uuid,
        ${input.actorUserId}::uuid,
        ${input.idempotencyKey},
        now()
      ) AS id
    `.execute(this.db);
    const id = result.rows[0]?.id;
    if (!id) throw new ConflictException('EOI refund settlement could not be created.');
    return id;
  }

  async createCommission(input: {
    commissionCaseId: string;
    actorUserId: string;
    idempotencyKey: string;
  }): Promise<string> {
    const result = await sql<{ id: string }>`
      SELECT preneura_create_commission_settlement(
        ${input.commissionCaseId}::uuid,
        ${input.actorUserId}::uuid,
        ${input.idempotencyKey},
        now()
      ) AS id
    `.execute(this.db);
    const id = result.rows[0]?.id;
    if (!id) throw new ConflictException('Commission settlement could not be created.');
    return id;
  }

  async context(settlementId: string): Promise<SettlementContextRow | null> {
    const result = await sql<SettlementContextRow>`
      SELECT
        id AS settlement_id,
        tenant_id,
        project_id,
        settlement_type,
        broker_company_id
      FROM settlement_disbursements
      WHERE id = ${settlementId}::uuid
    `.execute(this.db);
    return result.rows[0] ?? null;
  }

  async submit(input: {
    settlementId: string;
    actorUserId: string;
    provider: string;
    providerReference: string;
  }): Promise<void> {
    await sql`
      SELECT preneura_submit_settlement(
        ${input.settlementId}::uuid,
        ${input.actorUserId}::uuid,
        ${input.provider},
        ${input.providerReference},
        now()
      )
    `.execute(this.db);
  }

  async snapshot(settlementId: string): Promise<SettlementSnapshot> {
    const settlement = await sql<{
      settlement_id: string;
      settlement_type: 'EOI_REFUND' | 'BROKER_COMMISSION';
      status: SettlementSnapshot['status'];
      eoi_refund_request_id: string | null;
      commission_case_id: string | null;
      buyer_profile_id: string | null;
      broker_company_id: string | null;
      amount: string;
      currency: string;
      provider: string | null;
      provider_reference: string | null;
      initiated_at: Date;
      submitted_at: Date | null;
      settled_at: Date | null;
      failed_at: Date | null;
      reversed_at: Date | null;
    }>`
      SELECT
        id AS settlement_id, settlement_type, status,
        eoi_refund_request_id, commission_case_id, buyer_profile_id, broker_company_id,
        amount::text, currency, provider, provider_reference,
        initiated_at, submitted_at, settled_at, failed_at, reversed_at
      FROM settlement_disbursements
      WHERE id = ${settlementId}::uuid
    `.execute(this.db);
    const row = settlement.rows[0];
    if (!row) throw new NotFoundException('Settlement not found.');

    const events = await sql<{
      settlement_event_id: string;
      event_type: SettlementSnapshot['events'][number]['eventType'];
      provider: string | null;
      provider_event_id: string | null;
      provider_reference: string | null;
      occurred_at: Date;
    }>`
      SELECT
        id AS settlement_event_id, event_type, provider, provider_event_id,
        provider_reference, occurred_at
      FROM settlement_events
      WHERE settlement_id = ${settlementId}::uuid
      ORDER BY occurred_at, id
    `.execute(this.db);

    return {
      settlementId: row.settlement_id,
      settlementType: row.settlement_type,
      status: row.status,
      eoiRefundRequestId: row.eoi_refund_request_id,
      commissionCaseId: row.commission_case_id,
      buyerProfileId: row.buyer_profile_id,
      brokerCompanyId: row.broker_company_id,
      amount: row.amount,
      currency: row.currency,
      provider: row.provider,
      providerReference: row.provider_reference,
      initiatedAt: row.initiated_at.toISOString(),
      submittedAt: row.submitted_at?.toISOString() ?? null,
      settledAt: row.settled_at?.toISOString() ?? null,
      failedAt: row.failed_at?.toISOString() ?? null,
      reversedAt: row.reversed_at?.toISOString() ?? null,
      events: events.rows.map((event) => ({
        settlementEventId: event.settlement_event_id,
        eventType: event.event_type,
        provider: event.provider,
        providerEventId: event.provider_event_id,
        providerReference: event.provider_reference,
        occurredAt: event.occurred_at.toISOString(),
      })),
    };
  }

  async ingestProvider(input: {
    provider: string;
    providerEventId: string;
    contentHashHex: string;
    settlementId: string;
    eventType: 'SETTLED' | 'FAILED' | 'REVERSED';
    providerReference: string | null;
    occurredAt: Date;
  }): Promise<SettlementSnapshot> {
    return this.db.transaction().execute(async (trx) => {
      await sql`
        INSERT INTO settlement_provider_events (
          provider, provider_event_id, content_hash, settlement_id, event_type,
          provider_reference, occurred_at, received_at
        ) VALUES (
          ${input.provider}, ${input.providerEventId}, decode(${input.contentHashHex}, 'hex'),
          ${input.settlementId}::uuid, ${input.eventType}, ${input.providerReference},
          ${input.occurredAt}, now()
        )
        ON CONFLICT (provider, provider_event_id) DO NOTHING
      `.execute(trx);

      const inbox = await sql<{
        content_hash_hex: string;
        settlement_id: string;
        event_type: 'SETTLED' | 'FAILED' | 'REVERSED';
        provider_reference: string | null;
        occurred_at: Date;
        processed_at: Date | null;
      }>`
        SELECT encode(content_hash, 'hex') AS content_hash_hex,
               settlement_id, event_type, provider_reference, occurred_at, processed_at
        FROM settlement_provider_events
        WHERE provider = ${input.provider}
          AND provider_event_id = ${input.providerEventId}
        FOR UPDATE
      `.execute(trx);
      const stored = inbox.rows[0];
      if (!stored) throw new ConflictException('Settlement provider event could not be persisted.');
      if (stored.content_hash_hex !== input.contentHashHex) {
        throw new ConflictException('Provider event ID was reused with different settlement content.');
      }

      if (!stored.processed_at) {
        await sql`
          SELECT preneura_apply_settlement_outcome(
            ${stored.settlement_id}::uuid,
            ${stored.event_type},
            NULL::uuid,
            ${input.provider},
            ${input.providerEventId},
            ${stored.provider_reference},
            ${stored.occurred_at},
            '{}'::jsonb
          )
        `.execute(trx);
        await sql`
          UPDATE settlement_provider_events
          SET processed_at = now()
          WHERE provider = ${input.provider}
            AND provider_event_id = ${input.providerEventId}
        `.execute(trx);
      }

      return this.snapshotIn(trx, stored.settlement_id);
    });
  }

  private async snapshotIn(executor: Kysely<Database>, settlementId: string): Promise<SettlementSnapshot> {
    const result = await sql<{ id: string }>`SELECT ${settlementId}::uuid AS id`.execute(executor);
    const id = result.rows[0]?.id;
    if (!id) throw new NotFoundException('Settlement not found.');
    // The provider transaction has already serialized this settlement event. Read after commit-equivalent state
    // using the same underlying database connection through the public snapshot query.
    return this.snapshot(id);
  }
}
