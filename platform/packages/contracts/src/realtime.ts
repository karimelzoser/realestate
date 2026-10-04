import { z } from 'zod';

export const realtimeTopicSchema = z.enum([
  'CATALOG',
  'INVENTORY',
  'PRICING',
  'QUEUE',
  'TRANSACTION',
  'COMMISSION',
  'REFUND',
  'DOMAIN',
]);
export type RealtimeTopic = z.infer<typeof realtimeTopicSchema>;

export interface RealtimeSignal {
  sequence: string;
  topic: RealtimeTopic;
  eventType: string;
  occurredAt: string;
}

export interface RealtimeReplayPage {
  events: RealtimeSignal[];
  latestSequence: string | null;
}
