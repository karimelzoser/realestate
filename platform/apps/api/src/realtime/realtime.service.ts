import { ForbiddenException, Injectable, type MessageEvent } from '@nestjs/common';
import type { PermissionCode } from '@preneura/contracts/access';
import type { RealtimeSignal, RealtimeTopic } from '@preneura/contracts/realtime';
import { Observable } from 'rxjs';
import { AccessService } from '../access/access.service.js';
import { RealtimeListenerService } from './realtime-listener.service.js';
import { RealtimeRepository } from './realtime.repository.js';

const REPLAY_BATCH = 500;
const MAX_REPLAY_EVENTS = 5_000;
const HEARTBEAT_MS = 20_000;

@Injectable()
export class RealtimeService {
  constructor(
    private readonly repository: RealtimeRepository,
    private readonly access: AccessService,
    private readonly listener: RealtimeListenerService,
  ) {}

  async projectStream(input: {
    userId: string;
    tenantId: string;
    projectId: string;
    afterSequence: string;
  }): Promise<Observable<MessageEvent>> {
    const topics = await this.allowedProjectTopics(input.userId, input.tenantId, input.projectId);
    if (topics.length === 0) throw new ForbiddenException('No live project topics are available for this user.');

    return this.buildStream({
      afterSequence: this.cursor(input.afterSequence),
      listen: (push) => this.listener.realtime$.subscribe((signal) => {
        if (
          signal.tenantId === input.tenantId &&
          signal.projectId === input.projectId &&
          topics.includes(signal.topic)
        ) push(signal.sequence);
      }),
      latest: () => this.repository.latestProjectSequence({
        tenantId: input.tenantId,
        projectId: input.projectId,
        topics,
      }),
      replay: (afterSequence, throughSequence, limit) => this.repository.listProjectEvents({
        tenantId: input.tenantId,
        projectId: input.projectId,
        topics,
        afterSequence,
        throughSequence,
        limit,
      }),
      fetchOne: (sequence) => this.repository.getProjectEvent({
        tenantId: input.tenantId,
        projectId: input.projectId,
        sequence,
        topics,
      }),
    });
  }

  async brokerCommissionStream(input: {
    userId: string;
    tenantId: string;
    projectId: string;
    brokerCompanyId: string;
    afterSequence: string;
  }): Promise<Observable<MessageEvent>> {
    await this.access.assert({
      userId: input.userId,
      permission: 'commission.status.read',
      context: {
        tenantId: input.tenantId,
        projectId: input.projectId,
        brokerCompanyId: input.brokerCompanyId,
      },
    });

    return this.buildStream({
      afterSequence: this.cursor(input.afterSequence),
      listen: (push) => this.listener.realtime$.subscribe((signal) => {
        if (
          signal.tenantId === input.tenantId &&
          signal.projectId === input.projectId &&
          signal.topic === 'COMMISSION'
        ) push(signal.sequence);
      }),
      latest: () => this.repository.latestBrokerCommissionSequence(input),
      replay: (afterSequence, throughSequence, limit) => this.repository.listBrokerCommissionEvents({
        ...input,
        afterSequence,
        throughSequence,
        limit,
      }),
      fetchOne: (sequence) => this.repository.getBrokerCommissionEvent({
        ...input,
        sequence,
      }),
    });
  }

  private buildStream(input: {
    afterSequence: string;
    listen: (push: (sequence: string) => void) => { unsubscribe(): void };
    latest: () => Promise<string | null>;
    replay: (afterSequence: string, throughSequence: string | null, limit: number) => Promise<RealtimeSignal[]>;
    fetchOne: (sequence: string) => Promise<RealtimeSignal | null>;
  }): Observable<MessageEvent> {
    return new Observable<MessageEvent>((subscriber) => {
      let closed = false;
      let ready = false;
      let lastSequence = input.afterSequence;
      let liveChain = Promise.resolve();
      const buffered = new Set<string>();

      const pushLive = (sequence: string): void => {
        if (closed || !this.cursorIsValid(sequence)) return;
        if (!ready) {
          buffered.add(sequence);
          return;
        }
        liveChain = liveChain.then(async () => {
          if (closed || !this.after(sequence, lastSequence)) return;
          const signal = await input.fetchOne(sequence);
          if (!signal || closed || !this.after(signal.sequence, lastSequence)) return;
          subscriber.next(this.message(signal));
          lastSequence = signal.sequence;
        }).catch((error) => {
          if (!closed) subscriber.error(error);
        });
      };

      const liveSubscription = input.listen(pushLive);
      const heartbeat = setInterval(() => {
        if (!closed) {
          subscriber.next({
            type: 'heartbeat',
            data: { at: new Date().toISOString(), cursor: lastSequence },
          });
        }
      }, HEARTBEAT_MS);

      void (async () => {
        try {
          const watermark = await input.latest();
          let replayed = 0;
          if (watermark && this.after(watermark, lastSequence)) {
            while (!closed && this.after(watermark, lastSequence)) {
              const remaining = MAX_REPLAY_EVENTS - replayed;
              if (remaining <= 0) {
                subscriber.next({
                  type: 'resync_required',
                  data: { cursor: lastSequence, latestSequence: watermark },
                });
                lastSequence = watermark;
                break;
              }
              const page = await input.replay(
                lastSequence,
                watermark,
                Math.min(REPLAY_BATCH, remaining),
              );
              if (page.length === 0) break;
              for (const signal of page) {
                if (closed) return;
                if (!this.after(signal.sequence, lastSequence)) continue;
                subscriber.next(this.message(signal));
                lastSequence = signal.sequence;
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
        liveSubscription.unsubscribe();
      };
    });
  }

  private async allowedProjectTopics(
    userId: string,
    tenantId: string,
    projectId: string,
  ): Promise<RealtimeTopic[]> {
    const checks: Array<{ topics: RealtimeTopic[]; permission: PermissionCode }> = [
      { topics: ['CATALOG', 'INVENTORY'], permission: 'inventory.read' },
      { topics: ['PRICING'], permission: 'pricing.read' },
      { topics: ['QUEUE'], permission: 'queue.read' },
      { topics: ['TRANSACTION'], permission: 'transaction.read' },
      { topics: ['REFUND'], permission: 'refund.read' },
      { topics: ['DOMAIN'], permission: 'audit.read' },
    ];
    const topics: RealtimeTopic[] = [];
    for (const check of checks) {
      const decision = await this.access.can({
        userId,
        permission: check.permission,
        context: { tenantId, projectId },
      });
      if (decision.allowed) topics.push(...check.topics);
    }
    return [...new Set(topics)];
  }

  private message(signal: RealtimeSignal): MessageEvent {
    return {
      id: signal.sequence,
      type: 'domain_signal',
      data: signal,
    };
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
