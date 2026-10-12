import { Injectable, NotFoundException, type MessageEvent } from '@nestjs/common';
import type {
  MilestoneSlaSnapshot,
  UpsertMilestoneSlaInput,
  UserNotificationSnapshot,
} from '@preneura/contracts/notifications';
import { Observable } from 'rxjs';
import { AccessService } from '../access/access.service.js';
import { SessionActivityService } from '../auth/session-activity.service.js';
import { RealtimeListenerService } from '../realtime/realtime-listener.service.js';
import { NotificationRepository } from './notification.repository.js';

const REPLAY_BATCH = 200;
const MAX_REPLAY_EVENTS = 2_000;
const HEARTBEAT_MS = 20_000;
const DEFAULT_AUTH_REVALIDATE_MS = 5_000;

@Injectable()
export class NotificationService {
  constructor(
    private readonly repository: NotificationRepository,
    private readonly access: AccessService,
    private readonly listener: RealtimeListenerService,
    private readonly sessions: SessionActivityService,
  ) {}

  async upsertMilestoneSla(input: {
    actorUserId: string;
    data: UpsertMilestoneSlaInput;
  }): Promise<{ saved: true }> {
    await this.access.assert({
      userId: input.actorUserId,
      permission: 'notifications.manage',
      context: { tenantId: input.data.tenantId, projectId: input.data.projectId },
    });
    await this.repository.upsertMilestoneSla(input.data);
    return { saved: true };
  }

  async listMilestoneSlas(input: {
    actorUserId: string;
    tenantId: string;
    projectId: string;
  }): Promise<MilestoneSlaSnapshot[]> {
    await this.access.assert({
      userId: input.actorUserId,
      permission: 'notifications.manage',
      context: { tenantId: input.tenantId, projectId: input.projectId },
    });
    return this.repository.listMilestoneSlas(input);
  }

  async listUserNotifications(input: {
    userId: string;
    afterSequence: string;
    limit: number;
  }): Promise<UserNotificationSnapshot[]> {
    return this.repository.listUserNotifications({
      userId: input.userId,
      afterSequence: this.cursor(input.afterSequence),
      limit: Math.min(Math.max(input.limit, 1), 200),
    });
  }

  async markRead(input: {
    userId: string;
    notificationId: string;
  }): Promise<{ read: true }> {
    const updated = await this.repository.markRead({
      userId: input.userId,
      notificationId: input.notificationId,
      now: new Date(),
    });
    if (!updated) throw new NotFoundException('Notification not found.');
    return { read: true };
  }

