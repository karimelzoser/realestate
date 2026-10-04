import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import type { RealtimeTopic } from '@preneura/database';
import { Client, type Notification } from 'pg';
import { Subject } from 'rxjs';

export interface RealtimeDatabaseSignal {
  sequence: string;
  tenantId: string | null;
  projectId: string | null;
  topic: RealtimeTopic;
}

export interface UserNotificationDatabaseSignal {
  sequence: string;
  recipientUserId: string;
}

@Injectable()
export class RealtimeListenerService implements OnModuleInit, OnModuleDestroy {
  readonly realtime$ = new Subject<RealtimeDatabaseSignal>();
  readonly userNotifications$ = new Subject<UserNotificationDatabaseSignal>();

  private client: Client | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private reconnectAttempt = 0;
  private stopping = false;
  private connecting = false;

  async onModuleInit(): Promise<void> {
    await this.connect();
  }

  async onModuleDestroy(): Promise<void> {
    this.stopping = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    const client = this.client;
    this.client = null;
    if (client) await client.end().catch(() => undefined);
    this.realtime$.complete();
    this.userNotifications$.complete();
  }

  private async connect(): Promise<void> {
    if (this.stopping || this.connecting || this.client) return;
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error('DATABASE_URL is required');

    this.connecting = true;
    const client = new Client({
      connectionString,
      application_name: 'preneura-api-realtime-listener',
      keepAlive: true,
    });
    try {
      await client.connect();
      if (this.stopping) {
        await client.end().catch(() => undefined);
        return;
      }
      client.on('notification', (notification) => this.onNotification(notification));
      client.on('error', () => this.handleDisconnect(client));
      client.on('end', () => this.handleDisconnect(client));
      await client.query('LISTEN preneura_realtime');
      await client.query('LISTEN preneura_user_notification');
      this.client = client;
      this.reconnectAttempt = 0;
    } catch (error) {
      await client.end().catch(() => undefined);
      this.scheduleReconnect();
      if (this.reconnectAttempt === 1) throw error;
    } finally {
      this.connecting = false;
    }
  }

  private onNotification(notification: Notification): void {
    if (!notification.payload) return;
    try {
      const parsed = JSON.parse(notification.payload) as Record<string, unknown>;
      if (notification.channel === 'preneura_realtime') {
        const sequence = this.stringValue(parsed.sequence);
        const topic = this.topicValue(parsed.topic);
        if (!sequence || !topic) return;
        this.realtime$.next({
          sequence,
          tenantId: this.nullableString(parsed.tenantId),
          projectId: this.nullableString(parsed.projectId),
          topic,
        });
        return;
      }
      if (notification.channel === 'preneura_user_notification') {
        const sequence = this.stringValue(parsed.sequence);
        const recipientUserId = this.stringValue(parsed.recipientUserId);
        if (!sequence || !recipientUserId) return;
        this.userNotifications$.next({ sequence, recipientUserId });
      }
    } catch {
      // Durable replay covers malformed or missed transient notifications.
    }
  }

  private handleDisconnect(client: Client): void {
    if (this.client !== client) return;
    this.client = null;
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.stopping || this.reconnectTimer) return;
    this.reconnectAttempt += 1;
    const delay = Math.min(30_000, 500 * (2 ** Math.min(this.reconnectAttempt - 1, 6)));
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect().catch(() => undefined);
    }, delay);
  }

  private topicValue(value: unknown): RealtimeTopic | null {
    return typeof value === 'string' && [
      'CATALOG','INVENTORY','PRICING','QUEUE','TRANSACTION','COMMISSION','REFUND','DOMAIN',
    ].includes(value)
      ? value as RealtimeTopic
      : null;
  }

  private nullableString(value: unknown): string | null {
    return value === null || value === undefined ? null : this.stringValue(value);
  }

  private stringValue(value: unknown): string | null {
    if (typeof value === 'string' && value.length > 0) return value;
    if (typeof value === 'number' && Number.isSafeInteger(value)) return String(value);
    return null;
  }
}
