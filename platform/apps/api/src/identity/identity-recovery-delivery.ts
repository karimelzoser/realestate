import { Injectable } from '@nestjs/common';

@Injectable()
export class IdentityRecoveryDelivery {
  async send(input: {
    userId: string;
    contactId: string;
    challengeId: string;
    code: string;
    channel: 'WHATSAPP' | 'SMS';
  }): Promise<void> {
    const url = process.env.CONTACT_VERIFICATION_GATEWAY_URL;
    if (!url) {
      if (process.env.NODE_ENV === 'production') {
        throw new Error('CONTACT_VERIFICATION_GATEWAY_URL is required in production.');
      }
      console.info(`[DEV IDENTITY RECOVERY] user=${input.userId} challenge=${input.challengeId} code=${input.code}`);
      return;
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': `identity-recovery:${input.challengeId}`,
        ...(process.env.NOTIFICATION_GATEWAY_TOKEN
          ? { authorization: `Bearer ${process.env.NOTIFICATION_GATEWAY_TOKEN}` }
          : {}),
      },
      body: JSON.stringify({
        userId: input.userId,
        contactId: input.contactId,
        challengeId: input.challengeId,
        channel: input.channel,
        templateCode: 'auth.identity-recovery.verify',
        locale: 'ar-EG',
        payload: { code: input.code },
      }),
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      const detail = (await response.text()).slice(0, 500);
      throw new Error(`Identity recovery gateway ${response.status}: ${detail}`);
    }
  }
}