  streamUserNotifications(input: {
    sessionId: string;
    userId: string;
    afterSequence: string;
  }): Observable<MessageEvent> {
    const initialCursor = this.cursor(input.afterSequence);
    return new Observable<MessageEvent>((subscriber) => {
      let closed = false;
      let ready = false;
      let lastSequence = initialCursor;
      let liveChain = Promise.resolve();
      let validationPromise: Promise<boolean> | null = null;
      let lastValidatedAt = 0;
      const buffered = new Set<string>();
      const revalidateMs = this.authRevalidateMs();

      const ensureAuthorized = async (force = false): Promise<boolean> => {
        if (closed) return false;
        if (!force && Date.now() - lastValidatedAt < revalidateMs) return true;
        if (!validationPromise) {
          validationPromise = this.sessions.isActive({
            sessionId: input.sessionId,
            userId: input.userId,
          }).then((allowed) => {
            if (allowed) lastValidatedAt = Date.now();
            return allowed;
          }).finally(() => {
            validationPromise = null;
          });
        }
        return validationPromise;
      };

      const revoke = (): void => {
        if (closed) return;
        subscriber.next({
          type: 'access_revoked',
          data: { at: new Date().toISOString(), cursor: lastSequence },
        });
        subscriber.complete();
      };

      const pushLive = (sequence: string): void => {
        if (closed || !this.cursorIsValid(sequence)) return;
        if (!ready) {
          buffered.add(sequence);
          return;
        }
        liveChain = liveChain.then(async () => {
          if (closed || !this.after(sequence, lastSequence)) return;
          if (!await ensureAuthorized()) {
            revoke();
            return;
          }
          const notification = await this.repository.getUserNotificationBySequence({
            userId: input.userId,
            sequence,
          });
          if (!notification || closed || !this.after(notification.sequence, lastSequence)) return;
          subscriber.next(this.message(notification));
          lastSequence = notification.sequence;
        }).catch((error) => {
          if (!closed) subscriber.error(error);
        });
      };

      const liveSubscription = this.listener.userNotifications$.subscribe((signal) => {
        if (signal.recipientUserId === input.userId) pushLive(signal.sequence);
      });
      const heartbeat = setInterval(() => {
        if (!closed) {
          subscriber.next({
            type: 'heartbeat',
            data: { at: new Date().toISOString(), cursor: lastSequence },
          });
        }
      }, HEARTBEAT_MS);
      const authorizationTimer = setInterval(() => {
        void ensureAuthorized(true)
          .then((allowed) => {
            if (!allowed) revoke();
          })
          .catch((error) => {
            if (!closed) subscriber.error(error);
          });
      }, revalidateMs);

      void (async () => {
        try {
          if (!await ensureAuthorized(true)) {
            revoke();
            return;
          }
          const watermark = await this.repository.latestUserSequence(input.userId);
          let replayed = 0;
          if (watermark && this.after(watermark, lastSequence)) {
            while (!closed && this.after(watermark, lastSequence)) {
              if (!await ensureAuthorized(true)) {
                revoke();
                return;
              }
              const remaining = MAX_REPLAY_EVENTS - replayed;
              if (remaining <= 0) {
                subscriber.next({
                  type: 'resync_required',
                  data: { cursor: lastSequence, latestSequence: watermark },
                });
                lastSequence = watermark;
                break;
              }
              const page = await this.repository.listUserNotifications({
                userId: input.userId,
                afterSequence: lastSequence,
                throughSequence: watermark,
                limit: Math.min(REPLAY_BATCH, remaining),
              });
              if (page.length === 0) break;
              for (const notification of page) {
                if (closed) return;
                if (!this.after(notification.sequence, lastSequence)) continue;
                subscriber.next(this.message(notification));
                lastSequence = notification.sequence;
                replayed += 1;
              }
              if (page.length < REPLAY_BATCH) break;
            }
          }

          ready = true;
          const pending = [...buffered]
            .filter((sequence) => this.after(sequence, lastSequence))
            .sort((a, b) => this.compare(a, b));
          buffered.clear();
          for (const sequence of pending) pushLive(sequence);
        } catch (error) {
          if (!closed) subscriber.error(error);
        }
      })();

      return () => {
        closed = true;
        clearInterval(heartbeat);
        clearInterval(authorizationTimer);
        liveSubscription.unsubscribe();
      };
    });
  }

  private message(notification: UserNotificationSnapshot): MessageEvent {
    return {
      id: notification.sequence,
      type: 'notification',
      data: notification,
    };
  }

  private authRevalidateMs(): number {
    const parsed = Number(process.env.SSE_AUTH_REVALIDATE_MS ?? DEFAULT_AUTH_REVALIDATE_MS);
    if (!Number.isFinite(parsed)) return DEFAULT_AUTH_REVALIDATE_MS;
    return Math.min(Math.max(Math.trunc(parsed), 1_000), 60_000);
  }

  private cursor(value: string): string {
    return this.cursorIsValid(value) ? value : '0';
  }

  private cursorIsValid(value: string): boolean {
    return /^\d+$/.test(value);
  }

  private after(candidate: string, cursor: string): boolean {
    return BigInt(candidate) > BigInt(cursor);
  }

  private compare(a: string, b: string): number {
    const left = BigInt(a);
    const right = BigInt(b);
    return left < right ? -1 : left > right ? 1 : 0;
  }
}
