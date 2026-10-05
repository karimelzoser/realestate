import { Injectable } from '@nestjs/common';
import type { DeliveryChannel } from './auth.repository.js';

export abstract class OtpDeliveryPort {
  abstract sendToUser(input: {
    userId: string;
    challengeId: string;
    code: string;
    channel: DeliveryChannel;
  }): Promise<void>;
}

@Injectable()
export class DevelopmentOtpDelivery extends OtpDeliveryPort {
  async sendToUser(input: {
    userId: string;
    challengeId: string;
    code: string;
    channel: DeliveryChannel;
  }): Promise<void> {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('Development OTP delivery is forbidden in production');
    }

    console.info(
      `[DEV OTP] channel=${input.channel} user=${input.userId} challenge=${input.challengeId} code=${input.code}`,
    );
  }
}

@Injectable()
export class GatewayOtpDelivery extends OtpDeliveryPort {
  async sendToUser(input: {
    userId: string;
    challengeId: string;
    code: string;
    channel: DeliveryChannel;
  }): Promise<void> {
    const url = process.env.AUTH_OTP_GATEWAY_URL;
    if (!url) throw new Error('AUTH_OTP_GATEWAY_URL is required for gateway OTP delivery.');

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': `auth-otp:${input.challengeId}`,
        ...(process.env.NOTIFICATION_GATEWAY_TOKEN
          ? { authorization: `Bearer ${process.env.NOTIFICATION_GATEWAY_TOKEN}` }
          : {}),
      },
      body: JSON.stringify({
        userId: input.userId,
        challengeId: input.challengeId,
        channel: input.channel,
        templateCode: 'auth.login.otp',
        locale: 'ar-EG',
        payload: { code: input.code },
      }),
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      const detail = (await response.text()).slice(0, 500);
      throw new Error(`OTP gateway ${response.status}: ${detail}`);
    }
  }
}
