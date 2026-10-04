import type { JsonValue, NotificationChannel } from '@preneura/database';

export interface ClaimedNotification {
  id: string;
  tenantId: string;
  projectId: string | null;
  transactionId: string | null;
  recipientUserId: string;
  channel: NotificationChannel;
  templateCode: string;
  locale: string;
  payload: JsonValue;
  idempotencyKey: string;
  attemptNumber: number;
}

export interface DeliveryResult {
  provider: string;
  providerMessageId: string | null;
}

export async function deliverExternalNotification(
  notification: ClaimedNotification,
): Promise<DeliveryResult> {
  const url = process.env.NOTIFICATION_GATEWAY_URL;
  if (!url) {
    throw new Error(`No notification gateway configured for ${notification.channel}.`);
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'idempotency-key': notification.idempotencyKey,
      ...(process.env.NOTIFICATION_GATEWAY_TOKEN
        ? { authorization: `Bearer ${process.env.NOTIFICATION_GATEWAY_TOKEN}` }
        : {}),
    },
    body: JSON.stringify({
      notificationJobId: notification.id,
      tenantId: notification.tenantId,
      projectId: notification.projectId,
      transactionId: notification.transactionId,
      recipientUserId: notification.recipientUserId,
      channel: notification.channel,
      templateCode: notification.templateCode,
      locale: notification.locale,
      payload: notification.payload,
    }),
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) {
    const detail = (await response.text()).slice(0, 1000);
    throw new Error(`Notification gateway ${response.status}: ${detail}`);
  }

  const result = await response.json() as { provider?: string; messageId?: string | null };
  return {
    provider: result.provider ?? 'NOTIFICATION_GATEWAY',
    providerMessageId: result.messageId ?? null,
  };
}
